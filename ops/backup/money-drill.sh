#!/usr/bin/env bash
# FEE-OPS-4 — the money-path restore drill.
#
# Restores a dump into a scratch database and proves the MONEY survived: the hash-chained audit ledger
# still verifies, the fee ledger's invariants hold, and every receipt and allocation still points at its
# payment. Exits non-zero when anything fails, so a cron drill can alert.
#
#   usage: money-drill.sh <night-dir> <scratch-db>
#   env:   DATABASE_URL        admin/owner connection used to create the scratch db
#          ADMIN_DATABASE_URL  a superuser URL on the same cluster
#          KEEP=1              leave the scratch database in place for inspection
set -euo pipefail

NIGHT="${1:?usage: money-drill.sh <night-dir> <scratch-db>}"
SCRATCH="${2:?usage: money-drill.sh <night-dir> <scratch-db>}"
[ -d "$NIGHT" ] || { echo "money-drill: $NIGHT is not a directory" >&2; exit 1; }

DUMP="$(find "$NIGHT" -maxdepth 1 -name '*.dump' | head -1)"
[ -n "$DUMP" ] || { echo "money-drill: no .dump in $NIGHT" >&2; exit 1; }
SRC_DB="$(basename "$DUMP" .dump)"

ADMIN="${ADMIN_DATABASE_URL:-postgres://postgres@127.0.0.1:5432/postgres}"
RESTORE_URL="${RESTORE_DATABASE_URL:-$(node -e '
  const u=new URL(process.env.DATABASE_URL); u.pathname="/"+process.argv[1]; console.log(u.toString());
' "$SCRATCH")}"

echo "money-drill: $SRC_DB → $SCRATCH (from $DUMP)"
psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)"
psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $SCRATCH OWNER schoolos"
pg_restore --no-password -d "$RESTORE_URL" "$DUMP"

# The DPDP replay must run before the restored database serves traffic (OPS-16), same as restore-drill.
DATABASE_URL="$RESTORE_URL" node "$(dirname "$0")/../../server/scripts/replay-erasure-journal.js"

# Prove the money survived, not just that the database answers.
DATABASE_URL="$RESTORE_URL" node "$(dirname "$0")/../../server/scripts/money-dr-drill.js"

if [ "${KEEP:-0}" != "1" ]; then
  psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)"
  echo "money-drill: scratch database dropped (KEEP=1 to inspect)"
fi
