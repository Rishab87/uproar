#!/usr/bin/env bash
# Schedules the one-minute heartbeat inside Supabase Postgres (pg_cron + pg_net).
#   DATABASE_URL=postgres://... SITE_URL=https://... CRON_SECRET=... scripts/setup-cron.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to the Supabase session URL (port 5432)}"
: "${SITE_URL:?set SITE_URL, for example https://uproar.vercel.app}"
: "${CRON_SECRET:?set CRON_SECRET to the same value as the app}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="${PSQL:-/opt/homebrew/opt/postgresql@17/bin/psql}"
"$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "set uproar.tick_url = '${SITE_URL%/}/api/cron/tick'" \
  -c "set uproar.cron_secret = '${CRON_SECRET}'" \
  -f "$ROOT/db/supabase/cron.sql"
echo "heartbeat scheduled: ${SITE_URL%/}/api/cron/tick every minute"
