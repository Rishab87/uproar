/**
 * Times every read query against a database seeded at launch-plus scale, so slow plans show up
 * before users do. Bulk-loads rows straight into the projection, then runs each query repeatedly.
 *
 *   DATABASE_URL=postgres://uproar@127.0.0.1:54329/uproar pnpm --filter @uproar/web exec tsx tests/loadtest.ts
 */
import { connect } from '@uproar/indexer-core';
import { migrate } from '@uproar/indexer-core/migrate';
import * as q from '../lib/server/queries';

const URL = process.env.DATABASE_URL ?? 'postgres://uproar@127.0.0.1:54329/uproar';
const SCHEMA = 'loadtest';
const USERS = Number(process.env.USERS ?? 20_000);
const POSTS = Number(process.env.POSTS ?? 300_000);
const LIKES = Number(process.env.LIKES ?? 1_500_000);
const FOLLOWS = Number(process.env.FOLLOWS ?? 400_000);

const admin = connect(URL, { max: 1 });
await admin.unsafe(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}`);
await admin.end();
const sql = connect(URL, { max: 8, schema: SCHEMA });
await migrate(sql);

const t0 = Date.now();
// Addresses and signatures only need to be distinct strings for timing purposes.
await sql.unsafe(`
  insert into profiles (address, creator, authority, handle, name, bio, created_at, follower_count, following_count, post_count)
  select 'p' || i, 'w' || i, 'w' || i, 'user' || i, 'User ' || i, 'bio', now() - (i || ' minutes')::interval, 0, 0, 0
  from generate_series(1, ${USERS}) i;
  insert into handles (address, handle, holder, claimed_at, version_slot, version_sig, version_ix)
  select 'h' || i, 'user' || i, 'p' || i, now() - (i || ' minutes')::interval, i, 's' || i, 0 from generate_series(1, ${USERS}) i;
  insert into posts (sig, author, text, reply_to, slot, ix_index, block_time)
  select 'x' || i, 'p' || (1 + (i::bigint * 7919) % ${USERS}),
         'post number ' || i || case when i % 5 = 0 then ' #solana' when i % 7 = 0 then ' #uproar @user' || (i % 100) else ' hello world' end,
         case when i % 4 = 0 then 'x' || greatest(1, i - 1 - (i % 50)) else null end,
         i, 0, now() - ((${POSTS} - i) * 3 || ' seconds')::interval
  from generate_series(1, ${POSTS}) i;
  insert into post_tags (post, tag, slot) select sig, 'solana', slot from posts where text like '%#solana%';
  insert into post_tags (post, tag, slot) select sig, 'uproar', slot from posts where text like '%#uproar%';
  insert into post_mentions (post, handle, slot) select sig, 'user' || (substring(sig from 2)::int % 100), slot from posts where text like '%@user%';
  insert into likes (profile, post, active, slot, sig, ix)
  select 'p' || (1 + (i::bigint * 104729) % ${USERS}), 'x' || (1 + (i::bigint * 15485863) % ${POSTS}), true, i, 'l' || i, 0
  from generate_series(1, ${LIKES}) i on conflict do nothing;
  insert into follows (follower, followee, active, slot, sig, ix)
  select 'p' || (1 + (i::bigint * 31) % ${USERS}), 'p' || (1 + (i::bigint * 7) % 2000), true, i, 'f' || i, 0
  from generate_series(1, ${FOLLOWS}) i on conflict do nothing;
  update posts p set like_count = c.n from (select post, count(*) n from likes group by post) c where c.post = p.sig;
  update posts p set reply_count = c.n from (select reply_to, count(*) n from posts where reply_to is not null group by reply_to) c where c.reply_to = p.sig;
  update profiles p set follower_count = c.n from (select followee, count(*) n from follows group by followee) c where c.followee = p.address;
  update profiles p set following_count = c.n from (select follower, count(*) n from follows group by follower) c where c.follower = p.address;
  analyze;
`);
console.log(`loaded ${USERS} users, ${POSTS} posts, ${LIKES} likes, ${FOLLOWS} follows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const anon: q.Ctx = { sql, country: 'IN', viewer: null };
const viewer: q.Ctx = { sql, country: 'IN', viewer: 'p31' };
const thread = `x${POSTS - 400}`;

const cases: [string, () => Promise<unknown>][] = [
  ['For you (anonymous)', () => q.feedForYou(anon, {})],
  ['For you (signed in)', () => q.feedForYou(viewer, {})],
  ['Following', () => q.feedFollowing(viewer, {})],
  ['Latest', () => q.feedLatest(anon, {})],
  ['Tag #solana', () => q.tagFeed(anon, 'solana', {})],
  ['Search "number"', () => q.searchPosts(anon, 'number', {})],
  ['Search people', () => q.searchProfiles(anon, 'user12', {})],
  ['Thread', () => q.getThread(anon, thread)],
  ['Profile page', () => q.getProfileByHandle(viewer, 'user7')],
  ['Profile posts', () => q.profileFeed(anon, 'p7', { tab: 'posts' })],
  ['Profile likes', () => q.profileFeed(anon, 'p7', { tab: 'likes' })],
  ['Notifications', () => q.notifications({ ...viewer, viewer: 'p7' }, {})],
  ['Trends', () => q.trends(anon)],
  ['Who to follow', () => q.whoToFollow(viewer, 4)],
  ['Recent handles', () => q.recentHandles(anon, 28)],
];

console.log('\nquery                    p50 ms   p95 ms');
for (const [name, run] of cases) {
  await run();
  const times: number[] = [];
  for (let i = 0; i < 15; i++) {
    const s = performance.now();
    await run();
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  console.log(`${name.padEnd(24)} ${times[7]!.toFixed(1).padStart(7)} ${times[14]!.toFixed(1).padStart(8)}`);
}

// Concurrency: many readers at once on the hottest path.
const started = performance.now();
await Promise.all(Array.from({ length: 200 }, () => q.feedForYou(anon, {})));
console.log(`\n200 concurrent For you requests on 8 connections: ${((performance.now() - started) / 1000).toFixed(2)}s total`);
await sql.end();
