# UPROAR

An X-style social network whose posts live on Solana. The chain holds the speech, and nobody can erase
it. This app is one reader of that chain and follows Indian law. Anyone can run another.

## Layout

| Path | What |
|---|---|
| `programs/uproar` | The Anchor program: profiles, handles, session keys, signed social events |
| `packages/protocol` | The program's IDL (`idl/uproar.json`), generated client, the canonical decoder, text rules (280-weighted, mentions, tags) |
| `packages/indexer-core` | Rebuilds state from the chain into Postgres, order-independent and idempotent |
| `packages/safety` | Reports, legal clocks, withholding, appeals, hash-chained audit log, alarms |
| `apps/web` | The Next.js app, operator console, legal pages, share images |
| `apps/indexer` | Command line indexer, demo seed, and the chain proof |
| `db/migrations` | Plain SQL, no vendor features |
| `docs` | Spec, protocol, launch runbook, on-call guide |

## Run it locally

Needs Node 22+, pnpm, Rust, the Solana CLI 4.4 and Postgres 17.

```sh
pnpm install
pnpm dev        # Postgres, a fresh local chain with the program, demo data, the app on :3000
```

Open http://localhost:3000, press Connect wallet and pick **Local test wallet**. It exists only in
`next dev` against a local chain, tops itself up with free test SOL, and is left out of production
builds. A private window gets a second wallet, so you can play two people. With `ADMIN_WALLETS`
empty, any wallet can open `/admin` locally; a deployed build never allows that.

Every start begins with a fresh chain and database. Ctrl-C stops the app, the chain and Postgres.
Try real wallets such as Phantom on the devnet beta.

## Tests

```sh
pnpm test:program   # 69 LiteSVM tests against the compiled program, including every attack path
pnpm test           # 179 tests: protocol, indexer determinism, safety, visibility (needs pnpm db:start)
pnpm proof:chain    # real transactions on the local validator, wiped and rebuilt from the chain alone
cd apps/web && pnpm e2e   # 46 end-to-end tests, each in Chromium and WebKit, including timed legal drills
```

After a devnet deploy, `apps/web/scripts/smoke-devnet.ts` checks the live site with real transactions:
two throwaway users claim, post, reply, like, repost, follow, pin, search and delete, then release their
names and return the SOL. It refuses to run against mainnet. Usage is in `docs/LAUNCH.md`.

`scripts/mutation_check.py`, `scripts/mutation_indexer.py` and `scripts/mutation_visibility.py` break
each guard on purpose and confirm the tests catch it. `apps/web/tests/loadtest.ts` times every read
query against 300,000 posts and 1.5 million likes.

## Deploying

See `docs/LAUNCH.md`. On call: `docs/ON-CALL.md`.

## License

The program, protocol package and indexer are Apache-2.0.
