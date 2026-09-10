#!/usr/bin/env bash
# SchoolOS nightly logical backup (lane L2 T205; ops audit §15: "you cannot
# currently restore this system after data loss").
#
# Per UTC night it writes BACKUP_DIR/<date>/ containing:
#   · globals.sql   — pg_dumpall --globals-only (roles schoolos/schoolos_app,
#                     passwords, memberships — restore this FIRST, see README)
#   · <db>.dump     — pg_dump custom format, verified readable with
#                     `pg_restore --list` before it counts as a backup
# Retention: BACKUP_KEEP_DAYS nights (default 7). Exits non-zero on ANY failure
# and deletes the failed artifact — a partial dump must never look like a backup.
# A missing night dir or a leftover .incomplete marker = that night did not finish.
#
# Connection: standard libpq env (PGHOST/PGPORT/PGUSER/PGPASSWORD or ~/.pgpass).
# Run with a pg_dump whose major version >= the server's. Contains PII — keep
# BACKUP_DIR off the web path, owner-only perms (umask 077 below), encrypted
# volumes at rest.
#
# Cron (host, 02:17 IST nightly — mail on failure, silence on success):
#   17 2 * * * BACKUP_DIR=/var/backups/schoolos PGUSER=postgres /srv/schoolos/server/scripts/backup.sh >> /var/log/schoolos-backup.log 2>&1
# Docker-only variant (no host postgres-client needed; see server/docker-compose.yml):
#   docker compose -f server/docker-compose.yml exec -T db pg_dump -U schoolos --format=custom schoolos > /var/backups/schoolos/schoolos-$(date -u +%F).dump
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/schoolos}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
DATABASES="${BACKUP_DATABASES:-schoolos}" # space-separated; never back up schoolos_test

fail() { echo "backup: ✖ $*" >&2; exit 1; }

command -v pg_dump >/dev/null || fail "pg_dump not found in PATH"
command -v pg_dumpall >/dev/null || fail "pg_dumpall not found in PATH"
command -v pg_restore >/dev/null || fail "pg_restore not found in PATH"

DATE=$(date -u +%Y-%m-%d)
NIGHT_DIR="$BACKUP_DIR/$DATE"
mkdir -p "$NIGHT_DIR"
umask 077 # backups contain student PII — owner-only permissions
: > "$NIGHT_DIR/.incomplete"

echo "backup: $DATE → $NIGHT_DIR (keeping $KEEP_DAYS nights)"

globals="$NIGHT_DIR/globals.sql"
echo "backup: dumping cluster globals (roles, memberships) → $globals"
pg_dumpall --globals-only -f "$globals" || { rm -f "$globals"; fail "pg_dumpall --globals-only failed"; }
[ -s "$globals" ] || { rm -f "$globals"; fail "globals.sql is empty — check connection rights"; }

for db in $DATABASES; do
  out="$NIGHT_DIR/$db.dump"
  echo "backup: dumping $db (custom format) → $out"
  pg_dump --format=custom --no-password -f "$out" "$db" || { rm -f "$out"; fail "pg_dump $db failed"; }
  # A backup is only a backup if the archive actually reads back.
  pg_restore --list "$out" >/dev/null 2>&1 || { rm -f "$out"; fail "verification (pg_restore --list) failed for $db"; }
  echo "backup: ✔ $db dumped and verified"
done

rm -f "$NIGHT_DIR/.incomplete"
echo "backup: ✔ night $DATE complete"

# Retention: prune whole night dirs older than KEEP_DAYS (YYYY-MM-DD shaped only).
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' -mtime "+$KEEP_DAYS" -exec rm -rf -- {} +
echo "backup: retention applied (≤ $KEEP_DAYS nights kept)"
