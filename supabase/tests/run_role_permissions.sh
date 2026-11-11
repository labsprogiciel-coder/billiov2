#!/usr/bin/env bash
# Checks supabase/migrations/20261103_role_permissions.sql on a throwaway
# Postgres cluster: loads the live policies, shows the matrix failing, applies
# the migration, then requires the matrix to pass.
# Usage: supabase/tests/run_role_permissions.sh   (needs Postgres 14+ binaries)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")"

# The cluster trusts every local connection, so its directory (data and
# socket) stays private: mode 0700, owned by whoever runs the server.
dir="$(mktemp -d)"
case "$dir" in *[!A-Za-z0-9/._-]*) echo "unsupported temporary path: $dir" >&2; rm -rf "$dir"; exit 1 ;; esac
# initdb refuses to run as root; use the postgres account then
as_server() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/sh -c "$*"; else sh -c "$*"; fi; }
cleanup() {
  as_server "'$bin/pg_ctl' -D '$dir/data' stop -m fast" >/dev/null 2>&1 || true
  rm -rf "$dir"
}
trap cleanup EXIT
[ "$(id -u)" = 0 ] && chown postgres "$dir"
as_server "'$bin/initdb' -D '$dir/data' -A trust -U postgres" >/dev/null
as_server "'$bin/pg_ctl' -D '$dir/data' -o \"-k '$dir' -c listen_addresses=''\" -l '$dir/log' start" >/dev/null

export PGOPTIONS="-c client_min_messages=warning"
psql() { "$bin/psql" -h "$dir" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql -f "$here/role_permissions_setup.sql"
echo "== Before the migration (failures expected)"
psql -f "$here/role_permissions_matrix.sql" 2>&1 | sed 's/^/   /' || true
echo "== After the migration"
psql -f "$here/../migrations/20261103_role_permissions.sql"
psql -f "$here/role_permissions_matrix.sql"
echo "== Role permission matrix: all cells match"
