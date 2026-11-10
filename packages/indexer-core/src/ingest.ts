import { applyTransactions, rebuildWithin } from './apply';
import type { Sql } from './db';
import { indexTransaction, type IndexedTx } from './parse';
import type { Rpc, SignatureInfo } from './rpc';

const CURSOR_KEY = 'reconcile_cursor';

export type IngestResult = 'indexed' | 'duplicate' | 'not_ours' | 'not_found';

/**
 * Indexes one signature. The client only supplies a hint: every byte that gets recorded comes from
 * the RPC node, so a client cannot forge an event.
 */
export async function ingestSignature(
  sql: Sql,
  rpc: Rpc,
  programId: string,
  signature: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<IngestResult> {
  const attempts = options.attempts ?? 8;
  const known = await sql`select 1 from events where sig = ${signature} limit 1`;
  if (known.length) return 'duplicate';
  for (let i = 0; i < attempts; i++) {
    const raw = await rpc.getTransaction(signature);
    if (raw) {
      const indexed = indexTransaction(raw, programId);
      if (!indexed) return 'not_ours';
      return (await applyTransactions(sql, [indexed])) > 0 ? 'indexed' : 'duplicate';
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, options.delayMs ?? 500));
  }
  return 'not_found';
}

export type ReconcileResult = { listed: number; missing: number; applied: number; caughtUp: boolean };

/**
 * Walks the program's history back to the saved cursor and fills in anything the live paths missed.
 * It can stop at a deadline and resume next time. The cursor only moves past finalized signatures,
 * so a confirmed transaction that the cluster later drops is never skipped by mistake.
 */
export async function reconcile(
  sql: Sql,
  rpc: Rpc,
  programId: string,
  options: { budgetMs?: number; maxSignatures?: number; concurrency?: number } = {},
): Promise<ReconcileResult> {
  const deadline = Date.now() + (options.budgetMs ?? 45_000);
  const maxSignatures = options.maxSignatures ?? 20_000;
  const concurrency = options.concurrency ?? 4;

  const cursor = (await sql<{ value: string }[]>`select value from chain_state where key = ${CURSOR_KEY}`)[0]?.value;
  const listed: SignatureInfo[] = [];
  let before: string | undefined;
  let reachedCursor = false;
  while (listed.length < maxSignatures && Date.now() < deadline) {
    const page = await rpc.getSignaturesForAddress(programId, {
      limit: 1000,
      ...(before ? { before } : {}),
      ...(cursor ? { until: cursor } : {}),
    });
    listed.push(...page);
    if (page.length < 1000) {
      reachedCursor = true;
      break;
    }
    before = page[page.length - 1]?.signature;
  }

  // Oldest first, so a partial run can save its progress. A partial listing has a gap before its
  // oldest entry, so it may fill in events but must not advance the cursor.
  const chronological = listed.filter((s) => s.err === null).reverse();
  const known = new Set(
    (await sql<{ sig: string }[]>`select distinct sig from events where sig = any(${chronological.map((s) => s.signature)})`).map((r) => r.sig),
  );

  let applied = 0;
  let processed = 0;
  let missing = 0;
  let stopped = false;
  let newCursor: string | undefined;

  for (let i = 0; i < chronological.length && !stopped; i += concurrency) {
    if (Date.now() >= deadline) {
      stopped = true;
      break;
    }
    const batch = chronological.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (info): Promise<{ info: SignatureInfo; ok: boolean; tx: IndexedTx | null }> => {
        if (known.has(info.signature)) return { info, ok: true, tx: null };
        missing += 1;
        const raw = await rpc.getTransaction(info.signature);
        if (!raw) return { info, ok: false, tx: null };
        return { info, ok: true, tx: indexTransaction(raw, programId) };
      }),
    );
    applied += await applyTransactions(sql, results.flatMap((r) => (r.tx ? [r.tx] : [])));
    for (const r of results) {
      if (!r.ok) {
        stopped = true;
        break;
      }
      processed += 1;
      if (reachedCursor && r.info.confirmationStatus === 'finalized') newCursor = r.info.signature;
    }
  }

  // Failed transactions newer than the last success still count as seen, but only when finalized
  // and only if everything older was handled. Otherwise they're simply listed again next time.
  if (newCursor) {
    await sql`
      insert into chain_state (key, value) values (${CURSOR_KEY}, ${newCursor})
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
  }
  return { listed: listed.length, missing, applied, caughtUp: reachedCursor && !stopped && processed === chronological.length };
}

export type FinalizeResult = { finalized: number; orphaned: string[] };

/**
 * Marks recorded events as finalized. A confirmed transaction that vanished from the cluster has
 * been rolled back, which is extremely rare: it is removed and the projection is rebuilt.
 */
export async function markFinalized(sql: Sql, rpc: Rpc, options: { limit?: number; orphanAfterSlots?: number } = {}): Promise<FinalizeResult> {
  const tip = await rpc.getSlot('finalized');
  const rows = await sql<{ sig: string; slot: string }[]>`
    select sig, min(slot)::text as slot from events
    where not finalized and slot <= ${tip}
    group by sig order by min(slot) limit ${options.limit ?? 256}`;
  if (rows.length === 0) return { finalized: 0, orphaned: [] };

  const statuses = await rpc.getSignatureStatuses(rows.map((r) => r.sig));
  const done: string[] = [];
  const orphaned: string[] = [];
  rows.forEach((row, i) => {
    const status = statuses[i];
    if (status && status.err === null && status.confirmationStatus === 'finalized') {
      done.push(row.sig);
    } else if ((!status || status.err !== null) && Number(row.slot) < tip - (options.orphanAfterSlots ?? 512)) {
      orphaned.push(row.sig);
    }
  });

  if (done.length) await sql`update events set finalized = true where sig = any(${done})`;
  if (orphaned.length) {
    // One transaction: if the rebuild fails, the rolled-back events stay recorded and this retries.
    await sql.begin(async (t) => {
      await t`delete from events where sig = any(${orphaned})`;
      await rebuildWithin(t);
    });
  }
  return { finalized: done.length, orphaned };
}

/** Backfills the whole history into an empty database. Used to prove the chain is the source of truth. */
export async function backfill(sql: Sql, rpc: Rpc, programId: string, onProgress?: (r: ReconcileResult) => void): Promise<ReconcileResult> {
  let result: ReconcileResult;
  do {
    result = await reconcile(sql, rpc, programId, { budgetMs: 300_000, maxSignatures: 1_000_000 });
    onProgress?.(result);
  } while (!result.caughtUp && result.missing > 0);
  return result;
}
