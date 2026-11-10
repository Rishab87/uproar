# Launch runbook

Two stages. The devnet beta uses free test SOL and can be wiped. Mainnet is permanent: once a post is
written there, nobody can take it back. Don't start stage 2 until every box in "Before mainnet" is
ticked.

## Stage 1: devnet beta

### What it needs

| Item | Cost | Why |
|---|---|---|
| About 3 devnet SOL at the deployer `Ly6zPKa3qH3Rduta5Njnc9P11HrrCkFTu6jE687hXL3` | free from https://faucet.solana.com | Program rent is 1.177 SOL, and about twice that while deploying. The CLI faucet rate-limits this machine |
| A Supabase project in Mumbai (`ap-south-1`) | free tier | The database. Mumbai keeps the access logs in India, as CERT-In expects |
| A Vercel project in region `bom1` | Hobby, free | The app. Hobby is for non-commercial use, which fits a beta with no revenue |
| A Helius account | free tier | Devnet RPC. The public endpoint is rate-limited and drops requests |
| A Telegram bot | free | Deadline alarms. Message @BotFather, `/newbot`, then send the bot one message so it can reply |

### Steps

This is what the live beta at https://uproar-app.vercel.app was set up with on 2026-11-10. Its
secrets are in `~/.config/uproar/devnet.env` on Rishab's Mac, never in the repo.

```sh
# 1. Program. Then check the chain holds exactly the tested build.
scripts/deploy-program.sh devnet
solana program dump <program id> /tmp/onchain.so -u devnet   # compare sha256 with target/deploy/uproar.so

# 2. Database. The app gets its own role, so it never holds the postgres password. The timeouts stop
#    a frozen serverless instance from pinning a connection. `supabase db query --linked` runs as
#    postgres through the Management API, so no password is needed for this part.
supabase db query --project-ref <ref> --linked "create role uproar_app login password '<random hex>';
  grant usage, create on schema public to uproar_app;
  alter role uproar_app set statement_timeout = '60s';
  alter role uproar_app set idle_in_transaction_session_timeout = '30s';"
# Pooler host: try aws-0-<region> and aws-1-<region>.pooler.supabase.com; the wrong one says "tenant not found".
DATABASE_URL='postgresql://uproar_app.<ref>:<password>@<pooler host>:5432/postgres?sslmode=require' pnpm db:migrate
#    Migration 0006 turns on row level security everywhere, which closes Supabase's Data API.

# 3. App. Project root apps/web, Node 24, and ENABLE_EXPERIMENTAL_COREPACK=1 so Vercel uses the
#    pinned pnpm. Put the functions next to the database: sin1 for Singapore, bom1 for Mumbai
#    (apps/web/vercel.json). .vercelignore keeps the local chain and build output out of the upload.
#    Production env: DATABASE_URL (same URL, port 6543), RPC_URLS (Helius first, public devnet after),
#    NEXT_PUBLIC_CLUSTER=devnet, NEXT_PUBLIC_SITE_URL, CRON_SECRET, ADMIN_SESSION_SECRET,
#    HELIUS_WEBHOOK_SECRET, ADMIN_WALLETS, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DEFAULT_COUNTRY=IN,
#    FAUCET_SECRET (test clusters only, see below).
npx vercel deploy --prod

# 4. Heartbeat every minute from inside Postgres. pg_cron needs the postgres role, so run
#    db/supabase/cron.sql through `supabase db query --linked -f`, with the site URL and
#    "Bearer <CRON_SECRET>" written into the cron.schedule call.

# 5. Helius webhook: type rawDevnet, account = the program id, URL /api/webhooks/helius,
#    authHeader = HELIUS_WEBHOOK_SECRET (sent as-is, no "Bearer").

# 6. Check with real transactions. Two throwaway users do everything, then clean up after themselves.
cd apps/web && SMOKE_URL=https://<site> SMOKE_RPC='<devnet rpc>' pnpm exec tsx scripts/smoke-devnet.ts
#    And /admin shows Alarms "On", Heartbeat recent, Audit chain "Intact".
```

Two rules for anything that talks to the database through Supabase's transaction pooler, both learned
on this deploy: no session state (the maintenance runner uses a lease row, not an advisory lock), and
one query in flight per connection (`max_pipeline: 1`), because a pipelined reply can be lost.

The Telegram chat id: send your bot a message, then open
`https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `message.chat.id`.

The test SOL tap. Devnet's RPC airdrop is closed ("The RPC faucet is closed on this cluster"), so the
claim page's "Get free test SOL" sends 0.02 SOL from the app's own wallet: enough for a name of five or
more letters, its rent and fees for 200 actions. Once per wallet, three a day per network address, 300 a
day in all. `FAUCET_SECRET` is that wallet's keypair JSON (`solana-keygen new -o faucet.json`, its own
key, never the deployer). Fund it from the deployer or from https://faucet.solana.com. When it runs dry,
the claim page sends people to faucet.solana.com. Mainnet never reads the key and the route answers 404.

### What to test with Phantom

In Phantom: Settings > Developer settings > Testnet mode on, network Solana Devnet. The claim page's
"Get free test SOL" covers a normal name. For more, use https://faucet.solana.com.

1. Claim a name. One approval should create everything.
2. Post, reply, quote, like, repost, follow, edit your profile. None of these should open Phantom.
3. On your phone: open the site inside Phantom's browser and do the same.
4. Settings: extend the session, sign out this device, revoke all, start again.
5. File a report as someone else, then act on it in `/admin`. Check `/transparency`.
6. Release your name and check the deposit came back.

## Before mainnet

- [ ] An Indian technology lawyer has answered the brief for counsel (kept out of this public repo).
- [ ] A second operator can reach `/admin` and gets the alarms.
- [ ] You can name the first 100 people you'll bring in, and you've messaged 20 of them.
- [ ] Docker or OrbStack is installed, so the program can be built reproducibly with `solana-verify`.
- [ ] The devnet beta ran for a week with real people and nothing unexplained in `/admin`.

## Stage 2: mainnet

1. **Reproducible build.** `solana-verify build` in the repo root. Compare its hash with the deployed
   one after deploying (`solana-verify get-program-hash -u mainnet-beta <id>`), then publish the repo.
2. **Funds.** The program locks 1.177 SOL in rent at today's rate (231.5 KB, 5,080 lamports a byte).
   Deploying needs about 2.4 SOL while the buffer exists. The buffer is refunded.
3. **Deploy.** `scripts/deploy-program.sh mainnet-beta`. It asks you to type the program id.
4. **Upgrade authority.** Move it to a Squads multisig with the second operator straight away
   (`solana program set-upgrade-authority`). After the beta, freeze the program:
   `solana program set-upgrade-authority <id> --final`. That can't be undone, which is the point.
5. **App.** A new Supabase project, or wipe the devnet one. Set `NEXT_PUBLIC_CLUSTER=mainnet-beta`,
   mainnet RPC URLs (Helius Developer is $49/month once traffic needs it), and the real domain in
   `NEXT_PUBLIC_SITE_URL`. Point the Helius webhook (raw transactions for the program id) at
   `/api/webhooks/helius`, with `HELIUS_WEBHOOK_SECRET` as its authorization header.
6. **Domain.** Buy it, add it to Vercel, then submit it for Phantom's domain review if Phantom warns
   that the domain is new. The warning normally clears on its own within days.
7. **Launch order.** Open name claims first, with the neon sign share images, and bring the first 100
   in by hand. Open the feed when there's something in it.

## Secrets to rotate after any incident

`CRON_SECRET`, `ADMIN_SESSION_SECRET` (signs everyone out of the console), `HELIUS_WEBHOOK_SECRET`,
the Supabase database password, the Helius API key, the Telegram bot token, and the deployer keypair
if it might have leaked (move the upgrade authority first).

## Costs

| Item | When | Amount |
|---|---|---|
| Program rent | Mainnet deploy | 1.177 SOL, locked while the program exists |
| A user's onboarding | Per user, paid by them | 0.0149 SOL for a 5+ character name: 0.01 deposit, 0.0033 account rent, 0.00165 session fees. All refundable except fees spent |
| Hosting | Beta | free tiers |
| Hosting | With traffic | about $100 a month: Helius $49, Vercel Pro $20, Supabase Pro $25 |
| Lawyer | Before mainnet | quote first |
