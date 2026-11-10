/**
 * Every read the app makes. This file holds the legal guarantee: a hidden or withheld post is
 * absent from lists and appears as a tombstone at its own URL, with no text and no author. Nothing
 * else in the app reads posts directly, so there's one place to check.
 */
import type { Sql } from '@uproar/indexer-core';
import { LABELS } from '@uproar/safety';

export type Ctx = { sql: Sql; country: string; viewer: string | null };

export type AuthorView = { address: string; handle: string | null; name: string; avatarSeed: number; accent: number };
export type Tombstone = { kind: 'deleted' | 'removed' | 'withheld'; reason?: string | null; note?: string | null; countries?: string[] };
export type ViewerFlags = { liked: boolean; reposted: boolean; bookmarked: boolean };

export type PostView = {
  sig: string;
  author: AuthorView | null;
  text: string | null;
  tombstone: Tombstone | null;
  replyTo: string | null;
  replyingTo: string | null;
  quoteOf: string | null;
  quoted: PostView | null;
  slot: number;
  time: string | null;
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  labels: string[];
  viewer: ViewerFlags;
};

export type FeedItem = { post: PostView; repostedBy: AuthorView | null };
export type Page<T> = { items: T[]; nextCursor: string | null };
type PageOptions = { cursor?: string | undefined; limit?: number | undefined };

export type ProfileView = AuthorView & {
  bio: string;
  website: string;
  location: string;
  followers: number;
  following: number;
  posts: number;
  createdAt: string | null;
  closed: boolean;
};

export type ProfilePage = {
  profile: ProfileView;
  tombstone: Tombstone | null;
  pinned: PostView | null;
  viewer: { following: boolean; followsYou: boolean; muted: boolean; blocked: boolean };
};

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;
const DEFAULT_HIDDEN = Object.entries(LABELS).filter(([, l]) => l.defaultAction === 'hide').map(([k]) => k);

type PostRow = {
  sig: string;
  text: string;
  reply_to: string | null;
  quote_of: string | null;
  slot: string;
  block_time: Date | null;
  deleted: boolean;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  a_address: string;
  a_handle: string | null;
  a_name: string;
  a_seed: number;
  a_accent: number;
  cs_hidden: boolean | null;
  cs_withheld: string[] | null;
  cs_reason: string | null;
  cs_note: string | null;
  acs_hidden: boolean | null;
  acs_withheld: string[] | null;
  acs_reason: string | null;
  acs_note: string | null;
  labels: string[];
  v_liked: boolean;
  v_reposted: boolean;
  v_bookmarked: boolean;
};

const limitOf = (o: PageOptions) => Math.min(Math.max(o.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

// ---- SQL fragments --------------------------------------------------------------------------

const selectPost = ({ sql, viewer }: Ctx) => {
  const v = viewer ?? '';
  return sql`
    p.sig, p.text, p.reply_to, p.quote_of, p.slot::text as slot, p.block_time, p.deleted,
    p.like_count, p.repost_count, p.reply_count, p.quote_count,
    a.address as a_address, a.handle as a_handle, a.name as a_name, a.avatar_seed as a_seed, a.accent as a_accent,
    cs.hidden as cs_hidden, cs.withheld_countries as cs_withheld, cs.reason_code as cs_reason, cs.public_note as cs_note,
    acs.hidden as acs_hidden, acs.withheld_countries as acs_withheld, acs.reason_code as acs_reason, acs.public_note as acs_note,
    coalesce((
      select array_agg(distinct l.label order by l.label) from labels l
      where (l.target_type = 'post' and l.target = p.sig) or (l.target_type = 'profile' and l.target = p.author)
    ), '{}') as labels,
    exists (select 1 from likes x where x.profile = ${v} and x.post = p.sig and x.active) as v_liked,
    exists (select 1 from reposts x where x.profile = ${v} and x.post = p.sig and x.active) as v_reposted,
    exists (select 1 from bookmarks x where x.profile = ${v} and x.post = p.sig) as v_bookmarked`;
};

const postTables = ({ sql }: Ctx) => sql`
  posts p
  join profiles a on a.address = p.author
  left join content_state cs on cs.target_type = 'post' and cs.target = p.sig
  left join content_state acs on acs.target_type = 'profile' and acs.target = p.author`;

/** The rule for every list: not deleted, not hidden, not withheld here, and neither is the author. */
const visible = ({ sql, country }: Ctx) => sql`
  not p.deleted
  and coalesce(cs.hidden, false) = false
  and coalesce(acs.hidden, false) = false
  and not (${country} = any(coalesce(cs.withheld_countries, '{}'::text[])))
  and not (${country} = any(coalesce(acs.withheld_countries, '{}'::text[])))`;

/** What this viewer has chosen not to see. It only changes their own view. */
const viewerFilter = ({ sql, viewer }: Ctx) => {
  const v = viewer ?? '';
  return sql`
    and not exists (select 1 from mutes m where m.profile = ${v} and m.target = p.author)
    and not exists (select 1 from blocks b where b.profile = ${v} and b.target = p.author)
    and not exists (select 1 from muted_words w where w.profile = ${v} and position(lower(w.word) in lower(p.text)) > 0)
    and not exists (
      select 1 from labels l
      left join label_prefs lp on lp.profile = ${v} and lp.label = l.label
      where ((l.target_type = 'post' and l.target = p.sig) or (l.target_type = 'profile' and l.target = p.author))
        and coalesce(lp.action, case when l.label = any(${DEFAULT_HIDDEN}::text[]) then 'hide' else 'show' end) = 'hide'
    )`;
};

// ---- rows to views --------------------------------------------------------------------------

function tombstoneFor(r: PostRow, country: string): Tombstone | null {
  if (r.deleted) return { kind: 'deleted' };
  if (r.cs_hidden) return { kind: 'removed', reason: r.cs_reason, note: r.cs_note };
  if (r.acs_hidden) return { kind: 'removed', reason: r.acs_reason, note: r.acs_note };
  if (r.cs_withheld?.includes(country)) return { kind: 'withheld', reason: r.cs_reason, note: r.cs_note, countries: r.cs_withheld };
  if (r.acs_withheld?.includes(country)) return { kind: 'withheld', reason: r.acs_reason, note: r.acs_note, countries: r.acs_withheld };
  return null;
}

const NO_FLAGS: ViewerFlags = { liked: false, reposted: false, bookmarked: false };

/** A tombstone carries no text, author, counts or quoted post. The only thing left is the reason. */
function toView(r: PostRow, country: string): PostView {
  const tombstone = tombstoneFor(r, country);
  const base = {
    sig: r.sig,
    tombstone,
    replyTo: r.reply_to,
    replyingTo: null,
    quoted: null,
    slot: Number(r.slot),
    time: r.block_time ? r.block_time.toISOString() : null,
  };
  if (tombstone) {
    return { ...base, author: null, text: null, quoteOf: null, likes: 0, reposts: 0, replies: 0, quotes: 0, labels: [], viewer: NO_FLAGS };
  }
  return {
    ...base,
    author: { address: r.a_address, handle: r.a_handle, name: r.a_name, avatarSeed: r.a_seed, accent: r.a_accent },
    text: r.text,
    quoteOf: r.quote_of,
    likes: r.like_count,
    reposts: r.repost_count,
    replies: r.reply_count,
    quotes: r.quote_count,
    labels: r.labels,
    viewer: { liked: r.v_liked, reposted: r.v_reposted, bookmarked: r.v_bookmarked },
  };
}

async function fetchViews(c: Ctx, sigs: readonly string[]): Promise<Map<string, PostView>> {
  if (sigs.length === 0) return new Map();
  const { sql } = c;
  const rows = await sql<PostRow[]>`select ${selectPost(c)} from ${postTables(c)} where p.sig = any(${sigs as string[]})`;
  return new Map(rows.map((r) => [r.sig, toView(r, c.country)]));
}

/** Turns rows into full views, with the quoted post and the handle being replied to attached. */
async function hydrate(c: Ctx, rows: readonly PostRow[]): Promise<PostView[]> {
  const views = rows.map((r) => toView(r, c.country));
  const related = [...new Set(views.flatMap((v) => [v.quoteOf, v.replyTo]).filter((s): s is string => Boolean(s)))];
  const map = await fetchViews(c, related);
  return views.map((v) => ({
    ...v,
    quoted: v.quoteOf ? (map.get(v.quoteOf) ?? null) : null,
    replyingTo: v.replyTo ? (map.get(v.replyTo)?.author?.handle ?? null) : null,
  }));
}

// ---- cursors --------------------------------------------------------------------------------

const encode = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const decode = (c?: string) => (c ? Buffer.from(c, 'base64url').toString('utf8') : '');

function chronoCursor(cursor?: string): { slot: string; sig: string } | null {
  const [slot, sig] = decode(cursor).split(':');
  return slot && sig && /^\d+$/.test(slot) ? { slot, sig } : null;
}

function rankCursor(cursor?: string): { asof: Date; offset: number } {
  const [asof, offset] = decode(cursor).split('|');
  const when = asof ? new Date(asof) : null;
  if (when && !Number.isNaN(when.getTime()) && offset && /^\d+$/.test(offset)) return { asof: when, offset: Number(offset) };
  return { asof: new Date(), offset: 0 };
}

function page<T, R>(rows: readonly R[], limit: number, toItem: (rows: readonly R[]) => Promise<T[]>, cursorOf: (last: R) => string): Promise<Page<T>> {
  const more = rows.length > limit;
  const used = more ? rows.slice(0, limit) : rows;
  return toItem(used).then((items) => ({ items, nextCursor: more ? encode(cursorOf(used[used.length - 1] as R)) : null }));
}

// ---- feeds ----------------------------------------------------------------------------------

type ItemRow = PostRow & { sort_slot: string; sort_sig: string; reposted_by: string | null };

async function authors(c: Ctx, addresses: readonly string[]): Promise<Map<string, AuthorView>> {
  if (addresses.length === 0) return new Map();
  const rows = await c.sql<{ address: string; handle: string | null; name: string; avatar_seed: number; accent: number; hidden: boolean | null; withheld: string[] | null }[]>`
    select p.address, p.handle, p.name, p.avatar_seed, p.accent, cs.hidden, cs.withheld_countries as withheld
    from profiles p left join content_state cs on cs.target_type = 'profile' and cs.target = p.address
    where p.address = any(${addresses as string[]})`;
  return new Map(
    rows.map((r) => {
      const restricted = Boolean(r.hidden) || Boolean(r.withheld?.includes(c.country));
      return [r.address, { address: r.address, handle: r.handle, name: restricted ? '' : r.name, avatarSeed: restricted ? 0 : r.avatar_seed, accent: restricted ? 0 : r.accent }];
    }),
  );
}

async function itemsFrom(c: Ctx, rows: readonly ItemRow[]): Promise<FeedItem[]> {
  const views = await hydrate(c, rows);
  const by = await authors(c, [...new Set(rows.map((r) => r.reposted_by).filter((a): a is string => Boolean(a)))]);
  return views.map((post, i) => ({ post, repostedBy: rows[i]?.reposted_by ? (by.get(rows[i]?.reposted_by as string) ?? null) : null }));
}

const postsPage = (c: Ctx, rows: readonly PostRow[], limit: number) =>
  page<FeedItem, PostRow>(rows, limit, async (used) => (await hydrate(c, used)).map((post) => ({ post, repostedBy: null })), (l) => `${l.slot}:${l.sig}`);

export async function feedLatest(c: Ctx, o: PageOptions): Promise<Page<FeedItem>> {
  const { sql } = c;
  const limit = limitOf(o);
  const at = chronoCursor(o.cursor);
  const rows = await sql<PostRow[]>`
    select ${selectPost(c)} from ${postTables(c)}
    where ${visible(c)} and p.reply_to is null ${viewerFilter(c)}
      ${at ? sql`and (p.slot, p.sig) < (${at.slot}::bigint, ${at.sig}::text collate "C")` : sql``}
    order by p.slot desc, p.sig desc limit ${limit + 1}`;
  return postsPage(c, rows, limit);
}

/** For You ranks this many of the most recent top-level posts. Published on /algorithm. */
export const FOR_YOU_CANDIDATES = 5_000;

/**
 * The For You formula, published on /algorithm. There are no manual picks and no paid boosts:
 *   score = (1 + likes + 2 reposts + 2 quotes + replies) / (hours old + 2)^1.5
 *           x 1.5 if you follow the author
 *           x 0.7^(n-1) for the author's nth post in this feed
 * Scoring runs on lean rows. Full post details are loaded only for the page being returned.
 */
export async function feedForYou(c: Ctx, o: PageOptions): Promise<Page<FeedItem>> {
  const { sql, viewer } = c;
  const limit = limitOf(o);
  const { asof, offset } = rankCursor(o.cursor);
  const v = viewer ?? '';
  const ranked = await sql<{ sig: string; score: number }[]>`
    with p as (
      select p.sig, p.author, p.text, p.deleted, p.block_time, p.like_count, p.repost_count, p.quote_count, p.reply_count
      from posts p
      where not p.deleted and p.reply_to is null
        and coalesce(p.block_time, ${asof}::timestamptz) <= ${asof}::timestamptz
        and coalesce(p.block_time, ${asof}::timestamptz) > ${asof}::timestamptz - interval '30 days'
      order by p.slot desc, p.sig desc
      limit ${FOR_YOU_CANDIDATES}
    ),
    scored as (
      select p.sig, p.author,
        ((1 + p.like_count + 2 * p.repost_count + 2 * p.quote_count + p.reply_count)::float8
          / power(greatest(extract(epoch from (${asof}::timestamptz - coalesce(p.block_time, ${asof}::timestamptz))) / 3600.0, 0) + 2, 1.5))
          * case when exists (select 1 from follows f where f.follower = ${v} and f.followee = p.author and f.active) then 1.5 else 1 end as base_score
      from p
      left join content_state cs on cs.target_type = 'post' and cs.target = p.sig
      left join content_state acs on acs.target_type = 'profile' and acs.target = p.author
      where ${visible(c)} ${viewerFilter(c)}
    ),
    ranked as (
      select sig, base_score * power(0.7, row_number() over (partition by author order by base_score desc, sig) - 1) as score
      from scored
    )
    select sig, score from ranked order by score desc, sig limit ${limit + 1} offset ${offset}`;
  const more = ranked.length > limit;
  const used = more ? ranked.slice(0, limit) : ranked;
  const order = new Map(used.map((r, i) => [r.sig, i]));
  const rows = used.length
    ? await sql<PostRow[]>`select ${selectPost(c)} from ${postTables(c)} where p.sig = any(${used.map((r) => r.sig)})`
    : [];
  rows.sort((a, b) => (order.get(a.sig) ?? 0) - (order.get(b.sig) ?? 0));
  const items = (await hydrate(c, rows)).map((post) => ({ post, repostedBy: null }));
  return { items, nextCursor: more ? encode(`${asof.toISOString()}|${offset + limit}`) : null };
}

export async function feedFollowing(c: Ctx, o: PageOptions): Promise<Page<FeedItem>> {
  if (!c.viewer) return { items: [], nextCursor: null };
  const { sql, viewer, country } = c;
  const limit = limitOf(o);
  const at = chronoCursor(o.cursor);
  const rows = await sql<ItemRow[]>`
    with items as (
      select p2.sig as post_sig, p2.slot as sort_slot, p2.sig as sort_sig, null::text as reposted_by
      from posts p2
      join follows f on f.followee = p2.author and f.follower = ${viewer} and f.active
      where p2.reply_to is null
      union all
      select r.post, r.slot, r.sig, r.profile
      from reposts r
      join follows f on f.followee = r.profile and f.follower = ${viewer} and f.active
      where r.active
    )
    select i.sort_slot::text as sort_slot, i.sort_sig, i.reposted_by, ${selectPost(c)}
    from items i join ${postTables(c)} on p.sig = i.post_sig
    where ${visible(c)} ${viewerFilter(c)}
      and (i.reposted_by is null or not exists (
        select 1 from content_state rcs where rcs.target_type = 'profile' and rcs.target = i.reposted_by
          and (rcs.hidden or ${country} = any(rcs.withheld_countries))))
      and (i.reposted_by is null or not exists (select 1 from mutes m where m.profile = ${viewer} and m.target = i.reposted_by))
      and (i.reposted_by is null or not exists (select 1 from blocks b where b.profile = ${viewer} and b.target = i.reposted_by))
      ${at ? sql`and (i.sort_slot, i.sort_sig) < (${at.slot}::bigint, ${at.sig}::text collate "C")` : sql``}
    order by i.sort_slot desc, i.sort_sig desc limit ${limit + 1}`;
  return page<FeedItem, ItemRow>(rows, limit, (used) => itemsFrom(c, used), (l) => `${l.sort_slot}:${l.sort_sig}`);
}

export async function tagFeed(c: Ctx, tag: string, o: PageOptions): Promise<Page<FeedItem>> {
  const { sql } = c;
  const limit = limitOf(o);
  const at = chronoCursor(o.cursor);
  const clean = tag.replace(/^#/, '').normalize('NFC').toLowerCase();
  const rows = await sql<PostRow[]>`
    select ${selectPost(c)} from post_tags t join ${postTables(c)} on p.sig = t.post
    where t.tag = ${clean} and ${visible(c)} ${viewerFilter(c)}
      ${at ? sql`and (p.slot, p.sig) < (${at.slot}::bigint, ${at.sig}::text collate "C")` : sql``}
    order by p.slot desc, p.sig desc limit ${limit + 1}`;
  return postsPage(c, rows, limit);
}

export async function searchPosts(c: Ctx, query: string, o: PageOptions): Promise<Page<FeedItem>> {
  const { sql } = c;
  const q = query.trim();
  if (!q) return { items: [], nextCursor: null };
  const limit = limitOf(o);
  const at = chronoCursor(o.cursor);
  const rows = await sql<PostRow[]>`
    select ${selectPost(c)} from ${postTables(c)}
    where p.search @@ plainto_tsquery('simple', ${q}) and ${visible(c)} ${viewerFilter(c)}
      ${at ? sql`and (p.slot, p.sig) < (${at.slot}::bigint, ${at.sig}::text collate "C")` : sql``}
    order by p.slot desc, p.sig desc limit ${limit + 1}`;
  return postsPage(c, rows, limit);
}

export type ProfileFeedTab = 'posts' | 'replies' | 'likes';

export async function profileFeed(c: Ctx, address: string, o: PageOptions & { tab: ProfileFeedTab }): Promise<Page<FeedItem>> {
  const { sql } = c;
  const limit = limitOf(o);
  const at = chronoCursor(o.cursor);

  if (o.tab === 'replies') {
    const rows = await sql<PostRow[]>`
      select ${selectPost(c)} from ${postTables(c)}
      where p.author = ${address} and p.reply_to is not null and ${visible(c)}
        ${at ? sql`and (p.slot, p.sig) < (${at.slot}::bigint, ${at.sig}::text collate "C")` : sql``}
      order by p.slot desc, p.sig desc limit ${limit + 1}`;
    return postsPage(c, rows, limit);
  }

  if (o.tab === 'likes') {
    const rows = await sql<ItemRow[]>`
      select l.slot::text as sort_slot, l.sig as sort_sig, null as reposted_by, ${selectPost(c)}
      from likes l join ${postTables(c)} on p.sig = l.post
      where l.profile = ${address} and l.active and ${visible(c)} ${viewerFilter(c)}
        ${at ? sql`and (l.slot, l.sig) < (${at.slot}::bigint, ${at.sig}::text collate "C")` : sql``}
      order by l.slot desc, l.sig desc limit ${limit + 1}`;
    return page<FeedItem, ItemRow>(rows, limit, (used) => itemsFrom(c, used), (l) => `${l.sort_slot}:${l.sort_sig}`);
  }

  const rows = await sql<ItemRow[]>`
    with items as (
      select p2.sig as post_sig, p2.slot as sort_slot, p2.sig as sort_sig, null::text as reposted_by
      from posts p2 where p2.author = ${address} and p2.reply_to is null
      union all
      select r.post, r.slot, r.sig, r.profile from reposts r where r.profile = ${address} and r.active
    )
    select i.sort_slot::text as sort_slot, i.sort_sig, i.reposted_by, ${selectPost(c)}
    from items i join ${postTables(c)} on p.sig = i.post_sig
    where ${visible(c)}
      ${at ? sql`and (i.sort_slot, i.sort_sig) < (${at.slot}::bigint, ${at.sig}::text collate "C")` : sql``}
    order by i.sort_slot desc, i.sort_sig desc limit ${limit + 1}`;
  return page<FeedItem, ItemRow>(rows, limit, (used) => itemsFrom(c, used), (l) => `${l.sort_slot}:${l.sort_sig}`);
}

export async function bookmarks(c: Ctx, o: PageOptions): Promise<Page<FeedItem>> {
  if (!c.viewer) return { items: [], nextCursor: null };
  const { sql, viewer } = c;
  const limit = limitOf(o);
  const [when, sig] = decode(o.cursor).split('|');
  const at = when && sig && !Number.isNaN(new Date(when).getTime()) ? { when: new Date(when), sig } : null;
  const rows = await sql<(PostRow & { bm_at: Date })[]>`
    select b.created_at as bm_at, ${selectPost(c)}
    from bookmarks b join ${postTables(c)} on p.sig = b.post
    where b.profile = ${viewer} and ${visible(c)}
      ${at ? sql`and (b.created_at, b.post) < (${at.when}::timestamptz, ${at.sig}::text collate "C")` : sql``}
    order by b.created_at desc, b.post desc limit ${limit + 1}`;
  return page<FeedItem, PostRow & { bm_at: Date }>(
    rows,
    limit,
    async (used) => (await hydrate(c, used)).map((post) => ({ post, repostedBy: null })),
    (l) => `${l.bm_at.toISOString()}|${l.sig}`,
  );
}

// ---- single posts ---------------------------------------------------------------------------

export async function getPost(c: Ctx, sig: string): Promise<PostView | null> {
  const { sql } = c;
  const rows = await sql<PostRow[]>`select ${selectPost(c)} from ${postTables(c)} where p.sig = ${sig}`;
  if (rows.length === 0) return null;
  return (await hydrate(c, rows))[0] as PostView;
}

export type Thread = { post: PostView; ancestors: PostView[]; replies: PostView[]; nextCursor: string | null };

const MAX_ANCESTORS = 40;

export async function getThread(c: Ctx, sig: string, o: PageOptions = {}): Promise<Thread | null> {
  const { sql } = c;
  const post = await getPost(c, sig);
  if (!post) return null;

  // Walk up through replies. Chain data can point anywhere, so the depth is capped and cycles stop it.
  const chain = await sql<{ sig: string; depth: number }[]>`
    with recursive up as (
      select reply_to as sig, 1 as depth from posts where sig = ${sig}
      union
      select p.reply_to, up.depth + 1 from up join posts p on p.sig = up.sig
      where up.sig is not null and up.depth < ${MAX_ANCESTORS}
    )
    select sig, depth from up where sig is not null order by depth desc`;
  const views = await fetchViews(c, chain.map((r) => r.sig));
  const ancestors = chain.map((r) => views.get(r.sig)).filter((v): v is PostView => Boolean(v));

  const limit = limitOf(o);
  const offset = Number(decode(o.cursor)) || 0;
  const rows = await sql<PostRow[]>`
    select ${selectPost(c)} from ${postTables(c)}
    where p.reply_to = ${sig} and ${visible(c)} ${viewerFilter(c)}
    order by p.like_count desc, p.slot asc, p.sig asc limit ${limit + 1} offset ${offset}`;
  const more = rows.length > limit;
  const replies = await hydrate(c, more ? rows.slice(0, limit) : rows);
  return { post, ancestors, replies, nextCursor: more ? encode(String(offset + limit)) : null };
}

// ---- profiles -------------------------------------------------------------------------------

type ProfileRow = {
  address: string;
  handle: string | null;
  name: string;
  bio: string;
  website: string;
  location: string;
  avatar_seed: number;
  accent: number;
  pinned_post: string | null;
  created_at: Date | null;
  closed: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  cs_hidden: boolean | null;
  cs_withheld: string[] | null;
  cs_reason: string | null;
  cs_note: string | null;
};

const profileVisible = ({ sql, country }: Ctx) => sql`
  coalesce(cs.hidden, false) = false and not (${country} = any(coalesce(cs.withheld_countries, '{}'::text[])))`;

function profileTombstone(r: ProfileRow, country: string): Tombstone | null {
  if (r.cs_hidden) return { kind: 'removed', reason: r.cs_reason, note: r.cs_note };
  if (r.cs_withheld?.includes(country)) return { kind: 'withheld', reason: r.cs_reason, note: r.cs_note, countries: r.cs_withheld };
  return null;
}

function toProfile(r: ProfileRow): ProfileView {
  return {
    address: r.address,
    handle: r.handle,
    name: r.name,
    bio: r.bio,
    website: r.website,
    location: r.location,
    avatarSeed: r.avatar_seed,
    accent: r.accent,
    followers: r.follower_count,
    following: r.following_count,
    posts: r.post_count,
    createdAt: r.created_at ? r.created_at.toISOString() : null,
    closed: r.closed,
  };
}

async function profilePage(c: Ctx, r: ProfileRow): Promise<ProfilePage> {
  const { sql, viewer } = c;
  const tombstone = profileTombstone(r, c.country);
  if (tombstone) {
    const blank: ProfileView = { address: r.address, handle: r.handle, name: '', bio: '', website: '', location: '', avatarSeed: 0, accent: 0, followers: 0, following: 0, posts: 0, createdAt: null, closed: r.closed };
    return { profile: blank, tombstone, pinned: null, viewer: { following: false, followsYou: false, muted: false, blocked: false } };
  }
  const pinnedView = r.pinned_post ? await getPost(c, r.pinned_post) : null;
  // A pin can name any signature. Only the profile's own, visible post is shown as pinned.
  const pinned = pinnedView && !pinnedView.tombstone && pinnedView.author?.address === r.address ? pinnedView : null;
  let flags = { following: false, followsYou: false, muted: false, blocked: false };
  if (viewer && viewer !== r.address) {
    const row = (await sql<{ following: boolean; follows_you: boolean; muted: boolean; blocked: boolean }[]>`
      select
        exists (select 1 from follows where follower = ${viewer} and followee = ${r.address} and active) as following,
        exists (select 1 from follows where follower = ${r.address} and followee = ${viewer} and active) as follows_you,
        exists (select 1 from mutes where profile = ${viewer} and target = ${r.address}) as muted,
        exists (select 1 from blocks where profile = ${viewer} and target = ${r.address}) as blocked`)[0];
    if (row) flags = { following: row.following, followsYou: row.follows_you, muted: row.muted, blocked: row.blocked };
  }
  return { profile: toProfile(r), tombstone: null, pinned, viewer: flags };
}

const selectProfile = ({ sql }: Ctx) => sql`
  p.address, p.handle, p.name, p.bio, p.website, p.location, p.avatar_seed, p.accent, p.pinned_post, p.created_at, p.closed,
  p.follower_count, p.following_count, p.post_count,
  cs.hidden as cs_hidden, cs.withheld_countries as cs_withheld, cs.reason_code as cs_reason, cs.public_note as cs_note`;

const profileTables = ({ sql }: Ctx) => sql`
  profiles p left join content_state cs on cs.target_type = 'profile' and cs.target = p.address`;

export async function getProfileByHandle(c: Ctx, handle: string): Promise<ProfilePage | null> {
  const { sql } = c;
  const rows = await sql<ProfileRow[]>`select ${selectProfile(c)} from ${profileTables(c)} where p.handle = ${handle.toLowerCase()} limit 1`;
  return rows[0] ? profilePage(c, rows[0]) : null;
}

export async function getProfileByAddress(c: Ctx, address: string): Promise<ProfilePage | null> {
  const { sql } = c;
  const rows = await sql<ProfileRow[]>`select ${selectProfile(c)} from ${profileTables(c)} where p.address = ${address} limit 1`;
  return rows[0] ? profilePage(c, rows[0]) : null;
}

/**
 * The profiles a wallet currently controls. Anyone can ask this for any wallet, so a hidden or
 * withheld profile comes back with its fields blank, like everywhere else.
 */
export async function profilesOfWallet(c: Ctx, wallet: string): Promise<(ProfileView & { restricted: boolean })[]> {
  const { sql } = c;
  const rows = await sql<ProfileRow[]>`select ${selectProfile(c)} from ${profileTables(c)} where p.authority = ${wallet} and not p.closed order by p.created_at limit 10`;
  return rows.map((r) => {
    const restricted = profileTombstone(r, c.country) !== null;
    const view = toProfile(r);
    return restricted ? { ...view, name: '', bio: '', website: '', location: '', avatarSeed: 0, accent: 0, restricted } : { ...view, restricted };
  });
}

/** True when a target is hidden, or withheld in any country. Previews and crawlers use this. */
export async function restrictedAnywhere(c: Ctx, type: 'post' | 'profile', target: string): Promise<boolean> {
  const rows = await c.sql`select 1 from content_state where target_type = ${type} and target = ${target} and (hidden or cardinality(withheld_countries) > 0)`;
  return rows.length > 0;
}

export async function searchProfiles(c: Ctx, query: string, o: PageOptions): Promise<Page<ProfileView>> {
  const { sql } = c;
  const q = query.trim().replace(/^@/, '').toLowerCase();
  if (!q) return { items: [], nextCursor: null };
  const limit = limitOf(o);
  const offset = Number(decode(o.cursor)) || 0;
  const rows = await sql<ProfileRow[]>`
    select ${selectProfile(c)} from ${profileTables(c)}
    where p.handle is not null and ${profileVisible(c)}
      and (starts_with(p.handle, ${q}) or position(${q} in lower(p.name)) > 0)
    order by p.follower_count desc, p.handle limit ${limit + 1} offset ${offset}`;
  const more = rows.length > limit;
  return { items: (more ? rows.slice(0, limit) : rows).map(toProfile), nextCursor: more ? encode(String(offset + limit)) : null };
}

export async function followList(c: Ctx, address: string, side: 'followers' | 'following', o: PageOptions): Promise<Page<ProfileView>> {
  const { sql } = c;
  const limit = limitOf(o);
  const offset = Number(decode(o.cursor)) || 0;
  const rows = await sql<ProfileRow[]>`
    select ${selectProfile(c)} from follows f
    join ${profileTables(c)} on p.address = ${side === 'followers' ? sql`f.follower` : sql`f.followee`}
    where ${side === 'followers' ? sql`f.followee` : sql`f.follower`} = ${address} and f.active and ${profileVisible(c)}
    order by f.slot desc, f.sig desc limit ${limit + 1} offset ${offset}`;
  const more = rows.length > limit;
  return { items: (more ? rows.slice(0, limit) : rows).map(toProfile), nextCursor: more ? encode(String(offset + limit)) : null };
}

export async function whoToFollow(c: Ctx, limit = 3): Promise<ProfileView[]> {
  const { sql, viewer } = c;
  const v = viewer ?? '';
  const rows = await sql<ProfileRow[]>`
    select ${selectProfile(c)} from ${profileTables(c)}
    where p.handle is not null and p.address <> ${v} and ${profileVisible(c)}
      and not exists (select 1 from follows f where f.follower = ${v} and f.followee = p.address and f.active)
      and not exists (select 1 from blocks b where b.profile = ${v} and b.target = p.address)
      and not exists (select 1 from mutes m where m.profile = ${v} and m.target = p.address)
    order by p.follower_count desc, p.post_count desc, p.handle limit ${limit}`;
  return rows.map(toProfile);
}

// ---- trends, stats and the signs in the city -------------------------------------------------

export async function trends(c: Ctx, limit = 8): Promise<{ tag: string; posts: number }[]> {
  const { sql } = c;
  // The window starts at the oldest post inside it. Slots and block times rise together, so the
  // tag index can then be read from that slot on.
  const window = (hours: number) => sql<{ tag: string; posts: number }[]>`
    with since as (
      select coalesce((
        select slot from posts where not deleted and block_time > now() - make_interval(hours => ${hours})
        order by block_time asc limit 1
      ), 9223372036854775807) as slot
    )
    select t.tag, count(*)::int as posts
    from post_tags t
    join posts p on p.sig = t.post
    left join content_state cs on cs.target_type = 'post' and cs.target = p.sig
    left join content_state acs on acs.target_type = 'profile' and acs.target = p.author
    where t.slot >= (select slot from since) and ${visible(c)}
    group by t.tag order by posts desc, t.tag limit ${limit}`;
  const day = await window(24);
  // Early on, a single day may hold almost nothing. Widen the window rather than show an empty panel.
  return day.length >= 3 ? day : window(24 * 7);
}

export async function recentHandles(c: Ctx, limit = 24): Promise<{ handle: string; accent: number; claimedAt: string | null }[]> {
  const { sql } = c;
  const rows = await sql<{ handle: string; accent: number; claimed_at: Date | null }[]>`
    select h.handle, p.accent, h.claimed_at
    from handles h
    join ${profileTables(c)} on p.address = h.holder
    where ${profileVisible(c)}
    order by h.claimed_at desc nulls last, h.address limit ${limit}`;
  return rows.map((r) => ({ handle: r.handle, accent: r.accent, claimedAt: r.claimed_at ? r.claimed_at.toISOString() : null }));
}

export async function stats(c: Ctx): Promise<{ handles: number; posts: number }> {
  const row = (await c.sql<{ handles: number; posts: number }[]>`
    select (select count(*) from handles where holder is not null)::int as handles,
           (select count(*) from posts where not deleted)::int as posts`)[0];
  return row ?? { handles: 0, posts: 0 };
}

// ---- notifications --------------------------------------------------------------------------

export type NotificationKind = 'like' | 'repost' | 'reply' | 'quote' | 'follow' | 'mention';
export type NotificationView = { kind: NotificationKind; actor: AuthorView; post: PostView | null; slot: number; id: string };

export async function notifications(c: Ctx, o: PageOptions): Promise<Page<NotificationView>> {
  if (!c.viewer) return { items: [], nextCursor: null };
  const { sql, viewer, country } = c;
  const limit = limitOf(o);
  const at = chronoCursor(o.cursor);
  const rows = await sql<{ kind: NotificationKind; actor: string; post: string | null; s_slot: string; s_sig: string }[]>`
    with me as (select handle from profiles where address = ${viewer}),
    items as (
      select 'like' as kind, l.profile as actor, l.post as post, l.slot as s_slot, l.sig as s_sig
      from likes l join posts p on p.sig = l.post where p.author = ${viewer} and l.active and l.profile <> ${viewer}
      union all
      select 'repost', r.profile, r.post, r.slot, r.sig
      from reposts r join posts p on p.sig = r.post where p.author = ${viewer} and r.active and r.profile <> ${viewer}
      union all
      select 'reply', c.author, c.sig, c.slot, c.sig
      from posts c join posts p on p.sig = c.reply_to where p.author = ${viewer} and c.author <> ${viewer} and not c.deleted
      union all
      select 'quote', c.author, c.sig, c.slot, c.sig
      from posts c join posts p on p.sig = c.quote_of where p.author = ${viewer} and c.author <> ${viewer} and not c.deleted
      union all
      select 'follow', f.follower, null, f.slot, f.sig
      from follows f where f.followee = ${viewer} and f.active
      union all
      select 'mention', c.author, c.sig, c.slot, c.sig
      from post_mentions m join posts c on c.sig = m.post
      where m.handle = (select handle from me) and c.author <> ${viewer} and not c.deleted
    )
    select i.kind, i.actor, i.post, i.s_slot::text as s_slot, i.s_sig
    from items i
    left join content_state acs on acs.target_type = 'profile' and acs.target = i.actor
    left join content_state pcs on pcs.target_type = 'post' and pcs.target = i.post
    left join posts ip on ip.sig = i.post
    left join content_state ias on ias.target_type = 'profile' and ias.target = ip.author
    where coalesce(acs.hidden, false) = false
      and not (${country} = any(coalesce(acs.withheld_countries, '{}'::text[])))
      and coalesce(pcs.hidden, false) = false
      and not (${country} = any(coalesce(pcs.withheld_countries, '{}'::text[])))
      and coalesce(ias.hidden, false) = false
      and not (${country} = any(coalesce(ias.withheld_countries, '{}'::text[])))
      and coalesce(ip.deleted, false) = false
      and not exists (select 1 from blocks b where b.profile = ${viewer} and b.target = i.actor)
      and not exists (select 1 from mutes m where m.profile = ${viewer} and m.target = i.actor)
      ${at ? sql`and (i.s_slot, i.s_sig) < (${at.slot}::bigint, ${at.sig}::text collate "C")` : sql``}
    order by i.s_slot desc, i.s_sig desc, i.kind limit ${limit + 1}`;
  return page<NotificationView, (typeof rows)[number]>(
    rows,
    limit,
    async (used) => {
      const [people, posts] = await Promise.all([
        authors(c, [...new Set(used.map((r) => r.actor))]),
        fetchViews(c, [...new Set(used.map((r) => r.post).filter((s): s is string => Boolean(s)))]),
      ]);
      return used.flatMap((r) => {
        const actor = people.get(r.actor);
        if (!actor) return [];
        return [{ kind: r.kind, actor, post: r.post ? (posts.get(r.post) ?? null) : null, slot: Number(r.s_slot), id: `${r.kind}:${r.s_sig}:${r.actor}` }];
      });
    },
    (l) => `${l.s_slot}:${l.s_sig}`,
  );
}

// ---- private preferences --------------------------------------------------------------------

export type Preferences = {
  mutes: AuthorView[];
  blocks: AuthorView[];
  mutedWords: string[];
  labels: Record<string, 'hide' | 'warn' | 'show'>;
};

export async function preferences(c: Ctx, profile: string): Promise<Preferences> {
  const { sql } = c;
  const [mutes, blocks, words, labels] = await Promise.all([
    sql<{ target: string }[]>`select target from mutes where profile = ${profile} order by created_at desc limit 500`,
    sql<{ target: string }[]>`select target from blocks where profile = ${profile} order by created_at desc limit 500`,
    sql<{ word: string }[]>`select word from muted_words where profile = ${profile} order by created_at desc limit 500`,
    sql<{ label: string; action: 'hide' | 'warn' | 'show' }[]>`select label, action from label_prefs where profile = ${profile}`,
  ]);
  const people = await authors(c, [...mutes, ...blocks].map((r) => r.target));
  const resolved = (rows: readonly { target: string }[]) => rows.flatMap((r) => (people.get(r.target) ? [people.get(r.target) as AuthorView] : []));
  const chosen = Object.fromEntries(labels.map((l) => [l.label, l.action]));
  const merged = Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [k, chosen[k] ?? v.defaultAction])) as Preferences['labels'];
  return { mutes: resolved(mutes), blocks: resolved(blocks), mutedWords: words.map((w) => w.word), labels: merged };
}

export type SessionView = { address: string; delegate: string; expiresAt: string | null; createdAt: string | null; live: boolean };

export async function sessionsOf(c: Ctx, profile: string): Promise<SessionView[]> {
  const rows = await c.sql<{ address: string; delegate: string; expires_at: Date | null; created_at: Date | null; killed: boolean }[]>`
    select s.address, s.delegate, s.expires_at, s.created_at,
      (pr.kill_slot is not null and (s.version_slot, s.version_sig, s.version_ix) < (pr.kill_slot, pr.kill_sig, pr.kill_ix)) as killed
    from sessions s join profiles pr on pr.address = s.profile
    where s.profile = ${profile} and not s.closed
    order by s.version_slot desc limit 50`;
  const now = Date.now();
  return rows.map((r) => ({
    address: r.address,
    delegate: r.delegate,
    expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
    createdAt: r.created_at ? r.created_at.toISOString() : null,
    live: !r.killed && Boolean(r.expires_at && r.expires_at.getTime() > now),
  }));
}
