#!/usr/bin/env bash
# Stops everything `pnpm dev` started: the app on :3000, the local validator and Postgres.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
lsof -ti tcp:3000 -sTCP:LISTEN | xargs kill 2> /dev/null
pkill -f "solana-test-validator --ledger $ROOT/.local/ledger" 2> /dev/null
"$ROOT/scripts/dev-db.sh" stop > /dev/null 2>&1
echo "stopped the app, the local chain and Postgres"
