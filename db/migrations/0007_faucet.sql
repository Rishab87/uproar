-- Test SOL the claim page hands to new wallets on test clusters: one row per wallet, ever. Request IPs
-- are in access_log already, so they aren't kept here.
create table faucet_drips (
  address text collate "C" primary key,
  lamports bigint not null,
  signature text collate "C",
  created_at timestamptz not null default now()
);
alter table faucet_drips enable row level security;
