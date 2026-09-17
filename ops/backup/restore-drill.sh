#!/usr/bin/env bash
# OPSX-10 — an executable restore drill (RPO/RTO measured, not asserted).
#
# `pg_restore --list` proves a dump is READABLE, not RESTORABLE, and proves nothing about the DPDP replay.
# This drill restores a night's dump into a scratch database, runs the shipped erasure replay, counts the
# surviving rows, and prints how long it took (the restore time is the honest RTO lower bound). It DROPS
# the scratch database at the end unless KEEP=1.
#
#   usage: restore-drill.sh <night-dir> <scratch-db>
#   env:   DATABASE_URL        admin/owner connection used to create the scratch db (libpq or URL)
#          ADMIN_DATABASE_URL  a superuser URL on the same cluster, e.g. postgres://postgres@127.0.0.1:5432
#          KEEP=1              leave the scratch database in place for inspection
set -euo pipefail

NIGHT="${1:?usage: restore-drill.sh <night-dir> <scratch-db>}"
SCRATCH="${2:?usage: restore-drill.sh <night-dir> <scratch-db>}"
[ -d "$NIGHT" ] || { echo "restore-drill: $NIGHT is not a directory" >&2; exit 1; }

DUMP="$(find "$NIGHT" -maxdepth 1 -name '*.dump' | head -1)"
[ -n "$DUMP" ] || { echo "restore-drill: no .dump in $NIGHT" >&2; exit 1; }
SRC_DB="$(basename "$DUMP" .dump)"

ADMIN="${ADMIN_DATABASE_URL:-postgres://postgres@127.0.0.1:5432/postgres}"
RESTORE_URL="${RESTORE_DATABASE_URL:-$(node -e '
  const u=new URL(process.env.DATABASE_URL); u.pathname="/"+process.argv[1]; console.log(u.toString());
' "$SCRATCH")}"

echo "restore-drill: $SRC_DB → $SCRATCH (from $DUMP)"
start=$(date +%s)

psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)"
psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $SCRATCH OWNER schoolos"
pg_restore --no-password -d "$RESTORE_URL" "$DUMP"

# The DPDP replay must run BEFORE the restored database serves traffic (OPS-16).
DATABASE_URL="$RESTORE_URL" node "$(dirname "$0")/../../server/scripts/replay-erasure-journal.js"

# Prove the restored database answers, rather than assuming the restore succeeded.
rows=$(psql "$RESTORE_URL" -Atc "SELECT count(*) FROM app.tenants")
end=$(date +%s)
echo "restore-drill: ✔ restored $SRC_DB into $SCRATCH ($rows tenant row(s)) in $((end - start))s"

if [ "${KEEP:-0}" != "1" ]; then
  psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)"
  echo "restore-drill: scratch database dropped (KEEP=1 to inspect)"
fi
