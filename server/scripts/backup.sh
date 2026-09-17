#!/usr/bin/env bash
# SchoolOS nightly logical backup (lane L2 T205; ops audit §15: "you cannot
# currently restore this system after data loss").
#
# Per UTC night it writes BACKUP_DIR/<date>/ containing:
#   · globals.sql   — pg_dumpall --globals-only (roles schoolos/schoolos_app,
#                     passwords, memberships — restore this FIRST, see README)
#   · <db>.dump     — pg_dump custom format, verified readable with
#                     `pg_restore --list` before it counts as a backup
#   · files.tar.gz   — the private FILES_DIR tree, verified readable with
#                     `tar -tzf` (the database's app.files rows reference these bytes)
# Retention: BACKUP_KEEP_DAYS nights (default 7). Exits non-zero on ANY failure
# and deletes the failed artifact — a partial dump must never look like a backup.
# A missing night dir or a leftover .incomplete marker = that night did not finish.
#
# Connection: standard libpq env (PGHOST/PGPORT/PGUSER/PGPASSWORD or ~/.pgpass).
# Run with a pg_dump whose major version >= the server's. Contains PII — keep
# BACKUP_DIR off the web path, owner-only perms (umask 077 below), encrypted
# volumes at rest.
#
# Cron: install the COMMITTED schedule instead of copying a line out of this header —
#   crontab ops/cron/schoolos.cron
# It runs this script at 02:17 IST nightly and `server/scripts/health-probe.js` at 02:45, so a night that
# did not happen becomes an ALERT rather than something an operator has to remember to check. (OPS-6: the
# register's complaint was not that this script is bad — it is not — but that NOTHING RAN IT while the
# README claimed an RPO. `tests/ops-deploy.test.js` now asserts the schedule references this file, so the
# two cannot drift apart again.)
# The docker-only variant that used to be documented here (a flat pg_dump piped to gzip) was NOT
# equivalent: no globals, no `pg_restore --list` verification, no retention. It has been removed rather
# than left as a tempting one-liner.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/schoolos}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
DATABASES="${BACKUP_DATABASES:-schoolos}" # space-separated; never back up schoolos_test
# Optional: where to record the last successful run for health-probe.js (the app.ops_counters row). Set
# to empty to skip the record entirely (e.g. no psql on the host).
RECORD_LAST_RUN="${BACKUP_RECORD_LAST_RUN:-1}"

fail() { echo "backup: ✖ $*" >&2; exit 1; }

command -v pg_dump >/dev/null || fail "pg_dump not found in PATH"
command -v pg_dumpall >/dev/null || fail "pg_dumpall not found in PATH"
command -v pg_restore >/dev/null || fail "pg_restore not found in PATH"
command -v tar >/dev/null || fail "tar not found in PATH"

# OPS-6 — umask BEFORE the directory is created, not after. The register/recon found `mkdir -p` at :37
# followed by `umask 077` at :38, so the night directory inherited the caller's umask (022 → 0755,
# world-traversable) while the FILES inside it were correctly 0600. Directories holding student PII must
# not be traversable by other local users, and "owner-only perms" is a claim the README makes.
umask 077

DATE=$(date -u +%Y-%m-%d)
NIGHT_DIR="$BACKUP_DIR/$DATE"
mkdir -p "$NIGHT_DIR"
chmod 700 "$BACKUP_DIR" "$NIGHT_DIR"
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

# OPS-16 — database rows are not enough to restore uploaded documents. Keep the
# storage tree beside the matching dump. An absent storage directory is a valid
# empty store (fresh installs often have one), but the archive is always present
# so a restore can distinguish "empty" from "not backed up".
storage_dir="${FILES_DIR:-$(cd "$(dirname "$0")/.." && pwd)/storage}"
storage_archive="$NIGHT_DIR/files.tar.gz"
storage_parent=$(dirname "$storage_dir")
storage_name=$(basename "$storage_dir")
echo "backup: archiving private file storage → $storage_archive"
if [ -d "$storage_dir" ]; then
  tar -czf "$storage_archive" -C "$storage_parent" "$storage_name" || { rm -f "$storage_archive"; fail "file storage archive failed"; }
else
  tar -czf "$storage_archive" -C "$storage_parent" --files-from /dev/null || { rm -f "$storage_archive"; fail "empty file storage archive failed"; }
fi
tar -tzf "$storage_archive" >/dev/null 2>&1 || { rm -f "$storage_archive"; fail "file storage archive verification failed"; }
echo "backup: ✔ file storage archived and verified"
# OPSX-2: under compose the live document bytes live in the named `files` volume, not in this host
# directory. `docker compose run --rm files-backup` writes backups/files/files-<date>.tar.gz; run it
# before this script so a full restore has both the DB and the documents. This note makes the broken
# assumption visible instead of archiving an empty tree and calling it done.
if [ ! -d "$storage_dir" ] && [ -z "${FILES_DIR:-}" ]; then
  echo "backup: note — no host storage tree; if this stack runs under compose, run 'docker compose run --rm files-backup' first (OPSX-2)"
fi

rm -f "$NIGHT_DIR/.incomplete"
echo "backup: ✔ night $DATE complete"

# OPS-6 — record the run so "did last night happen?" is answerable without a shell, and so
# health-probe.js's backup_missing rule has something to read. Deliberately AFTER the .incomplete marker
# is cleared: this row is a claim that a COMPLETE, VERIFIED night exists.
#
# app.ops_counters is an existing table (050) rather than a new one on purpose — the point of this finding
# is that the backup runs at all, and a new table plus a migration would be a second thing that can be
# absent. Recorded through psql because this is a HOST script with a host pg client (the same requirement
# the dumps above already impose). A failure to record is a WARNING, not a failed backup: the dump on
# disk is real, and silently discarding a good backup because telemetry could not be written would be
# exactly the kind of success-shaped inversion this register is full of.
if [ "$RECORD_LAST_RUN" != "0" ] && command -v psql >/dev/null; then
  if psql -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO app.ops_counters (name, value) VALUES ('backup_last_success_epoch', $(date -u +%s))
         ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()" \
      >/dev/null 2>&1; then
    echo "backup: ✔ last-run recorded (app.ops_counters.backup_last_success_epoch)"
  else
    echo "backup: ⚠ last-run record NOT written (psql failed) — the dumps are fine, but" >&2
    echo "        health-probe.js's backup_missing rule will report this host as unbacked-up." >&2
  fi
fi

# Retention: prune whole night dirs older than KEEP_DAYS (YYYY-MM-DD shaped only).
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' -mtime "+$KEEP_DAYS" -exec rm -rf -- {} +
echo "backup: retention applied (≤ $KEEP_DAYS nights kept)"
