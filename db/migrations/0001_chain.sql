-- The chain projection. `events` is the raw log. Every other table here is a pure function of
-- `events`, and can be dropped and rebuilt from the ledger at any time.
--
-- Everything that takes part in ordering uses the C collation, so sort order is bytewise and can't
-- differ between machines, which is what makes the state hash reproducible.

create table chain_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table events (
  sig text collate "C" not null,
  ix_index int not null,
  slot bigint not null,
  block_time timestamptz,
  kind text not null,
  signer text collate "C",
  profile text collate "C",
  handle_account text collate "C",
  session_account text collate "C",
  data jsonb not null,
  finalized boolean not null default false,
  primary key (sig, ix_index)
);
create index events_order on events (slot, sig, ix_index);
create index events_profile on events (profile, kind);
create index events_handle on events (handle_account) where handle_account is not null;
create index events_session on events (session_account) where session_account is not null;
create index events_unfinalized on events (slot) where not finalized;
create index events_transfer_to on events ((data ->> 'toProfile')) where kind = 'transfer_handle';

create table profiles (
  address text collate "C" primary key,
  creator text collate "C",
  authority text collate "C",
  handle text collate "C",
  name text not null default '',
  bio text not null default '',
  website text not null default '',
  location text not null default '',
  avatar_seed int not null default 0,
  accent int not null default 0,
  pinned_post text collate "C",
  created_at timestamptz,
  created_slot bigint,
  closed boolean not null default false,
  follower_count int not null default 0,
  following_count int not null default 0,
  post_count int not null default 0,
  meta_slot bigint,
  meta_sig text collate "C",
  meta_ix int,
  pin_slot bigint,
  pin_sig text collate "C",
  pin_ix int,
  kill_slot bigint,
  kill_sig text collate "C",
  kill_ix int
);
create index profiles_handle on profiles (handle) where handle is not null;
create index profiles_authority on profiles (authority);
create index profiles_followers on profiles (follower_count desc, address);

create table handles (
  address text collate "C" primary key,
  handle text collate "C" not null unique,
  holder text collate "C",
  claimed_at timestamptz,
  version_slot bigint not null,
  version_sig text collate "C" not null,
  version_ix int not null
);
create index handles_holder on handles (holder) where holder is not null;
create index handles_recent on handles (claimed_at desc, address) where holder is not null;

create table posts (
  sig text collate "C" primary key,
  author text collate "C" not null,
  text text not null,
  reply_to text collate "C",
  quote_of text collate "C",
  slot bigint not null,
  ix_index int not null,
  block_time timestamptz,
  deleted boolean not null default false,
  like_count int not null default 0,
  repost_count int not null default 0,
  reply_count int not null default 0,
  quote_count int not null default 0,
  search tsvector generated always as (to_tsvector('simple', text)) stored
);
create index posts_author on posts (author, slot desc, sig desc) where not deleted;
create index posts_reply_to on posts (reply_to, slot, sig) where reply_to is not null and not deleted;
create index posts_quote_of on posts (quote_of) where quote_of is not null and not deleted;
create index posts_recent on posts (slot desc, sig desc) where not deleted;
create index posts_search on posts using gin (search);

create table post_deletes (
  post text collate "C" not null,
  profile text collate "C" not null,
  primary key (post, profile)
);

create table likes (
  profile text collate "C" not null,
  post text collate "C" not null,
  active boolean not null,
  slot bigint not null,
  sig text collate "C" not null,
  ix int not null,
  block_time timestamptz,
  primary key (profile, post)
);
create index likes_post on likes (post) where active;
create index likes_profile on likes (profile, slot desc, sig desc) where active;

create table reposts (
  profile text collate "C" not null,
  post text collate "C" not null,
  active boolean not null,
  slot bigint not null,
  sig text collate "C" not null,
  ix int not null,
  block_time timestamptz,
  primary key (profile, post)
);
create index reposts_post on reposts (post) where active;
create index reposts_profile on reposts (profile, slot desc, sig desc) where active;

create table follows (
  follower text collate "C" not null,
  followee text collate "C" not null,
  active boolean not null,
  slot bigint not null,
  sig text collate "C" not null,
  ix int not null,
  block_time timestamptz,
  primary key (follower, followee)
);
create index follows_followee on follows (followee, slot desc) where active;
create index follows_follower on follows (follower, slot desc) where active;

create table post_tags (
  post text collate "C" not null,
  tag text not null,
  slot bigint not null,
  primary key (post, tag)
);
create index post_tags_tag on post_tags (tag, slot desc);
create index post_tags_recent on post_tags (slot desc);

create table post_mentions (
  post text collate "C" not null,
  handle text collate "C" not null,
  slot bigint not null,
  primary key (post, handle)
);
create index post_mentions_handle on post_mentions (handle, slot desc);

create table sessions (
  address text collate "C" primary key,
  profile text collate "C",
  delegate text collate "C",
  rent_payer text collate "C",
  expires_at timestamptz,
  created_at timestamptz,
  closed boolean not null default false,
  version_slot bigint,
  version_sig text collate "C",
  version_ix int
);
create index sessions_profile on sessions (profile) where not closed;
