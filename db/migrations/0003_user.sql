-- Private preferences. They never go on chain. Every request is signed by the wallet or a live
-- delegate, and there are no accounts or passwords.

create table bookmarks (
  profile text collate "C" not null,
  post text collate "C" not null,
  created_at timestamptz not null default now(),
  primary key (profile, post)
);
create index bookmarks_recent on bookmarks (profile, created_at desc);

create table blocks (
  profile text collate "C" not null,
  target text collate "C" not null,
  created_at timestamptz not null default now(),
  primary key (profile, target)
);

create table mutes (
  profile text collate "C" not null,
  target text collate "C" not null,
  created_at timestamptz not null default now(),
  primary key (profile, target)
);

create table muted_words (
  profile text collate "C" not null,
  word text not null,
  created_at timestamptz not null default now(),
  primary key (profile, word)
);

create table label_prefs (
  profile text collate "C" not null,
  label text not null,
  action text not null check (action in ('hide', 'warn', 'show')),
  primary key (profile, label)
);

-- Proof that a person accepted the terms and the permanence warning before their first post.
create table consents (
  profile text collate "C" not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  primary key (profile, version)
);

create table admin_logins (
  nonce text primary key,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
