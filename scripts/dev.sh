#!/usr/bin/env bash
# Everything for trying UPROAR locally: Postgres, a validator with the program, demo data, the app.
#   pnpm dev   then open http://localhost:3000 and connect "Local test wallet".
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
mkdir -p "$ROOT/.local"
# Ctrl-C stops whatever this script started, so nothing keeps running in the background.
"$PGBIN/pg_ctl" -D "$ROOT/.pgdata" status > /dev/null 2>&1 && PG_WAS_UP=1 || PG_WAS_UP=0
CHAIN_PID=""
cleanup() {
  if [ -n "$CHAIN_PID" ]; then kill "$CHAIN_PID" 2> /dev/null || true; fi
  if [ "$PG_WAS_UP" = 0 ]; then "$ROOT/scripts/dev-db.sh" stop > /dev/null 2>&1 || true; fi
  echo "stopped"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
DB="$("$ROOT/scripts/dev-db.sh" start)"
[ -f "$ROOT/target/deploy/uproar.so" ] || (cd "$ROOT" && cargo build-sbf)
health() { curl -s -m 2 -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' http://127.0.0.1:8899 | grep -q ok; }
slot() { curl -s -m 2 -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' http://127.0.0.1:8899 | sed -nE 's/.*"result":([0-9]+).*/\1/p'; }
if ! health; then
  echo "starting a fresh local chain (about 20 seconds)"
  "$ROOT/scripts/dev-chain.sh" > "$ROOT/.local/validator.log" 2>&1 &
  CHAIN_PID=$!
  # A new validator answers health checks well before it makes its first block, so wait for blocks.
  for _ in $(seq 1 120); do
    sleep 1
    s="$(slot)"
    [ -n "$s" ] && [ "$s" -ge 10 ] && break
  done
  s="$(slot)"
  if [ -z "$s" ] || [ "$s" -lt 10 ]; then echo "the local chain did not start, see .local/validator.log" >&2; exit 1; fi
  # A fresh validator starts an empty chain, so the local database starts empty too.
  "$PGBIN/psql" -h 127.0.0.1 -p "${UPROAR_PG_PORT:-54329}" -U uproar -d postgres -q \
    -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'uproar' and pid <> pg_backend_pid()" \
    -c "drop database if exists uproar" -c "create database uproar" > /dev/null
  (cd "$ROOT" && DATABASE_URL="$DB" pnpm exec tsx packages/indexer-core/scripts/migrate.ts)
  echo "adding demo people and posts"
  (cd "$ROOT" && DATABASE_URL="$DB" pnpm --filter @uproar/indexer seed)
else
  (cd "$ROOT" && DATABASE_URL="$DB" pnpm exec tsx packages/indexer-core/scripts/migrate.ts)
fi
if [ ! -f "$ROOT/apps/web/.env.local" ]; then
  # Local-only secrets, random per machine. Production secrets are set in Vercel, never here.
  sed -e "s#^DATABASE_URL=.*#DATABASE_URL=$DB#" \
    -e "s#^CRON_SECRET=\$#CRON_SECRET=local-$(openssl rand -hex 16)#" \
    -e "s#^ADMIN_SESSION_SECRET=\$#ADMIN_SESSION_SECRET=local-$(openssl rand -hex 32)#" \
    "$ROOT/.env.example" > "$ROOT/apps/web/.env.local"
fi
echo "open http://localhost:3000 and connect \"Local test wallet\""
cd "$ROOT/apps/web" && pnpm exec next dev -p 3000
