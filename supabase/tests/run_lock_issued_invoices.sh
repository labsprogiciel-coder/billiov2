#!/usr/bin/env bash
# Checks supabase/migrations/20261201_lock_issued_invoices.sql on a throwaway
# Postgres cluster. Usage: supabase/tests/run_lock_issued_invoices.sh
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
psql_ -f lock_issued_invoices_test.sql

# Two sessions: a draft is being issued (not yet committed) when a line edit starts. The edit must
# wait for the issue, then be refused.
psql_ -c "insert into invoices values ('00000000-0000-0000-0000-00000000000a', 'D2', 'TK', 'Course', '2026-11-01', '2026-11-15', 0, 1000, 'draft', null);
          insert into line_items (org_id, invoice_id, description, qty, price) values ('00000000-0000-0000-0000-00000000000a', 'D2', 'Conseil', 1, 1000);"
psql_ -c "begin; update invoices set status = 'pending' where id = 'D2'; select pg_sleep(2); commit;" >/dev/null &
issue=$!
sleep 0.5
started=$(date +%s.%N)
if out=$(psql_ -c "set request.jwt.claim.role = 'authenticated'; update line_items set price = 2 where invoice_id = 'D2';" 2>&1); then
  echo "FAIL: a line changed while its invoice was being issued" >&2; wait "$issue"; exit 1
fi
wait "$issue"
case "$out" in *issued_invoice_locked*) ;; *) echo "FAIL: unexpected error: $out" >&2; exit 1 ;; esac
waited=$(awk -v a="$started" -v b="$(date +%s.%N)" 'BEGIN { printf "%.1f", b - a }')
awk -v w="$waited" 'BEGIN { exit !(w >= 1) }' || { echo "FAIL: the line edit did not wait for the issue (${waited}s)" >&2; exit 1; }
echo "== Issued invoices locked: all checks pass"

