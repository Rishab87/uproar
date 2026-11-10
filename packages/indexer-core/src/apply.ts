/**
 * The reducers. Each one updates the projection in a way that doesn't depend on arrival order:
 *  - Toggles (likes, follows) are last-write-wins on (slot, signature, instruction index).
 *  - Counters are recounted from rows, never incremented, so they can't drift.
 *  - Ownership (handles, profile authority) is resolved from in/out balance over all known moves.
 *    Within one slot, signature order is not execution order, but the balance is the same either way.
 */
import { extractHashtags, extractMentions, type UproarEvent } from '@uproar/protocol';
import type { Sql, Tx } from './db';
import type { IndexedTx } from './parse';

const WRITER_LOCK = 7_141_592;
const PAGE = 2_000;

type Meta = { sig: string; slot: number; blockTime: Date | null; ix: number };

function timeOf(blockTime: number | null): Date | null {
  return blockTime === null ? null : new Date(blockTime * 1000);
}

function eventColumns(e: UproarEvent) {
  switch (e.kind) {
    case 'create_profile':
    case 'rotate_authority':
    case 'close_profile':
    case 'revoke_all_sessions':
      return { signer: e.authority, profile: e.profile, handle: null, session: null };
    case 'claim_handle':
    case 'release_handle':
      return { signer: e.authority, profile: e.profile, handle: e.handleAccount, session: null };
    case 'transfer_handle':
      return { signer: e.fromAuthority, profile: e.fromProfile, handle: e.handleAccount, session: null };
    case 'create_session':
    case 'extend_session':
      return { signer: e.authority, profile: e.profile, handle: null, session: e.session };
    case 'close_session':
      return { signer: e.signer, profile: null, handle: null, session: e.session };
    default:
      return { signer: e.signer, profile: e.profile, handle: null, session: null };
  }
}

const ensureProfile = (t: Tx, address: string) =>
  t`insert into profiles (address) values (${address}) on conflict do nothing`;

async function recountPost(t: Tx, sig: string) {
  await t`
    update posts p set
      like_count = (select count(*) from likes l where l.post = p.sig and l.active),
      repost_count = (select count(*) from reposts r where r.post = p.sig and r.active),
      reply_count = (select count(*) from posts c where c.reply_to = p.sig and not c.deleted),
      quote_count = (select count(*) from posts c where c.quote_of = p.sig and not c.deleted)
    where p.sig = ${sig}`;
}

async function recountFollows(t: Tx, address: string) {
  await t`
    update profiles p set
      follower_count = (select count(*) from follows f where f.followee = p.address and f.active),
      following_count = (select count(*) from follows f where f.follower = p.address and f.active)
    where p.address = ${address}`;
}

async function recountPosts(t: Tx, address: string) {
  await t`
    update profiles p set post_count = (select count(*) from posts c where c.author = p.address and not c.deleted)
    where p.address = ${address}`;
}

type Move = { from?: string; to?: string };

/**
 * The current holder is whoever has one more move in than out. While events are still missing
 * more than one candidate can appear; the latest wins until the rest arrive and the balance settles.
 */
function resolveHolder(moves: readonly Move[]): string | null {
  const net = new Map<string, number>();
  for (const { from, to } of moves) {
    if (from) net.set(from, (net.get(from) ?? 0) - 1);
    if (to) net.set(to, (net.get(to) ?? 0) + 1);
  }
  for (let i = moves.length - 1; i >= 0; i--) {
    const to = moves[i]?.to;
    if (to && (net.get(to) ?? 0) > 0) return to;
  }
  return null;
}

type EventRow = { kind: string; slot: string; sig: string; ix_index: number; block_time: Date | null; data: Record<string, unknown> };

async function recomputeOwnership(t: Tx, profile: string) {
  const rows = await t<EventRow[]>`
    select kind, slot, sig, ix_index, block_time, data from events
    where profile = ${profile} and kind in ('create_profile', 'rotate_authority', 'close_profile')
    order by slot, sig, ix_index`;
  const moves: Move[] = rows.map((r) => {
    const d = r.data as { authority: string; newAuthority?: string };
    if (r.kind === 'create_profile') return { to: d.authority };
    if (r.kind === 'rotate_authority') return { from: d.authority, ...(d.newAuthority ? { to: d.newAuthority } : {}) };
    return { from: d.authority };
  });
  const owner = resolveHolder(moves);
  const firstCreate = rows.find((r) => r.kind === 'create_profile');
  const lastMove = moves[moves.length - 1];
  const hasClose = rows.some((r) => r.kind === 'close_profile');
  await t`
    update profiles set
      authority = ${owner ?? lastMove?.from ?? null},
      creator = ${(firstCreate?.data as { authority?: string } | undefined)?.authority ?? null},
      created_at = ${firstCreate?.block_time ?? null},
      created_slot = ${firstCreate?.slot ?? null},
      closed = ${owner === null && hasClose}
    where address = ${profile}`;
}

async function recomputeHandle(t: Tx, handleAccount: string) {
  const rows = await t<EventRow[]>`
    select kind, slot, sig, ix_index, block_time, data from events
    where handle_account = ${handleAccount}
    order by slot, sig, ix_index`;
  const claim = rows.find((r) => r.kind === 'claim_handle');
  if (!claim) return; // The name is only known once the claim arrives.

  const moves: Move[] = rows.map((r) => {
    const d = r.data as { profile?: string; fromProfile?: string; toProfile?: string };
    if (r.kind === 'claim_handle') return { to: d.profile as string };
    if (r.kind === 'release_handle') return { from: d.profile as string };
    return { from: d.fromProfile as string, to: d.toProfile as string };
  });
  const holder = resolveHolder(moves);
  let claimedAt: Date | null = null;
  if (holder) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (moves[i]?.to === holder) {
        claimedAt = rows[i]?.block_time ?? null;
        break;
      }
    }
  }
  const last = rows[rows.length - 1] as EventRow;
  const name = (claim.data as { handle: string }).handle;

  await t`
    insert into handles (address, handle, holder, claimed_at, version_slot, version_sig, version_ix)
    values (${handleAccount}, ${name}, ${holder}, ${claimedAt}, ${last.slot}, ${last.sig}, ${last.ix_index})
    on conflict (address) do update set
      holder = excluded.holder,
      claimed_at = excluded.claimed_at,
      version_slot = excluded.version_slot,
      version_sig = excluded.version_sig,
      version_ix = excluded.version_ix`;

  const touched = [...new Set(moves.flatMap((m) => [m.from, m.to]).filter((a): a is string => Boolean(a)))];
  for (const address of touched) {
    await ensureProfile(t, address);
    await t`
      update profiles p set handle = (
        select h.handle from handles h where h.holder = p.address
        order by h.version_slot desc, h.version_sig desc, h.version_ix desc limit 1
      ) where p.address = ${address}`;
  }
}

async function recomputeSession(t: Tx, session: string) {
  const rows = await t<EventRow[]>`
    select kind, slot, sig, ix_index, block_time, data from events
    where session_account = ${session}
    order by slot, sig, ix_index`;
  const writes = rows.filter((r) => r.kind !== 'close_session');
  const latest = writes[writes.length - 1];
  if (!latest) return;
  const creates = rows.filter((r) => r.kind === 'create_session');
  const closes = rows.filter((r) => r.kind === 'close_session').length;
  const lastCreate = creates[creates.length - 1];
  const d = latest.data as { profile: string; delegate: string; expiresAt: number; authority: string };
  const payer = (lastCreate?.data as { authority?: string } | undefined)?.authority ?? null;
  await t`
    insert into sessions (address, profile, delegate, rent_payer, expires_at, created_at, closed, version_slot, version_sig, version_ix)
    values (${session}, ${d.profile}, ${d.delegate}, ${payer}, ${new Date(d.expiresAt * 1000)}, ${lastCreate?.block_time ?? null},
            ${closes >= creates.length}, ${latest.slot}, ${latest.sig}, ${latest.ix_index})
    on conflict (address) do update set
      profile = excluded.profile, delegate = excluded.delegate, rent_payer = excluded.rent_payer,
      expires_at = excluded.expires_at, created_at = excluded.created_at, closed = excluded.closed,
      version_slot = excluded.version_slot, version_sig = excluded.version_sig, version_ix = excluded.version_ix`;
}

async function killSessions(t: Tx, profile: string, m: Meta) {
  await ensureProfile(t, profile);
  await t`
    update profiles set kill_slot = ${m.slot}, kill_sig = ${m.sig}, kill_ix = ${m.ix}
    where address = ${profile}
      and (kill_slot is null or (kill_slot, kill_sig, kill_ix) < (${m.slot}::bigint, ${m.sig}::text collate "C", ${m.ix}::int))`;
}

async function toggle(t: Tx, table: 'likes' | 'reposts', profile: string, post: string, active: boolean, m: Meta) {
  const name = t(table);
  await t`
    insert into ${name} (profile, post, active, slot, sig, ix, block_time)
    values (${profile}, ${post}, ${active}, ${m.slot}, ${m.sig}, ${m.ix}, ${m.blockTime})
    on conflict (profile, post) do update set
      active = excluded.active, slot = excluded.slot, sig = excluded.sig, ix = excluded.ix, block_time = excluded.block_time
    where (${name}.slot, ${name}.sig, ${name}.ix) < (excluded.slot, excluded.sig, excluded.ix)`;
  await recountPost(t, post);
}

async function follow(t: Tx, follower: string, followee: string, active: boolean, m: Meta) {
  await ensureProfile(t, follower);
  await ensureProfile(t, followee);
  await t`
    insert into follows (follower, followee, active, slot, sig, ix, block_time)
    values (${follower}, ${followee}, ${active}, ${m.slot}, ${m.sig}, ${m.ix}, ${m.blockTime})
    on conflict (follower, followee) do update set
      active = excluded.active, slot = excluded.slot, sig = excluded.sig, ix = excluded.ix, block_time = excluded.block_time
    where (follows.slot, follows.sig, follows.ix) < (excluded.slot, excluded.sig, excluded.ix)`;
  await recountFollows(t, follower);
  await recountFollows(t, followee);
}

async function insertPost(t: Tx, e: Extract<UproarEvent, { kind: 'post' }>, m: Meta) {
  await ensureProfile(t, e.profile);
  const inserted = await t`
    insert into posts (sig, author, text, reply_to, quote_of, slot, ix_index, block_time, deleted)
    values (${m.sig}, ${e.profile}, ${e.text}, ${e.replyTo}, ${e.quoteOf}, ${m.slot}, ${m.ix}, ${m.blockTime},
            exists (select 1 from post_deletes d where d.post = ${m.sig} and d.profile = ${e.profile}))
    on conflict (sig) do nothing
    returning sig`;
  if (inserted.length === 0) return; // Not the first post in this transaction: ignored by rule.

  for (const tag of extractHashtags(e.text)) {
    await t`insert into post_tags (post, tag, slot) values (${m.sig}, ${tag}, ${m.slot}) on conflict do nothing`;
  }
  for (const handle of extractMentions(e.text)) {
    await t`insert into post_mentions (post, handle, slot) values (${m.sig}, ${handle}, ${m.slot}) on conflict do nothing`;
  }
  // Likes, replies and quotes can arrive before the post they point at.
  await recountPost(t, m.sig);
  if (e.replyTo) await recountPost(t, e.replyTo);
  if (e.quoteOf) await recountPost(t, e.quoteOf);
  await recountPosts(t, e.profile);
}

async function deletePost(t: Tx, profile: string, post: string) {
  await t`insert into post_deletes (post, profile) values (${post}, ${profile}) on conflict do nothing`;
  // Only the author's own delete has any effect. Anyone else's is recorded and ignored.
  const hit = await t<{ reply_to: string | null; quote_of: string | null }[]>`
    update posts set deleted = true where sig = ${post} and author = ${profile} and not deleted
    returning reply_to, quote_of`;
  const row = hit[0];
  if (!row) return;
  // Feeds cached for logged-out readers key on this (see bumpVisibility in @uproar/safety).
  await t`
    insert into chain_state (key, value) values ('visibility_version', '1')
    on conflict (key) do update set value = (chain_state.value::bigint + 1)::text, updated_at = now()`;
  if (row.reply_to) await recountPost(t, row.reply_to);
  if (row.quote_of) await recountPost(t, row.quote_of);
  await recountPosts(t, profile);
}

async function project(t: Tx, e: UproarEvent, m: Meta) {
  switch (e.kind) {
    case 'create_profile':
      await ensureProfile(t, e.profile);
      await recomputeOwnership(t, e.profile);
      // A new profile starts a fresh session epoch, so sessions from before it are dead.
      await killSessions(t, e.profile, m);
      break;
    case 'close_profile':
      await ensureProfile(t, e.profile);
      await recomputeOwnership(t, e.profile);
      break;
    case 'rotate_authority':
      await ensureProfile(t, e.profile);
      await recomputeOwnership(t, e.profile);
      await killSessions(t, e.profile, m);
      break;
    case 'revoke_all_sessions':
      await killSessions(t, e.profile, m);
      break;
    case 'claim_handle':
    case 'release_handle':
      await ensureProfile(t, e.profile);
      await recomputeHandle(t, e.handleAccount);
      break;
    case 'transfer_handle':
      await ensureProfile(t, e.fromProfile);
      await ensureProfile(t, e.toProfile);
      await recomputeHandle(t, e.handleAccount);
      break;
    case 'create_session':
    case 'extend_session':
    case 'close_session':
      await recomputeSession(t, e.session);
      break;
    case 'post':
      await insertPost(t, e, m);
      break;
    case 'delete_post':
      await deletePost(t, e.profile, e.post);
      break;
    case 'like':
    case 'unlike':
      await toggle(t, 'likes', e.profile, e.post, e.kind === 'like', m);
      break;
    case 'repost':
    case 'unrepost':
      await toggle(t, 'reposts', e.profile, e.post, e.kind === 'repost', m);
      break;
    case 'follow':
    case 'unfollow':
      await follow(t, e.profile, e.target, e.kind === 'follow', m);
      break;
    case 'set_profile':
      await ensureProfile(t, e.profile);
      await t`
        update profiles set
          name = ${e.name}, bio = ${e.bio}, website = ${e.website}, location = ${e.location},
          avatar_seed = ${e.avatarSeed}, accent = ${e.accent},
          meta_slot = ${m.slot}, meta_sig = ${m.sig}, meta_ix = ${m.ix}
        where address = ${e.profile}
          and (meta_slot is null or (meta_slot, meta_sig, meta_ix) < (${m.slot}::bigint, ${m.sig}::text collate "C", ${m.ix}::int))`;
      break;
    case 'pin':
      await ensureProfile(t, e.profile);
      await t`
        update profiles set pinned_post = ${e.post}, pin_slot = ${m.slot}, pin_sig = ${m.sig}, pin_ix = ${m.ix}
        where address = ${e.profile}
          and (pin_slot is null or (pin_slot, pin_sig, pin_ix) < (${m.slot}::bigint, ${m.sig}::text collate "C", ${m.ix}::int))`;
      break;
  }
}

/**
 * Applies transactions atomically and idempotently. Writers take one lock: recounts must see each
 * other's rows, and at this scale one writer at a time is simple, correct and fast enough.
 * Returns how many new events were recorded.
 */
export async function applyTransactions(sql: Sql, txs: readonly IndexedTx[]): Promise<number> {
  if (txs.length === 0) return 0;
  return sql.begin(async (t) => {
    await t`select pg_advisory_xact_lock(${WRITER_LOCK})`;
    let inserted = 0;
    for (const tx of txs) {
      const blockTime = timeOf(tx.blockTime);
      for (const { ixIndex, event } of [...tx.events].sort((a, b) => a.ixIndex - b.ixIndex)) {
        const c = eventColumns(event);
        const rows = await t`
          insert into events (sig, ix_index, slot, block_time, kind, signer, profile, handle_account, session_account, data)
          values (${tx.sig}, ${ixIndex}, ${tx.slot}, ${blockTime}, ${event.kind}, ${c.signer}, ${c.profile}, ${c.handle}, ${c.session}, ${t.json(event as never)})
          on conflict do nothing
          returning sig`;
        if (rows.length === 0) continue;
        inserted += 1;
        await project(t, event, { sig: tx.sig, slot: tx.slot, blockTime, ix: ixIndex });
      }
    }
    return inserted;
  }) as Promise<number>;
}

const PROJECTIONS = ['profiles', 'handles', 'posts', 'post_deletes', 'likes', 'reposts', 'follows', 'post_tags', 'post_mentions', 'sessions'];

/** Throws away every projection and replays the event log. Moderation tables are not touched. */
export async function rebuild(sql: Sql): Promise<number> {
  return sql.begin((t) => rebuildWithin(t)) as Promise<number>;
}

/** The rebuild, inside a caller's transaction, so a removal and its rebuild commit or fail together. */
export async function rebuildWithin(t: Tx): Promise<number> {
  {
    await t`select pg_advisory_xact_lock(${WRITER_LOCK})`;
    await t.unsafe(`truncate ${PROJECTIONS.join(', ')}`);
    let total = 0;
    let after: { slot: string; sig: string; ix: number } | null = null;
    for (;;) {
      const rows: (EventRow & { data: UproarEvent })[] = after
        ? await t`
            select kind, slot, sig, ix_index, block_time, data from events
            where (slot, sig, ix_index) > (${after.slot}::bigint, ${after.sig}::text collate "C", ${after.ix}::int)
            order by slot, sig, ix_index limit ${PAGE}`
        : await t`select kind, slot, sig, ix_index, block_time, data from events order by slot, sig, ix_index limit ${PAGE}`;
      if (rows.length === 0) break;
      for (const r of rows) {
        await project(t, r.data, { sig: r.sig, slot: Number(r.slot), blockTime: r.block_time, ix: r.ix_index });
      }
      total += rows.length;
      const last = rows[rows.length - 1] as EventRow;
      after = { slot: last.slot, sig: last.sig, ix: last.ix_index };
    }
    return total;
  }
}
