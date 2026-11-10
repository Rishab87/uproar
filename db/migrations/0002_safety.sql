-- Everything the app decides, as opposed to what the chain records. None of this is touched by a
-- rebuild. Hiding only changes what this app shows; it can't and doesn't touch the ledger.

-- What the app currently shows for a target. A post or profile with no row here is shown normally.
create table content_state (
  target_type text not null check (target_type in ('post', 'profile')),
  target text collate "C" not null,
  hidden boolean not null default false,
  withheld_countries text[] not null default '{}',
  reason_code text,
  public_note text,
  updated_at timestamptz not null default now(),
  primary key (target_type, target)
);

-- Labels never remove anything. Each person picks hide, warn or show per label.
create table labels (
  target_type text not null check (target_type in ('post', 'profile')),
  target text collate "C" not null,
  label text not null,
  source text not null check (source in ('operator', 'auto')),
  score real,
  created_at timestamptz not null default now(),
  primary key (target_type, target, label)
);
create index labels_target on labels (target);

create table reports (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  status_token_hash text not null,
  category text not null,
  rule text not null,
  target_type text not null check (target_type in ('post', 'profile')),
  target text collate "C" not null,
  details text not null default '',
  reporter_name text,
  reporter_email text,
  on_behalf boolean not null default false,
  declaration boolean not null default false,
  reporter_key text,
  reporter_ip text,
  country text,
  auto_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  ack_due_at timestamptz not null,
  acknowledged_at timestamptz,
  resolve_due_at timestamptz not null,
  resolved_at timestamptz,
  status text not null default 'open' check (status in ('open', 'resolved', 'withdrawn')),
  decision text check (decision in ('removed', 'withheld', 'restored', 'no_action', 'labelled')),
  decision_reason text,
  decided_by text,
  false_report boolean not null default false,
  external_report_ref text
);
create index reports_queue on reports (resolve_due_at) where status = 'open';
create index reports_target on reports (target_type, target);

-- Filing a false 2-hour complaint can hide a post for a while. Repeat it and auto-hide stops.
create table reporter_standing (
  key text primary key,
  false_count int not null default 0,
  last_false_at timestamptz
);

create table legal_orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  kind text not null check (kind in ('court', 'government', 'police')),
  authority text not null,
  officer_name text not null,
  officer_designation text not null,
  order_reference text not null,
  contact_email text not null,
  targets jsonb not null,
  scope_countries text[] not null default '{}',
  document_url text,
  details text not null default '',
  submitter_ip text,
  received_at timestamptz not null default now(),
  due_at timestamptz not null,
  status text not null default 'received' check (status in ('received', 'actioned', 'rejected', 'challenged')),
  actioned_at timestamptz,
  actioned_by text,
  decision_note text,
  publish boolean not null default true
);
create index legal_orders_queue on legal_orders (due_at) where status = 'received';

create table data_requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  authority text not null,
  officer_name text not null,
  officer_designation text not null,
  legal_basis text not null,
  contact_email text not null,
  subject text not null,
  details text not null default '',
  submitter_ip text,
  received_at timestamptz not null default now(),
  due_at timestamptz not null,
  status text not null default 'received' check (status in ('received', 'responded', 'rejected')),
  responded_at timestamptz,
  responded_by text,
  response_note text
);
create index data_requests_queue on data_requests (due_at) where status = 'received';

create table appeals (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  target_type text not null check (target_type in ('post', 'profile')),
  target text collate "C" not null,
  appellant_email text not null,
  statement text not null,
  verified_author boolean not null default false,
  submitter_ip text,
  created_at timestamptz not null default now(),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  decided_at timestamptz,
  decided_by text,
  decision_note text
);
create index appeals_queue on appeals (due_at) where status = 'open';

-- The public record of what this app did. Append only.
create table moderation_actions (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null check (action in ('hide', 'unhide', 'withhold', 'unwithhold', 'label', 'unlabel')),
  target_type text not null,
  target text collate "C" not null,
  countries text[] not null default '{}',
  label text,
  reason_code text not null,
  legal_basis text,
  report_id uuid references reports (id),
  order_id uuid references legal_orders (id),
  appeal_id uuid references appeals (id),
  note text,
  publish_target boolean not null default true
);
create index moderation_actions_target on moderation_actions (target_type, target, id);
create index moderation_actions_recent on moderation_actions (id desc);

-- Every operator and automatic decision. Each row commits to the one before it, so history can't be
-- quietly rewritten. Append only.
create table audit_log (
  seq bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  subject text,
  detail jsonb not null default '{}',
  prev_hash text not null,
  hash text not null
);

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function forbid_change();
create trigger moderation_actions_append_only before update or delete on moderation_actions
  for each row execute function forbid_change();

create table alerts (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  severity text not null check (severity in ('p0', 'p1', 'p2', 'p3')),
  kind text not null,
  subject text not null,
  body text not null,
  link text,
  dedupe_key text unique,
  due_at timestamptz,
  acknowledged_at timestamptz,
  last_sent_at timestamptz,
  send_count int not null default 0,
  last_error text
);
create index alerts_open on alerts (created_at) where acknowledged_at is null;

-- CERT-In directions: keep logs for a rolling 180 days. Only write and safety endpoints are logged here.
create table access_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  method text not null,
  route text not null,
  status int,
  ip text,
  user_agent text,
  country text,
  profile text
);
create index access_log_at on access_log (at);
create index access_log_ip on access_log (ip, at);
create index access_log_profile on access_log (profile, at) where profile is not null;

create table rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);
create index rate_limits_window on rate_limits (window_start);

-- Rule 3(1)(c): tell users every three months. One row per quarter, shown as a dismissible banner.
create table notices (
  quarter text primary key,
  title text not null,
  body text not null,
  published_at timestamptz not null default now()
);
