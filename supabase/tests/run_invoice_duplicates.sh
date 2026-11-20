#!/usr/bin/env bash
# Checks supabase/migrations/20261130_invoice_duplicates_and_lines.sql on a throwaway
# Postgres cluster. Usage: supabase/tests/run_invoice_duplicates.sh
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
psql_ -f invoice_duplicates_test.sql

# Two sessions, a zero line and an issue of the same draft: whichever starts first, the other waits
# for it, then is refused.
o="'00000000-0000-0000-0000-00000000000a'"
race() { # $1: what holds its transaction open; $2: what starts meanwhile; $3: name
  psql_ -c "begin; $1; select pg_sleep(2); commit;" >/dev/null &
  local first=$!
  sleep 0.5
  local started out waited
  started=$(date +%s.%N)
  if out=$(psql_ -c "$2" 2>&1); then
    wait "$first" || true; echo "FAIL ($3): both committed" >&2; exit 1
  fi
  wait "$first"
  case "$out" in *"worth zero or less"*) ;; *) echo "FAIL ($3): unexpected error: $out" >&2; exit 1 ;; esac
  waited=$(awk -v a="$started" -v b="$(date +%s.%N)" 'BEGIN { printf "%.1f", b - a }')
  awk -v w="$waited" 'BEGIN { exit !(w >= 1) }' || { echo "FAIL ($3): did not wait (${waited}s)" >&2; exit 1; }
}
psql_ -c "insert into invoices values ($o, 'R1', 'TK', 'draft', 1000, null), ($o, 'R2', 'TK', 'draft', 1000, null);
          insert into line_items (org_id, invoice_id, description, qty, price) values ($o, 'R1', 'Conseil', 1, 1000), ($o, 'R2', 'Conseil', 1, 1000);"
race "update invoices set status = 'pending' where id = 'R1'" \
     "insert into line_items (org_id, invoice_id, description, qty, price) values ($o, 'R1', 'Offert', 1, 0)" "issue first"
race "insert into line_items (org_id, invoice_id, description, qty, price) values ($o, 'R2', 'Offert', 1, 0)" \
     "update invoices set status = 'pending' where id = 'R2'" "zero line first"
echo "== Invoice duplicates and lines: all checks pass"

