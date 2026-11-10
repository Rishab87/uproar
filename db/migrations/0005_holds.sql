-- Each reason a target is hidden or withheld is its own hold, owned by the report, legal order or
-- operator action that placed it. Releasing one hold never lifts another. content_state stays as the
-- materialised result that every read query uses.
create table content_holds (
  id bigserial primary key,
  target_type text not null check (target_type in ('post', 'profile')),
  target text collate "C" not null,
  kind text not null check (kind in ('hide', 'withhold')),
  countries text[] not null default '{}',
  source text not null check (source in ('report', 'order', 'operator')),
  automatic boolean not null default false,
  report_id uuid references reports (id),
  order_id uuid references legal_orders (id),
  reason_code text not null,
  public_note text,
  created_at timestamptz not null default now(),
  created_by text not null,
  released_at timestamptz,
  released_by text,
  release_note text
);
create index content_holds_active on content_holds (target_type, target) where released_at is null;
create index content_holds_report on content_holds (report_id) where released_at is null;
create index content_holds_order on content_holds (order_id) where released_at is null;
create index content_holds_automatic on content_holds (created_at) where automatic;

-- Server-side values that must persist, such as the salt for hashing reporter identifiers.
create table settings (
  key text primary key,
  value text not null
);

alter table appeals add column status_token_hash text;

alter table legal_orders drop constraint legal_orders_status_check;
alter table legal_orders add constraint legal_orders_status_check check (status in ('received', 'actioned', 'rejected', 'challenged', 'lifted'));
alter table legal_orders add column lifted_at timestamptz;
alter table legal_orders add column lifted_by text;
alter table legal_orders add column lift_note text;
