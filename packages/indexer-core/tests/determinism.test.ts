import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UproarEvent } from '@uproar/protocol';
import { applyTransactions, rebuild, stateHash, type IndexedTx, type Sql } from '../src/index';
import { fakeAddress, fakeSig, rng, shuffled, testDb, tx } from './helpers';

const wallet = (n: string) => fakeAddress(`wallet:${n}`);
const prof = (n: string) => fakeAddress(`profile:${n}`);
const hAcc = (h: string) => fakeAddress(`handle:${h}`);
const sess = (p: string, d: string) => fakeAddress(`session:${p}:${d}`);

const base = (profile: string) => ({ signer: wallet(profile), profile: prof(profile), session: null });
const created = (n: string): UproarEvent => ({ kind: 'create_profile', authority: wallet(n), profile: prof(n) });
const claimed = (n: string, h: string): UproarEvent => ({ kind: 'claim_handle', authority: wallet(n), profile: prof(n), handleAccount: hAcc(h), handle: h });
const released = (n: string, h: string): UproarEvent => ({ kind: 'release_handle', authority: wallet(n), profile: prof(n), handleAccount: hAcc(h) });
const transferred = (a: string, b: string, h: string): UproarEvent => ({ kind: 'transfer_handle', fromAuthority: wallet(a), toAuthority: wallet(b), fromProfile: prof(a), toProfile: prof(b), handleAccount: hAcc(h) });
const posted = (n: string, text: string, replyTo: string | null = null, quoteOf: string | null = null): UproarEvent => ({ kind: 'post', ...base(n), text, replyTo, quoteOf });

let sql: Sql;
let drop: () => Promise<void>;
beforeEach(async () => ({ sql, drop } = await testDb()));
afterEach(async () => drop());

const one = async <T>(query: Promise<readonly T[]>) => (await query)[0] as T;

describe('reducers', () => {
  it('builds a profile with its handle', async () => {
    await applyTransactions(sql, [tx(fakeSig('a'), 10, [created('alice'), claimed('alice', 'alice')])]);
    const p = await one(sql<{ handle: string; authority: string; creator: string; closed: boolean }[]>`select * from profiles where address = ${prof('alice')}`);
    expect(p).toMatchObject({ handle: 'alice', authority: wallet('alice'), creator: wallet('alice'), closed: false });
  });

  it('records posts with their tags and mentions', async () => {
    const sig = fakeSig('p');
    await applyTransactions(sql, [tx(fakeSig('a'), 10, [created('alice'), claimed('alice', 'alice')]), tx(sig, 11, [posted('alice', 'hi @Bob and #Solana')])]);
    const p = await one(sql<{ text: string; author: string; deleted: boolean }[]>`select * from posts where sig = ${sig}`);
    expect(p).toMatchObject({ text: 'hi @Bob and #Solana', author: prof('alice'), deleted: false });
    expect(await sql`select tag from post_tags where post = ${sig}`).toEqual([{ tag: 'solana' }]);
    expect(await sql`select handle from post_mentions where post = ${sig}`).toEqual([{ handle: 'bob' }]);
  });

  it('only counts the first post in a transaction', async () => {
    const sig = fakeSig('multi');
    await applyTransactions(sql, [tx(sig, 11, [posted('alice', 'first #one'), posted('alice', 'second #two @bob')])]);
    const rows = await sql`select text from posts`;
    expect(rows).toEqual([{ text: 'first #one' }]);
    // The ignored post must not leak its tags or mentions onto the first post.
    expect(await sql`select tag from post_tags`).toEqual([{ tag: 'one' }]);
    expect(await sql`select handle from post_mentions`).toEqual([]);
  });

  it('is idempotent: applying a transaction twice changes nothing', async () => {
    const parent = fakeSig('parent');
    const history = [
      tx(fakeSig('a'), 1, [created('alice'), claimed('alice', 'alice')]),
      tx(parent, 2, [posted('alice', 'hello')]),
      tx(fakeSig('r'), 3, [posted('alice', 'reply', parent)]),
      tx(fakeSig('l'), 4, [{ kind: 'like', ...base('alice'), post: parent }]),
    ];
    expect(await applyTransactions(sql, history)).toBe(5);
    const before = await stateHash(sql);
    expect(await applyTransactions(sql, history)).toBe(0);
    expect(await stateHash(sql)).toBe(before);
    const p = await one(sql<{ like_count: number; reply_count: number }[]>`select like_count, reply_count from posts where sig = ${parent}`);
    expect(p).toMatchObject({ like_count: 1, reply_count: 1 });
  });

  it('applies like and unlike by chain order, whatever order they arrive in', async () => {
    const post = fakeSig('post');
    const seq = [
      tx(post, 1, [posted('alice', 'x')]),
      tx(fakeSig('l1'), 2, [{ kind: 'like', ...base('bob'), post }]),
      tx(fakeSig('u1'), 3, [{ kind: 'unlike', ...base('bob'), post }]),
      tx(fakeSig('l2'), 4, [{ kind: 'like', ...base('bob'), post }]),
    ];
    await applyTransactions(sql, [seq[3]!, seq[1]!, seq[2]!, seq[0]!]);
    const p = await one(sql<{ like_count: number }[]>`select like_count from posts where sig = ${post}`);
    expect(p.like_count).toBe(1);
  });

  it('a like that arrives before its post still counts', async () => {
    const post = fakeSig('post');
    await applyTransactions(sql, [tx(fakeSig('l'), 5, [{ kind: 'like', ...base('bob'), post }])]);
    await applyTransactions(sql, [tx(post, 4, [posted('alice', 'x')])]);
    const p = await one(sql<{ like_count: number }[]>`select like_count from posts where sig = ${post}`);
    expect(p.like_count).toBe(1);
  });

  it('a delete only counts when it comes from the author', async () => {
    const post = fakeSig('post');
    await applyTransactions(sql, [
      tx(post, 1, [posted('alice', 'x')]),
      tx(fakeSig('d'), 2, [{ kind: 'delete_post', ...base('mallory'), post }]),
    ]);
    expect((await one(sql<{ deleted: boolean }[]>`select deleted from posts where sig = ${post}`)).deleted).toBe(false);
    await applyTransactions(sql, [tx(fakeSig('d2'), 3, [{ kind: 'delete_post', ...base('alice'), post }])]);
    expect((await one(sql<{ deleted: boolean }[]>`select deleted from posts where sig = ${post}`)).deleted).toBe(true);
  });

  it('a delete that arrives before its post still deletes it', async () => {
    const post = fakeSig('post');
    await applyTransactions(sql, [tx(fakeSig('d'), 2, [{ kind: 'delete_post', ...base('alice'), post }])]);
    await applyTransactions(sql, [tx(post, 1, [posted('alice', 'x')])]);
    expect((await one(sql<{ deleted: boolean }[]>`select deleted from posts where sig = ${post}`)).deleted).toBe(true);
  });

  it('deleting a reply lowers the parent count', async () => {
    const parent = fakeSig('parent');
    const reply = fakeSig('reply');
    await applyTransactions(sql, [
      tx(parent, 1, [posted('alice', 'x')]),
      tx(reply, 2, [posted('bob', 'y', parent)]),
    ]);
    expect((await one(sql<{ reply_count: number }[]>`select reply_count from posts where sig = ${parent}`)).reply_count).toBe(1);
    await applyTransactions(sql, [tx(fakeSig('d'), 3, [{ kind: 'delete_post', ...base('bob'), post: reply }])]);
    expect((await one(sql<{ reply_count: number }[]>`select reply_count from posts where sig = ${parent}`)).reply_count).toBe(0);
  });

  it('keeps follower and following counts', async () => {
    const f: UproarEvent = { kind: 'follow', ...base('bob'), target: prof('alice') };
    const u: UproarEvent = { kind: 'unfollow', ...base('bob'), target: prof('alice') };
    await applyTransactions(sql, [tx(fakeSig('f'), 1, [f])]);
    const counts = async () => ({
      a: (await one(sql<{ follower_count: number }[]>`select follower_count from profiles where address = ${prof('alice')}`)).follower_count,
      b: (await one(sql<{ following_count: number }[]>`select following_count from profiles where address = ${prof('bob')}`)).following_count,
    });
    expect(await counts()).toEqual({ a: 1, b: 1 });
    await applyTransactions(sql, [tx(fakeSig('u'), 2, [u])]);
    expect(await counts()).toEqual({ a: 0, b: 0 });
  });

  it('set_profile is last-write-wins by chain order', async () => {
    const sp = (name: string): UproarEvent => ({ kind: 'set_profile', ...base('alice'), name, bio: '', website: '', location: '', avatarSeed: 1, accent: 0 });
    await applyTransactions(sql, [tx(fakeSig('b'), 9, [sp('newer')])]);
    await applyTransactions(sql, [tx(fakeSig('a'), 8, [sp('older')])]);
    expect((await one(sql<{ name: string }[]>`select name from profiles where address = ${prof('alice')}`)).name).toBe('newer');
  });

  it('pin is last-write-wins and None clears it', async () => {
    const a = fakeSig('pa');
    await applyTransactions(sql, [tx(fakeSig('1'), 1, [{ kind: 'pin', ...base('alice'), post: a }])]);
    expect((await one(sql<{ pinned_post: string }[]>`select pinned_post from profiles`)).pinned_post).toBe(a);
    await applyTransactions(sql, [tx(fakeSig('2'), 2, [{ kind: 'pin', ...base('alice'), post: null }])]);
    expect((await one(sql<{ pinned_post: string | null }[]>`select pinned_post from profiles`)).pinned_post).toBeNull();
  });

  it('rotation moves the authority', async () => {
    await applyTransactions(sql, [
      tx(fakeSig('a'), 1, [created('alice')]),
      tx(fakeSig('r'), 2, [{ kind: 'rotate_authority', authority: wallet('alice'), newAuthority: wallet('new'), profile: prof('alice') }]),
    ]);
    const p = await one(sql<{ authority: string; creator: string }[]>`select authority, creator from profiles`);
    expect(p).toEqual({ authority: wallet('new'), creator: wallet('alice') });
  });

  it('close and recreate tracks the closed flag', async () => {
    await applyTransactions(sql, [
      tx(fakeSig('a'), 1, [created('alice')]),
      tx(fakeSig('c'), 2, [{ kind: 'close_profile', authority: wallet('alice'), profile: prof('alice') }]),
    ]);
    expect((await one(sql<{ closed: boolean }[]>`select closed from profiles`)).closed).toBe(true);
    await applyTransactions(sql, [tx(fakeSig('a2'), 3, [created('alice')])]);
    expect((await one(sql<{ closed: boolean }[]>`select closed from profiles`)).closed).toBe(false);
  });
});

describe('handle ownership', () => {
  const holder = async (h: string) => (await sql<{ holder: string | null }[]>`select holder from handles where handle = ${h}`)[0]?.holder ?? null;
  const handleOf = async (n: string) => (await sql<{ handle: string | null }[]>`select handle from profiles where address = ${prof(n)}`)[0]?.handle ?? null;

  it('frees the name on release', async () => {
    await applyTransactions(sql, [tx(fakeSig('1'), 1, [claimed('a', 'name')]), tx(fakeSig('2'), 2, [released('a', 'name')])]);
    expect(await holder('name')).toBeNull();
    expect(await handleOf('a')).toBeNull();
  });

  it('moves on transfer', async () => {
    await applyTransactions(sql, [tx(fakeSig('1'), 1, [claimed('a', 'name')]), tx(fakeSig('2'), 2, [transferred('a', 'b', 'name')])]);
    expect(await holder('name')).toBe(prof('b'));
    expect(await handleOf('a')).toBeNull();
    expect(await handleOf('b')).toBe('name');
  });

  it('resolves a whole ownership chain inside one slot, whose signature order disagrees with execution', async () => {
    // Chain order: a claims, a releases, b claims, all in slot 7. Signature order is chosen so that
    // sorting by signature would replay them backward and wrongly leave the name with a.
    const sigs = ['claim-a', 'release-a', 'claim-b'].map(fakeSig);
    const sorted = [...sigs].sort();
    const [late, mid, early] = [sorted[2]!, sorted[1]!, sorted[0]!];
    const history = [tx(late, 7, [claimed('a', 'name')]), tx(mid, 7, [released('a', 'name')]), tx(early, 7, [claimed('b', 'name')])];
    await applyTransactions(sql, history);
    expect(await holder('name')).toBe(prof('b'));
    expect(await handleOf('b')).toBe('name');
    expect(await handleOf('a')).toBeNull();
  });

  it('a release that arrives before its claim settles once both are in', async () => {
    await applyTransactions(sql, [tx(fakeSig('2'), 2, [released('a', 'name')])]);
    await applyTransactions(sql, [tx(fakeSig('3'), 3, [claimed('b', 'name')])]);
    await applyTransactions(sql, [tx(fakeSig('1'), 1, [claimed('a', 'name')])]);
    expect(await holder('name')).toBe(prof('b'));
    expect(await handleOf('b')).toBe('name');
    expect(await handleOf('a')).toBeNull();
  });
});

describe('sessions', () => {
  const session = async (s: string) => (await sql<{ closed: boolean; expires_at: Date }[]>`select closed, expires_at from sessions where address = ${s}`)[0];

  it('tracks expiry and closing, including re-creation of the same address', async () => {
    const s = sess('a', 'd');
    const open = (expiresAt: number): UproarEvent => ({ kind: 'create_session', authority: wallet('a'), profile: prof('a'), delegate: wallet('d'), session: s, expiresAt, fuel: 0 });
    await applyTransactions(sql, [tx(fakeSig('1'), 1, [open(1_800_000_100)])]);
    expect((await session(s))?.closed).toBe(false);
    await applyTransactions(sql, [tx(fakeSig('3'), 3, [{ kind: 'close_session', signer: wallet('a'), session: s, rentPayer: wallet('a') }])]);
    expect((await session(s))?.closed).toBe(true);
    await applyTransactions(sql, [tx(fakeSig('4'), 4, [open(1_800_000_400)])]);
    const after = await session(s);
    expect(after?.closed).toBe(false);
    expect(after?.expires_at.getTime()).toBe(1_800_000_400_000);
  });

  it('extend updates expiry by chain order', async () => {
    const s = sess('a', 'd');
    await applyTransactions(sql, [
      tx(fakeSig('1'), 1, [{ kind: 'create_session', authority: wallet('a'), profile: prof('a'), delegate: wallet('d'), session: s, expiresAt: 1_800_000_100, fuel: 0 }]),
      tx(fakeSig('3'), 3, [{ kind: 'extend_session', authority: wallet('a'), profile: prof('a'), delegate: wallet('d'), session: s, expiresAt: 1_800_000_300, fuel: 0 }]),
      tx(fakeSig('2'), 2, [{ kind: 'extend_session', authority: wallet('a'), profile: prof('a'), delegate: wallet('d'), session: s, expiresAt: 1_800_000_200, fuel: 0 }]),
    ]);
    expect((await session(s))?.expires_at.getTime()).toBe(1_800_000_300_000);
  });
});

/**
 * A simulator that follows the chain's own rules, so generated histories are all ones the program
 * could really have accepted. It also keeps the true final ownership, to check correctness against.
 */
function simulate(seed: number, count: number) {
  const r = rng(seed);
  const users = Array.from({ length: 12 }, (_, i) => `u${i}`);
  const names = Array.from({ length: 8 }, (_, i) => `name${i}`);
  const holderOf = new Map<string, string>();
  const handleOf = new Map<string, string>();
  const posts: { sig: string; author: string }[] = [];
  const history: IndexedTx[] = [];
  let slot = 100;

  const emit = (label: string, events: UproarEvent[]) => {
    // Several transactions often share a slot, which is the hard case for ordering.
    if (r(3) === 0) slot += 1 + r(3);
    const sig = fakeSig(`${seed}:${label}:${history.length}`);
    history.push(tx(sig, slot, events));
    return sig;
  };

  for (const u of users) emit(`create:${u}`, [created(u)]);

  for (let i = 0; i < count; i++) {
    const u = users[r(users.length)] as string;
    const v = users[r(users.length)] as string;
    const name = names[r(names.length)] as string;
    switch (r(13)) {
      case 0:
        if (!holderOf.has(name) && !handleOf.has(u)) {
          emit('claim', [claimed(u, name)]);
          holderOf.set(name, u);
          handleOf.set(u, name);
        }
        break;
      case 1: {
        const h = handleOf.get(u);
        if (h) {
          emit('release', [released(u, h)]);
          holderOf.delete(h);
          handleOf.delete(u);
        }
        break;
      }
      case 2: {
        const h = handleOf.get(u);
        if (h && u !== v && !handleOf.has(v)) {
          emit('transfer', [transferred(u, v, h)]);
          holderOf.set(h, v);
          handleOf.delete(u);
          handleOf.set(v, h);
        }
        break;
      }
      case 3:
      case 4:
      case 5: {
        const parent = posts.length && r(2) ? (posts[r(posts.length)] as { sig: string }).sig : null;
        const quote = posts.length && r(4) === 0 ? (posts[r(posts.length)] as { sig: string }).sig : null;
        const sig = emit('post', [posted(u, `text ${i} #tag${r(3)} @name${r(8)}`, parent, quote)]);
        posts.push({ sig, author: u });
        break;
      }
      case 6:
      case 7:
        if (posts.length) emit('like', [{ kind: r(3) ? 'like' : 'unlike', ...base(u), post: (posts[r(posts.length)] as { sig: string }).sig }]);
        break;
      case 8:
        if (posts.length) emit('repost', [{ kind: r(3) ? 'repost' : 'unrepost', ...base(u), post: (posts[r(posts.length)] as { sig: string }).sig }]);
        break;
      case 9:
        if (u !== v) emit('follow', [{ kind: r(3) ? 'follow' : 'unfollow', ...base(u), target: prof(v) }]);
        break;
      case 10:
        if (posts.length) {
          const p = posts[r(posts.length)] as { sig: string; author: string };
          emit('delete', [{ kind: 'delete_post', ...base(p.author), post: p.sig }]);
        }
        break;
      case 11:
        emit('meta', [{ kind: 'set_profile', ...base(u), name: `name ${i}`, bio: 'b', website: '', location: '', avatarSeed: i, accent: i % 4 }]);
        break;
      case 12:
        if (posts.length) emit('pin', [{ kind: 'pin', ...base(u), post: r(2) ? (posts[r(posts.length)] as { sig: string }).sig : null }]);
        break;
    }
  }
  return { history, holderOf };
}

describe('determinism proofs', () => {
  it.each([1, 2, 3])('shuffled arrival, batched arrival, and full rebuild all reach one state hash (seed %i)', async (seed) => {
    const { history, holderOf } = simulate(seed, 500);
    expect(history.length).toBeGreaterThan(200);

    const sorted = [...history].sort((a, b) => a.slot - b.slot || (a.sig < b.sig ? -1 : 1));
    await applyTransactions(sql, sorted);
    const expected = await stateHash(sql);

    // The simulator's ground truth: the projection isn't just self-consistent, it's correct.
    const holders = await sql<{ handle: string; holder: string | null }[]>`select handle, holder from handles where holder is not null`;
    const actual = Object.fromEntries(holders.map((h) => [h.handle, h.holder]));
    const truth = Object.fromEntries([...holderOf].map(([h, u]) => [h, prof(u)]));
    expect(actual).toEqual(truth);

    // Wipe the projection and rebuild it from the event log alone.
    await rebuild(sql);
    expect(await stateHash(sql)).toBe(expected);

    // Fresh schema, one transaction at a time, shuffled.
    const second = await testDb();
    try {
      for (const t of shuffled(history, seed * 31 + 1)) await applyTransactions(second.sql, [t]);
      expect(await stateHash(second.sql)).toBe(expected);
    } finally {
      await second.drop();
    }

    // Fresh schema, reversed, in random-sized batches.
    const third = await testDb();
    try {
      const reversed = [...history].reverse();
      for (let i = 0; i < reversed.length; ) {
        const size = 1 + ((i * 7 + seed) % 23);
        await applyTransactions(third.sql, reversed.slice(i, i + size));
        i += size;
      }
      expect(await stateHash(third.sql)).toBe(expected);
    } finally {
      await third.drop();
    }
  }, 180_000);

  it('the state hash changes when any state changes', async () => {
    await applyTransactions(sql, [tx(fakeSig('1'), 1, [posted('alice', 'x')])]);
    const before = await stateHash(sql);
    await sql`update posts set text = 'tampered'`;
    expect(await stateHash(sql)).not.toBe(before);
  });

  it('concurrent ingest does not lose counts', async () => {
    const post = fakeSig('post');
    await applyTransactions(sql, [tx(post, 1, [posted('alice', 'x')])]);
    const likes = Array.from({ length: 40 }, (_, i) => tx(fakeSig(`l${i}`), 2 + i, [{ kind: 'like', ...base(`u${i}`), post }]));
    await Promise.all(likes.map((t) => applyTransactions(sql, [t])));
    expect((await one(sql<{ like_count: number }[]>`select like_count from posts where sig = ${post}`)).like_count).toBe(40);
  });
});
