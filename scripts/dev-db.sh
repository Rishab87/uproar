#!/usr/bin/env bash
# Local Postgres for development and tests. Data lives in .pgdata (gitignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
DATA="$ROOT/.pgdata"
PORT="${UPROAR_PG_PORT:-54329}"
case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then
      "$PGBIN/initdb" -D "$DATA" -U uproar --auth=trust --encoding=UTF8 --locale=C >/dev/null
    fi
    if ! "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1 -c fsync=off" -l "$DATA/server.log" -w start >/dev/null
    fi
    "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U uproar -d postgres -tc "select 1 from pg_database where datname='uproar'" | grep -q 1 || "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U uproar uproar
    echo "postgres://uproar@127.0.0.1:$PORT/uproar"
    ;;
  stop) "$PGBIN/pg_ctl" -D "$DATA" -m fast stop ;;
  *) echo "usage: dev-db.sh start|stop" >&2; exit 1 ;;
esac
