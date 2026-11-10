import type { Sql } from '@uproar/indexer-core';
import { hide, label, unhide, withhold } from '@uproar/safety';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as q from '../lib/server/queries';
import { World, addr, prof, testDb } from './helpers';

let sql: Sql;
let drop: () => Promise<void>;
let w: World;

beforeEach(async () => {
  ({ sql, drop } = await testDb());
  w = new World(sql);
  await w.user('alice', 'Alice');
  await w.user('bob', 'Bob');
  await w.user('carol', 'Carol');
});
afterEach(async () => drop());

const ctx = (over: Partial<q.Ctx> = {}): q.Ctx => ({ sql, country: 'US', viewer: null, ...over });
const sigs = (items: { post: { sig: string } }[]) => items.map((i) => i.post.sig);

/**
 * The legal core of the app. A hidden or withheld post must be gone from every read surface, and
 * no surface may ever return its text. This table is that list of surfaces.
 */
async function everySurface(c: q.Ctx, post: string, needle: string, tag: string): Promise<Record<string, boolean>> {
  const follower = { ...c, viewer: prof('bob') };
  const feeds = {
    forYou: await q.feedForYou(c, {}),
    following: await q.feedFollowing(follower, {}),
    latest: await q.feedLatest(c, {}),
    tag: await q.tagFeed(c, tag, {}),
    search: await q.searchPosts(c, needle, {}),
    profile: await q.profileFeed(c, prof('alice'), { tab: 'posts' }),
    likes: await q.profileFeed(c, prof('bob'), { tab: 'likes' }),
    notifications: await q.notifications({ ...c, viewer: prof('carol') }, {}),
  };
  const out: Record<string, boolean> = {};
  for (const [name, feed] of Object.entries(feeds)) {
    const text = JSON.stringify(feed);
    out[name] = text.includes(post) || text.includes(needle);
  }
  return out;
}

describe('a hidden post is gone everywhere', () => {
  async function scene() {
    await w.follow('bob', 'alice');
    const needle = 'visible needle text';
    const post = await w.post('alice', `${needle} #needle @carol`);
    await w.like('bob', post);
    return { post, needle };
  }

  it('is present on every surface before anything happens (the test can see it)', async () => {
    const { post, needle } = await scene();
    const surfaces = await everySurface(ctx(), post, needle, 'needle');
    expect(surfaces).toEqual({ forYou: true, following: true, latest: true, tag: true, search: true, profile: true, likes: true, notifications: true });
  });

  it('disappears from every surface when hidden', async () => {
    const { post, needle } = await scene();
    await hide(sql, { targetType: 'post', target: post, reasonCode: 'threat', actor: 'op' });
    const surfaces = await everySurface(ctx(), post, needle, 'needle');
    expect(Object.values(surfaces).every((v) => v === false), JSON.stringify(surfaces)).toBe(true);
  });

  it('disappears from every surface in the withheld country, and only there', async () => {
    const { post, needle } = await scene();
    await withhold(sql, { targetType: 'post', target: post, reasonCode: 'legal_order', actor: 'op', countries: ['IN'] });
    const inIndia = await everySurface(ctx({ country: 'IN' }), post, needle, 'needle');
    expect(Object.values(inIndia).every((v) => v === false), JSON.stringify(inIndia)).toBe(true);
    const elsewhere = await everySurface(ctx({ country: 'US' }), post, needle, 'needle');
    expect(Object.values(elsewhere).every((v) => v === true), JSON.stringify(elsewhere)).toBe(true);
  });

  it('disappears from every surface when its author is hidden', async () => {
    const { post, needle } = await scene();
    await hide(sql, { targetType: 'profile', target: prof('alice'), reasonCode: 'threat', actor: 'op' });
    const surfaces = await everySurface(ctx(), post, needle, 'needle');
    expect(Object.values(surfaces).every((v) => v === false), JSON.stringify(surfaces)).toBe(true);
  });

  it('disappears in the withheld country when its author is withheld, and only there', async () => {
    const { post, needle } = await scene();
    await withhold(sql, { targetType: 'profile', target: prof('alice'), reasonCode: 'legal_order', actor: 'op', countries: ['IN'] });
    const inIndia = await everySurface(ctx({ country: 'IN' }), post, needle, 'needle');
    expect(Object.values(inIndia).every((v) => v === false), JSON.stringify(inIndia)).toBe(true);
    const elsewhere = await everySurface(ctx({ country: 'US' }), post, needle, 'needle');
    expect(Object.values(elsewhere).every((v) => v === true), JSON.stringify(elsewhere)).toBe(true);
  });

  it('comes back when unhidden', async () => {
    const { post, needle } = await scene();
    await hide(sql, { targetType: 'post', target: post, reasonCode: 'threat', actor: 'op' });
    await unhide(sql, { targetType: 'post', target: post, reasonCode: 'review', actor: 'op' });
    const surfaces = await everySurface(ctx(), post, needle, 'needle');
    expect(Object.values(surfaces).every((v) => v === true)).toBe(true);
  });

  it('is gone when the author deletes it', async () => {
    const { post, needle } = await scene();
    await w.deletePost('alice', post);
    const surfaces = await everySurface(ctx(), post, needle, 'needle');
    expect(Object.values(surfaces).every((v) => v === false), JSON.stringify(surfaces)).toBe(true);
  });

  it('a permalink shows a tombstone with the reason and never the text', async () => {
    const { post, needle } = await scene();
    await hide(sql, { targetType: 'post', target: post, reasonCode: 'threat', actor: 'op', publicNote: 'A credible threat' });
    const view = await q.getPost(ctx(), post);
    expect(view?.text).toBeNull();
    expect(view?.author).toBeNull();
    expect(view?.tombstone).toMatchObject({ kind: 'removed', reason: 'threat', note: 'A credible threat' });
    expect(JSON.stringify(view)).not.toContain(needle);
  });

  it('a withheld permalink says which country and never the text', async () => {
    const { post, needle } = await scene();
    await withhold(sql, { targetType: 'post', target: post, reasonCode: 'legal_order', actor: 'op', countries: ['IN'] });
    const view = await q.getPost(ctx({ country: 'IN' }), post);
    expect(view?.tombstone).toMatchObject({ kind: 'withheld', countries: ['IN'] });
    expect(JSON.stringify(view)).not.toContain(needle);
    const elsewhere = await q.getPost(ctx({ country: 'US' }), post);
    expect(elsewhere?.text).toContain(needle);
    expect(elsewhere?.tombstone).toBeNull();
  });

  it('a quote of a hidden post shows a tombstone in place of the quoted text', async () => {
    const { post, needle } = await scene();
    const quote = await w.post('bob', 'look at this', { quoteOf: post });
    await hide(sql, { targetType: 'post', target: post, reasonCode: 'threat', actor: 'op' });
    const view = await q.getPost(ctx(), quote);
    expect(view?.text).toBe('look at this');
    expect(view?.quoted?.tombstone).toMatchObject({ kind: 'removed' });
    expect(JSON.stringify(view)).not.toContain(needle);
  });

  it('a reply to a hidden post keeps its own text and shows the parent as a tombstone', async () => {
    const { post, needle } = await scene();
    const reply = await w.post('bob', 'replying here', { replyTo: post });
    await hide(sql, { targetType: 'post', target: post, reasonCode: 'threat', actor: 'op' });
    const thread = await q.getThread(ctx(), reply);
    expect(thread?.post.text).toBe('replying here');
    expect(thread?.ancestors.map((a) => a.tombstone?.kind)).toEqual(['removed']);
    expect(JSON.stringify(thread)).not.toContain(needle);
  });

  it('a hidden reply is gone from the thread', async () => {
    const parent = await w.post('alice', 'parent');
    const reply = await w.post('bob', 'secret reply', { replyTo: parent });
    await hide(sql, { targetType: 'post', target: reply, reasonCode: 'threat', actor: 'op' });
    const thread = await q.getThread(ctx(), parent);
    expect(thread?.replies).toEqual([]);
    expect(JSON.stringify(thread)).not.toContain('secret reply');
  });

  it('a hidden pinned post is not shown on the profile', async () => {
    const post = await w.post('alice', 'pinned secret');
    await w.pin('alice', post);
    await hide(sql, { targetType: 'post', target: post, reasonCode: 'threat', actor: 'op' });
    const profile = await q.getProfileByHandle(ctx(), 'alice');
    expect(profile?.pinned).toBeNull();
    expect(JSON.stringify(profile)).not.toContain('pinned secret');
  });

  it('a hidden post stops counting toward trends', async () => {
    const a = await w.post('alice', '#hot one');
    const b = await w.post('bob', '#hot two');
    expect((await q.trends(ctx())).map((t) => t.tag)).toContain('hot');
    await hide(sql, { targetType: 'post', target: a, reasonCode: 'threat', actor: 'op' });
    await hide(sql, { targetType: 'post', target: b, reasonCode: 'threat', actor: 'op' });
    expect((await q.trends(ctx())).map((t) => t.tag)).not.toContain('hot');
  });

  it('a bookmarked post that is later hidden is not returned', async () => {
    const post = await w.post('alice', 'bookmarked secret');
    await sql`insert into bookmarks (profile, post) values (${prof('bob')}, ${post})`;
    const c = ctx({ viewer: prof('bob') });
    expect(sigs((await q.bookmarks(c, {})).items)).toEqual([post]);
    await hide(sql, { targetType: 'post', target: post, reasonCode: 'threat', actor: 'op' });
    expect((await q.bookmarks(c, {})).items).toEqual([]);
  });
});

describe('a hidden profile', () => {
  it('shows a tombstone and leaks no profile fields', async () => {
    await hide(sql, { targetType: 'profile', target: prof('alice'), reasonCode: 'threat', actor: 'op' });
    const view = await q.getProfileByHandle(ctx(), 'alice');
    expect(view?.tombstone).toMatchObject({ kind: 'removed' });
    expect(JSON.stringify(view)).not.toContain('bio of alice');
    expect(view?.profile.name).toBe('');
  });

  it('does not appear in search, who to follow or recent handles', async () => {
    await hide(sql, { targetType: 'profile', target: prof('alice'), reasonCode: 'threat', actor: 'op' });
    expect((await q.searchProfiles(ctx(), 'alice', {})).items).toEqual([]);
    expect((await q.whoToFollow(ctx(), 10)).map((p) => p.handle)).not.toContain('alice');
    expect((await q.recentHandles(ctx(), 10)).map((h) => h.handle)).not.toContain('alice');
  });

  it('is withheld by country', async () => {
    await withhold(sql, { targetType: 'profile', target: prof('alice'), reasonCode: 'legal_order', actor: 'op', countries: ['IN'] });
    expect((await q.getProfileByHandle(ctx({ country: 'IN' }), 'alice'))?.tombstone?.kind).toBe('withheld');
    expect((await q.getProfileByHandle(ctx({ country: 'US' }), 'alice'))?.tombstone).toBeNull();
  });
});

describe('notifications from or about a hidden account', () => {
  async function scene() {
    const post = await w.post('alice', 'hello');
    await w.like('bob', post);
    await w.follow('bob', 'alice');
    return post;
  }
  const kinds = async (c: q.Ctx) => (await q.notifications(c, {})).items.map((n) => n.kind);

  it('a hidden account produces no notifications at all', async () => {
    await scene();
    const alice = ctx({ viewer: prof('alice') });
    expect((await kinds(alice)).sort()).toEqual(['follow', 'like']);
    await hide(sql, { targetType: 'profile', target: prof('bob'), reasonCode: 'threat', actor: 'op' });
    expect(await kinds(alice)).toEqual([]);
  });

  it('an account withheld in this country produces none here, and still does elsewhere', async () => {
    await scene();
    await withhold(sql, { targetType: 'profile', target: prof('bob'), reasonCode: 'legal_order', actor: 'op', countries: ['IN'] });
    expect(await kinds(ctx({ viewer: prof('alice'), country: 'IN' }))).toEqual([]);
    expect((await kinds(ctx({ viewer: prof('alice'), country: 'US' }))).sort()).toEqual(['follow', 'like']);
  });

  it('activity on a post whose author is hidden is dropped, even for that author', async () => {
    await scene();
    await hide(sql, { targetType: 'profile', target: prof('alice'), reasonCode: 'threat', actor: 'op' });
    // The follow names no post, so it stays. The like is about a hidden post, so it goes.
    expect(await kinds(ctx({ viewer: prof('alice') }))).toEqual(['follow']);
  });
});

describe('private filters', () => {
  it('blocks and mutes remove an author from the viewer\'s feeds only', async () => {
    const post = await w.post('alice', 'hello');
    const bob = ctx({ viewer: prof('bob') });
    await sql`insert into mutes (profile, target) values (${prof('bob')}, ${prof('alice')})`;
    expect(sigs((await q.feedLatest(bob, {})).items)).toEqual([]);
    expect(sigs((await q.feedLatest(ctx({ viewer: prof('carol') }), {})).items)).toEqual([post]);
    await sql`delete from mutes`;
    await sql`insert into blocks (profile, target) values (${prof('bob')}, ${prof('alice')})`;
    expect(sigs((await q.feedLatest(bob, {})).items)).toEqual([]);
  });

  it('muted words are matched case-insensitively', async () => {
    await w.post('alice', 'Crypto Talk');
    const keep = await w.post('alice', 'something else');
    await sql`insert into muted_words (profile, word) values (${prof('bob')}, 'crypto')`;
    expect(sigs((await q.feedLatest(ctx({ viewer: prof('bob') }), {})).items)).toEqual([keep]);
  });

  it('blocked accounts do not produce notifications', async () => {
    const post = await w.post('alice', 'hello');
    await w.like('bob', post);
    const alice = ctx({ viewer: prof('alice') });
    expect((await q.notifications(alice, {})).items.map((n) => n.kind)).toContain('like');
    await sql`insert into blocks (profile, target) values (${prof('alice')}, ${prof('bob')})`;
    expect((await q.notifications(alice, {})).items).toEqual([]);
  });
});

describe('labels', () => {
  it('spam is hidden by default and a viewer can choose to see it', async () => {
    const post = await w.post('alice', 'buy now');
    await label(sql, { targetType: 'post', target: post, label: 'spam', reasonCode: 'review', actor: 'op' });
    expect(sigs((await q.feedLatest(ctx(), {})).items)).toEqual([]);
    await sql`insert into label_prefs (profile, label, action) values (${prof('bob')}, 'spam', 'show')`;
    const seen = await q.feedLatest(ctx({ viewer: prof('bob') }), {});
    expect(sigs(seen.items)).toEqual([post]);
    expect(seen.items[0]?.post.labels).toEqual(['spam']);
  });

  it('warn labels stay in the feed with the label attached', async () => {
    const post = await w.post('alice', 'graphic thing');
    await label(sql, { targetType: 'post', target: post, label: 'graphic', reasonCode: 'review', actor: 'op' });
    const feed = await q.feedLatest(ctx(), {});
    expect(sigs(feed.items)).toEqual([post]);
    expect(feed.items[0]?.post.labels).toEqual(['graphic']);
  });

  it('a viewer can hide a label that is shown by default', async () => {
    const post = await w.post('alice', 'rude thing');
    await label(sql, { targetType: 'post', target: post, label: 'rude', reasonCode: 'review', actor: 'op' });
    expect(sigs((await q.feedLatest(ctx(), {})).items)).toEqual([post]);
    await sql`insert into label_prefs (profile, label, action) values (${prof('bob')}, 'rude', 'hide')`;
    expect((await q.feedLatest(ctx({ viewer: prof('bob') }), {})).items).toEqual([]);
  });
});

describe('feeds', () => {
  it('Following shows followed authors and their reposts, newest first, and pages without gaps', async () => {
    await w.follow('bob', 'alice');
    const a1 = await w.post('alice', 'one');
    const c1 = await w.post('carol', 'not followed');
    const a2 = await w.post('alice', 'two');
    await w.repost('alice', c1);
    const bob = ctx({ viewer: prof('bob') });
    const page1 = await q.feedFollowing(bob, { limit: 2 });
    expect(page1.items.map((i) => [i.post.sig, i.repostedBy?.handle ?? null])).toEqual([[c1, 'alice'], [a2, null]]);
    const page2 = await q.feedFollowing(bob, { limit: 2, cursor: page1.nextCursor ?? undefined });
    expect(sigs(page2.items)).toEqual([a1]);
    expect(page2.nextCursor).toBeNull();
  });

  it('Following is empty without a viewer', async () => {
    await w.post('alice', 'one');
    expect((await q.feedFollowing(ctx(), {})).items).toEqual([]);
  });

  it('replies do not appear in the main feeds', async () => {
    const parent = await w.post('alice', 'parent');
    await w.post('bob', 'reply', { replyTo: parent });
    expect(sigs((await q.feedLatest(ctx(), {})).items)).toEqual([parent]);
    expect(sigs((await q.feedForYou(ctx(), {})).items)).toEqual([parent]);
  });

  it('For You follows the published formula', async () => {
    const fresh = await w.post('alice', 'fresh no engagement', { ageHours: 0 });
    const popular = await w.post('bob', 'older but loved', { ageHours: 6 });
    for (const who of ['alice', 'carol']) {
      await w.like(who, popular);
      await w.repost(who, popular);
    }
    await w.post('carol', 'quote', { quoteOf: popular, ageHours: 400 });
    const stale = await w.post('carol', 'ancient', { ageHours: 400 });
    const feed = await q.feedForYou(ctx(), {});
    const order = sigs(feed.items);
    const expected = [
      [fresh, (1 + 0) / Math.pow(0 + 2, 1.5)],
      [popular, (1 + 2 + 4 + 2) / Math.pow(6 + 2, 1.5)],
    ].sort((a, b) => (b[1] as number) - (a[1] as number)).map((x) => x[0]);
    expect(order.slice(0, 2)).toEqual(expected);
    expect(order.indexOf(stale)).toBeGreaterThan(1);
  });

  it('For You boosts people you follow, for that viewer only', async () => {
    const a = await w.post('alice', 'a', { ageHours: 1 });
    const c = await w.post('carol', 'c', { ageHours: 1 });
    await w.follow('bob', 'carol');
    const anon = sigs((await q.feedForYou(ctx(), {})).items);
    const bob = sigs((await q.feedForYou(ctx({ viewer: prof('bob') }), {})).items);
    expect(bob[0]).toBe(c);
    expect(anon).toContain(a);
  });

  it('For You discounts repeat posts by one author', async () => {
    const a = [await w.post('alice', '1', { ageHours: 1 }), await w.post('alice', '2', { ageHours: 1 }), await w.post('alice', '3', { ageHours: 1 })];
    const b = await w.post('bob', 'x', { ageHours: 1 });
    const order = sigs((await q.feedForYou(ctx(), {})).items);
    expect(order.indexOf(b)).toBeLessThan(2);
    expect(order).toEqual(expect.arrayContaining(a));
  });

  it('For You pages without repeats', async () => {
    for (let i = 0; i < 7; i++) await w.post('alice', `post ${i}`, { ageHours: i });
    const p1 = await q.feedForYou(ctx(), { limit: 3 });
    const p2 = await q.feedForYou(ctx(), { limit: 3, cursor: p1.nextCursor ?? undefined });
    const p3 = await q.feedForYou(ctx(), { limit: 3, cursor: p2.nextCursor ?? undefined });
    const all = [...sigs(p1.items), ...sigs(p2.items), ...sigs(p3.items)];
    expect(new Set(all).size).toBe(7);
    expect(p3.nextCursor).toBeNull();
  });

  it('a malformed cursor is treated as the first page', async () => {
    const post = await w.post('alice', 'x');
    expect(sigs((await q.feedLatest(ctx(), { cursor: 'garbage' })).items)).toEqual([post]);
    expect(sigs((await q.feedForYou(ctx(), { cursor: 'garbage' })).items)).toEqual([post]);
  });

  it('viewer flags are set for that viewer', async () => {
    const post = await w.post('alice', 'x');
    await w.like('bob', post);
    await w.repost('bob', post);
    await sql`insert into bookmarks (profile, post) values (${prof('bob')}, ${post})`;
    const bob = (await q.getPost(ctx({ viewer: prof('bob') }), post))?.viewer;
    expect(bob).toEqual({ liked: true, reposted: true, bookmarked: true });
    const carol = (await q.getPost(ctx({ viewer: prof('carol') }), post))?.viewer;
    expect(carol).toEqual({ liked: false, reposted: false, bookmarked: false });
  });

  it('search finds posts by word, Hindi included, and accounts by handle and name', async () => {
    const en = await w.post('alice', 'solana is fast');
    const hi = await w.post('alice', 'नमस्ते दुनिया');
    expect(sigs((await q.searchPosts(ctx(), 'solana', {})).items)).toEqual([en]);
    expect(sigs((await q.searchPosts(ctx(), 'नमस्ते', {})).items)).toEqual([hi]);
    expect((await q.searchProfiles(ctx(), 'ali', {})).items.map((p) => p.handle)).toEqual(['alice']);
    expect((await q.searchProfiles(ctx(), 'Carol', {})).items.map((p) => p.handle)).toEqual(['carol']);
  });

  it('search survives hostile input', async () => {
    for (const bad of ["'; drop table posts; --", '%', '\\', '((((', '&&&&', '']) {
      await expect(q.searchPosts(ctx(), bad, {})).resolves.toBeDefined();
      await expect(q.searchProfiles(ctx(), bad, {})).resolves.toBeDefined();
    }
  });

  it('a thread walks up its ancestors and lists replies, most liked first', async () => {
    const root = await w.post('alice', 'root');
    const mid = await w.post('bob', 'mid', { replyTo: root });
    const leaf = await w.post('carol', 'leaf', { replyTo: mid });
    const other = await w.post('alice', 'other reply', { replyTo: mid });
    await w.like('bob', other);
    const thread = await q.getThread(ctx(), mid);
    expect(thread?.ancestors.map((a) => a.sig)).toEqual([root]);
    expect(thread?.replies.map((r) => r.sig)).toEqual([other, leaf]);
  });

  it('a post that is not indexed yet is simply missing', async () => {
    expect(await q.getPost(ctx(), 'x'.repeat(88))).toBeNull();
    expect(await q.getThread(ctx(), 'x'.repeat(88))).toBeNull();
    expect(await q.getProfileByHandle(ctx(), 'nobody')).toBeNull();
  });

  it('notifications cover every kind and never the viewer themself', async () => {
    const post = await w.post('alice', 'hi @alice');
    await w.like('alice', post);
    await w.like('bob', post);
    await w.repost('bob', post);
    await w.post('bob', 'a reply', { replyTo: post });
    await w.post('carol', 'a quote', { quoteOf: post });
    await w.post('carol', 'hey @Alice');
    await w.follow('carol', 'alice');
    const kinds = (await q.notifications(ctx({ viewer: prof('alice') }), {})).items.map((n) => n.kind).sort();
    expect(kinds).toEqual(['follow', 'like', 'mention', 'quote', 'reply', 'repost']);
  });

  it('profile tabs split posts, replies and likes', async () => {
    const own = await w.post('alice', 'own');
    const parent = await w.post('bob', 'parent');
    const reply = await w.post('alice', 'reply', { replyTo: parent });
    await w.like('alice', parent);
    await w.repost('alice', parent);
    expect(sigs((await q.profileFeed(ctx(), prof('alice'), { tab: 'posts' })).items)).toEqual([parent, own]);
    expect(sigs((await q.profileFeed(ctx(), prof('alice'), { tab: 'replies' })).items)).toEqual([reply]);
    expect(sigs((await q.profileFeed(ctx(), prof('alice'), { tab: 'likes' })).items)).toEqual([parent]);
  });

  it('follow lists show who follows whom', async () => {
    await w.follow('bob', 'alice');
    await w.follow('carol', 'alice');
    expect((await q.followList(ctx(), prof('alice'), 'followers', {})).items.map((p) => p.handle).sort()).toEqual(['bob', 'carol']);
    expect((await q.followList(ctx(), prof('bob'), 'following', {})).items.map((p) => p.handle)).toEqual(['alice']);
  });

  it('who to follow leaves out yourself and people you already follow', async () => {
    await w.follow('bob', 'alice');
    const handles = (await q.whoToFollow(ctx({ viewer: prof('bob') }), 10)).map((p) => p.handle);
    expect(handles).toEqual(['carol']);
  });

  it('stats are real counts', async () => {
    await w.post('alice', 'x');
    expect(await q.stats(ctx())).toMatchObject({ handles: 3, posts: 1 });
  });
});

describe('review fixes', () => {
  it('the public wallet lookup never returns a hidden profile\'s fields', async () => {
    const before = await q.profilesOfWallet(ctx(), addr('wallet:alice'));
    expect(before[0]?.bio).toBe('bio of alice');
    await hide(sql, { targetType: 'profile', target: prof('alice'), reasonCode: 'threat', actor: 'op' });
    const [p] = await q.profilesOfWallet(ctx(), addr('wallet:alice'));
    expect(p?.restricted).toBe(true);
    expect(p?.name).toBe('');
    expect(JSON.stringify(p)).not.toContain('bio of alice');
  });

  it('a withheld profile\'s fields are blank in that country through the wallet lookup', async () => {
    await withhold(sql, { targetType: 'profile', target: prof('alice'), reasonCode: 'legal_order', actor: 'op', countries: ['IN'] });
    expect((await q.profilesOfWallet(ctx({ country: 'IN' }), addr('wallet:alice')))[0]?.name).toBe('');
    expect((await q.profilesOfWallet(ctx({ country: 'US' }), addr('wallet:alice')))[0]?.name).toBe('Alice');
  });

  it('a hidden account\'s name doesn\'t show in someone\'s mute list', async () => {
    await sql`insert into mutes (profile, target) values (${prof('bob')}, ${prof('alice')})`;
    expect((await q.preferences(ctx({ viewer: prof('bob') }), prof('bob'))).mutes[0]?.name).toBe('Alice');
    await hide(sql, { targetType: 'profile', target: prof('alice'), reasonCode: 'threat', actor: 'op' });
    expect((await q.preferences(ctx({ viewer: prof('bob') }), prof('bob'))).mutes[0]?.name).toBe('');
  });

  it('previews treat anything withheld in any country as restricted', async () => {
    const post = await w.post('alice', 'withheld somewhere');
    expect(await q.restrictedAnywhere(ctx(), 'post', post)).toBe(false);
    await withhold(sql, { targetType: 'post', target: post, reasonCode: 'legal_order', actor: 'op', countries: ['IN'] });
    expect(await q.restrictedAnywhere(ctx({ country: 'US' }), 'post', post)).toBe(true);
  });
});
