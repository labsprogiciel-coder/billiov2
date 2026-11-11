#!/usr/bin/env bash
# Checks supabase/migrations/20261113_invoice_numbering.sql on a throwaway
# Postgres cluster, then issues invoices from parallel sessions and checks the
# series has no gap or duplicate. Usage: supabase/tests/run_numbering.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")"
dir="$(mktemp -d)"
case "$dir" in *[!A-Za-z0-9/._-]*) echo "unsupported temporary path: $dir" >&2; rm -rf "$dir"; exit 1 ;; esac
as_server() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/sh -c "$*"; else sh -c "$*"; fi; }
cleanup() { as_server "'$bin/pg_ctl' -D '$dir/data' stop -m fast" >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
[ "$(id -u)" = 0 ] && chown postgres "$dir"
as_server "'$bin/initdb' -D '$dir/data' -A trust" >/dev/null
as_server "'$bin/pg_ctl' -D '$dir/data' -o \"-k '$dir' -c listen_addresses=''\" -l '$dir/log' start" >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
psql_() { "$bin/psql" -h "$dir" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
cd "$here"
psql_ -f numbering_test.sql
echo "== Numbering rules: all checks pass"

# Concurrency: 4 sessions issue 50 invoices each for a fresh organisation, one
# transaction per invoice, a quarter of them rolled back after taking a number
org='00000000-0000-0000-0000-0000000000c3'
psql_ -c "insert into organizations values ('$org', 'C')"
pids=()
for s in 1 2 3 4; do
  (
    for i in $(seq 1 50); do
      if [ $((i % 4)) = 0 ]; then end='rollback'; else end='commit'; fi
      echo "begin; insert into invoices (id, org_id, status) values ('P$s-$i', '$org', 'pending'); $end;"
    done | psql_ >/dev/null
  ) &
  pids+=("$!")
done
# Wait for each session, so one that failed fails the run
for pid in "${pids[@]}"; do wait "$pid"; done
psql_ -At -c "
  with n as (select split_part(number, '-', 3)::int as k from invoices where org_id = '$org')
  select count(*), count(distinct k), min(k), max(k) from n" | {
  IFS='|' read -r total distinct lo hi
  if [ "$total" = 152 ] && [ "$distinct" = 152 ] && [ "$lo" = 1 ] && [ "$hi" = 152 ]; then
    echo "== Concurrent issues: 152 invoices numbered 1..152, no gap or duplicate"
  else
    echo "concurrency check failed: total=$total distinct=$distinct min=$lo max=$hi" >&2; exit 1
  fi
}

# Together with the Solo limit trigger (separate database)
"$bin/psql" -h "$dir" -U postgres -d postgres -q -c 'create database with_limit'
"$bin/psql" -h "$dir" -U postgres -d with_limit -v ON_ERROR_STOP=1 -q -f numbering_with_limit_test.sql
echo "== With the Solo limit: a refused invoice uses up no number"
