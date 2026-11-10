import { randomUUID } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { markFinalized, reconcile, type Sql } from '@uproar/indexer-core';
import { UPROAR_PROGRAM_ADDRESS } from '@uproar/protocol';
import { emailChannel, label, telegramChannel, tick, type AlertChannel } from '@uproar/safety';
import { getRpc, getSql } from './db';
import { env } from './env';

const LEASE_KEY = 'maintenance_lease';
/** Longer than any one run (the tick's function stops at 60 seconds), short enough to recover quickly. */
const LEASE_SECONDS = 90;
const SPAM_POSTS_PER_HOUR = 60;

export function alertChannels(): AlertChannel[] {
  const channels: AlertChannel[] = [];
  const t = env.telegram;
  if (t) channels.push(telegramChannel(t.token, t.chat));
  const e = env.email;
  if (e) channels.push(emailChannel(e.key, e.from, e.to));
  return channels;
}

/** Published on /rules: accounts posting far beyond human speed get the spam label. It isn't removal. */
async function labelRateSpam(): Promise<number> {
  const sql = getSql();
  const rows = await sql<{ author: string }[]>`
    select p.author from posts p
    where p.block_time > now() - interval '1 hour'
    group by p.author having count(*) > ${SPAM_POSTS_PER_HOUR}`;
  for (const { author } of rows) {
    await label(sql, { targetType: 'profile', target: author, label: 'spam', source: 'auto', reasonCode: 'posting_rate', actor: 'system', note: `More than ${SPAM_POSTS_PER_HOUR} posts in an hour` });
  }
  return rows.length;
}

async function alarm(sql: Sql, kind: string, subject: string, body: string, dedupeKey: string, severity: 'p0' | 'p1' = 'p1') {
  await sql`
    insert into alerts (severity, kind, subject, body, link, dedupe_key)
    values (${severity}, ${kind}, ${subject}, ${body}, '/admin', ${dedupeKey})
    on conflict do nothing`;
}

/**
 * Until the program is frozen, its upgrade key can change what the chain accepts. Any redeploy
 * raises an alarm, so an unexpected one is noticed at once.
 */
async function watchProgramUpgrades(sql: Sql): Promise<void> {
  const rpc = getRpc();
  const program = await rpc.call<{ value: { data: [string, string] } | null }>('getAccountInfo', [UPROAR_PROGRAM_ADDRESS, { encoding: 'base64' }]);
  if (!program.value) return;
  const raw = Buffer.from(program.value.data[0], 'base64');
  if (raw.length < 36 || raw.readUInt32LE(0) !== 2) return;
  const programData = getBase58Decoder().decode(raw.subarray(4, 36));
  const pd = await rpc.call<{ value: { data: [string, string] } | null }>('getAccountInfo', [programData, { encoding: 'base64', dataSlice: { offset: 4, length: 8 } }]);
  if (!pd.value) return;
  const slot = Buffer.from(pd.value.data[0], 'base64').readBigUInt64LE(0).toString();
  const known = (await sql<{ value: string }[]>`select value from chain_state where key = 'program_deploy_slot'`)[0]?.value;
  if (known && known !== slot) {
    await alarm(sql, 'program_upgraded', 'The UPROAR program was redeployed', `The program was deployed again at slot ${slot} (it was ${known}). If you didn't do this, the upgrade key is compromised.`, `upgrade:${slot}`, 'p0');
  }
  await sql`
    insert into chain_state (key, value) values ('program_deploy_slot', ${slot})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

/** Runs one step. A failure raises an alarm instead of stopping the others. */
async function step<T>(sql: Sql, name: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    console.error(`maintenance step ${name} failed`, error);
    const message = error instanceof Error ? error.message : String(error);
    await alarm(sql, 'maintenance_failed', `Maintenance failed: ${name}`, message.slice(0, 500), `maint:${name}:${new Date().toISOString().slice(0, 13)}`).catch(() => {});
    return undefined;
  }
}

export type MaintenanceResult = {
  ran: boolean;
  reconcile?: Awaited<ReturnType<typeof reconcile>>;
  finalize?: Awaited<ReturnType<typeof markFinalized>>;
  tick?: Awaited<ReturnType<typeof tick>>;
  spamLabelled?: number;
};

/**
 * The heartbeat: fill any gaps from the chain, finalize, escalate deadlines, send alarms. One runner
 * at a time. If another instance holds the lock this returns straight away.
 */
/**
 * One runner at a time, by a lease rather than a session lock. A serverless instance can be frozen
 * mid-run, and behind a transaction pooler a session lock then stays with whichever server connection
 * took it, so maintenance would never run again. A lease just runs out. Every step is safe to overlap
 * anyway (each takes its own transaction lock), so the lease only saves duplicate work.
 */
async function takeLease(sql: Sql): Promise<string | null> {
  const token = `${new Date(Date.now() + LEASE_SECONDS * 1000).toISOString()} ${randomUUID()}`;
  const rows = await sql`
    insert into chain_state (key, value) values (${LEASE_KEY}, ${token})
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where split_part(chain_state.value, ' ', 1)::timestamptz < now()
    returning key`;
  return rows.length ? token : null;
}

async function dropLease(sql: Sql, token: string): Promise<void> {
  await sql`update chain_state set value = ${`${new Date(0).toISOString()} free`}, updated_at = now() where key = ${LEASE_KEY} and value = ${token}`;
}

export async function runMaintenance(options: { budgetMs?: number } = {}): Promise<MaintenanceResult> {
  const sql = getSql();
  const lease = await takeLease(sql);
  if (!lease) return { ran: false };
  try {
    const rpc = getRpc();
    const program = UPROAR_PROGRAM_ADDRESS as string;
    const out: MaintenanceResult = { ran: true };
    out.reconcile = await step(sql, 'reconcile', () => reconcile(sql, rpc, program, { budgetMs: options.budgetMs ?? 25_000 }));
    out.finalize = await step(sql, 'finalize', () => markFinalized(sql, rpc));
    if (out.finalize?.orphaned.length) {
      await alarm(sql, 'rollback', `Chain rollback: ${out.finalize.orphaned.length} transactions removed`, 'Confirmed transactions never finalized. The projection was rebuilt.', `rollback:${out.finalize.orphaned[0]}`);
    }
    await step(sql, 'upgrade watch', () => watchProgramUpgrades(sql));
    out.spamLabelled = await step(sql, 'spam labels', labelRateSpam);
    // The heartbeat always runs last and on its own, so deadline alarms still go out if a step above failed.
    out.tick = await step(sql, 'deadlines and retention', () => tick(sql, { channels: alertChannels() }));
    await sql`
      insert into chain_state (key, value) values ('last_maintenance', ${new Date().toISOString()})
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
    return out;
  } finally {
    await dropLease(sql, lease).catch((error: unknown) => console.error('maintenance lease release failed', error));
  }
}

const PIGGYBACK_SECONDS = 60;

/**
 * Keeps the heartbeat going on free hosting, where cron is limited: any request can trigger it if
 * it hasn't run for a minute. A scheduled caller remains the guarantee for quiet periods.
 */
export async function maybeRunMaintenance(): Promise<void> {
  try {
    const sql = getSql();
    const row = (await sql<{ stale: boolean }[]>`
      select coalesce((select updated_at < now() - make_interval(secs => ${PIGGYBACK_SECONDS}) from chain_state where key = 'last_maintenance'), true) as stale`)[0];
    if (row?.stale) await runMaintenance({ budgetMs: 8_000 });
  } catch (error) {
    console.error('maintenance failed', error);
  }
}
