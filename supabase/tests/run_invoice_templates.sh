#!/usr/bin/env bash
# Checks supabase/migrations/20261110_invoice_templates.sql on a throwaway
# Postgres cluster: loads the stand-in schema, applies the migration, then
# requires the role matrix to pass.
# Usage: supabase/tests/run_invoice_templates.sh   (needs Postgres 14+ binaries)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")"

dir="$(mktemp -d)"
case "$dir" in *[!A-Za-z0-9/._-]*) echo "unsupported temporary path: $dir" >&2; rm -rf "$dir"; exit 1 ;; esac
as_server() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/sh -c "$*"; else sh -c "$*"; fi; }
cleanup() {
  as_server "'$bin/pg_ctl' -D '$dir/data' stop -m fast" >/dev/null 2>&1 || true
  rm -rf "$dir"
}
trap cleanup EXIT
[ "$(id -u)" = 0 ] && chown postgres "$dir"
as_server "'$bin/initdb' -D '$dir/data' -A trust" >/dev/null
as_server "'$bin/pg_ctl' -D '$dir/data' -o \"-k '$dir' -c listen_addresses=''\" -l '$dir/log' start" >/dev/null

export PGOPTIONS="-c client_min_messages=warning"
psql() { "$bin/psql" -h "$dir" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql -f "$here/role_permissions_setup.sql"
psql -c "create table if not exists public.organizations (id uuid primary key);
         insert into public.organizations (id) values ('00000000-0000-0000-0000-00000000000a') on conflict do nothing;"
psql -f "$here/../migrations/20261110_invoice_templates.sql"
psql -f "$here/invoice_templates_matrix.sql"
echo "== invoice_templates: all cells match"
