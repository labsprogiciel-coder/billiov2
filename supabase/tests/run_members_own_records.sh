#!/usr/bin/env bash
# Checks supabase/migrations/20261120_members_own_records.sql on a throwaway
# Postgres cluster. Usage: supabase/tests/run_members_own_records.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")"
dir="$(mktemp -d)"
case "$dir" in *[!A-Za-z0-9/._-]*) echo "unsupported temporary path: $dir" >&2; rm -rf "$dir"; exit 1 ;; esac
as_server() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/sh -c "$*"; else sh -c "$*"; fi; }
cleanup() { as_server "'$bin/pg_ctl' -D '$dir/data' stop -m fast" >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
[ "$(id -u)" = 0 ] && chown postgres "$dir"
as_server "'$bin/initdb' -D '$dir/data' -A trust -U postgres" >/dev/null
as_server "'$bin/pg_ctl' -D '$dir/data' -o \"-k '$dir' -c listen_addresses=''\" -l '$dir/log' start" >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
psql_() { "$bin/psql" -h "$dir" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
cd "$here"
psql_ -f members_own_records_test.sql
echo "== Members see their own records: all checks pass"

