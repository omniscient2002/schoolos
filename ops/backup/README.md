# Backup, off-host copy, PITR and the restore drill (OPSX-10)

The register's complaint was that `server/scripts/backup.sh` produced a *readable* local dump while the
project claimed an RPO — no off-host copy, no encryption, no point-in-time recovery, and no executed
restore drill. This directory closes those gaps. Everything here is runnable and tested; the tests are the
pin (`server/tests/ops-dr.test.js`, and the end-to-end restore+replay in
`server/tests/backup-restore-drill.test.js`).

## Layers

| Layer | What | Where | Cadence |
|---|---|---|---|
| Logical dump | `pg_dumpall --globals-only` + `pg_dump --format=custom` + files archive, verified | `server/scripts/backup.sh` | nightly 02:17 IST (`ops/cron/schoolos.cron`) |
| Off-host + encryption | AES-256 the whole night dir, verify it decrypts, checksum, place on `OFFSITE_DIR` (a mounted remote) | `ops/backup/encrypt-offsite.sh` | after each backup |
| PITR / WAL | `wal_level=replica`, `archive_mode=on`, `archive_command` to `/wal-archive` | `ops/backup/pitr.compose.yml` | continuous |
| Restore drill | restore a night into a scratch DB, run the DPDP replay, print RTO | `ops/backup/restore-drill.sh` | monthly, and after any schema change |

## Runbook

```sh
# 1. nightly dump (already scheduled)
BACKUP_DIR=/var/backups/schoolos server/scripts/backup.sh

# 2. encrypted off-host copy (key file, not an inline secret)
BACKUP_ENCRYPTION_KEY_FILE=/etc/schoolos/backup.key \
OFFSITE_DIR=/mnt/offsite/schoolos \
  ops/backup/encrypt-offsite.sh /var/backups/schoolos/$(date -u +%F)

# 3. monthly restore drill — measures RTO, verifies the DPDP replay runs
ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres \
DATABASE_URL=postgres://schoolos:***@127.0.0.1:5432/schoolos \
  ops/backup/restore-drill.sh /var/backups/schoolos/$(date -u +%F) schoolos_drill

# 4. PITR (opt-in compose override)
docker compose -f server/docker-compose.yml -f ops/backup/pitr.compose.yml up -d db
```

## Honest limits

- **Off-host is a directory contract.** `OFFSITE_DIR` must be a mount of real off-host storage; the script
  cannot prove where the bytes live, only that the copy is encrypted, verified and checksummed.
- **PITR is configured, not exercised end-to-end here.** A full recovery-window test needs a cluster
  restart and a WAL replay; the override supplies the settings and the archive path. Treat the *first*
  production activation as the drill that proves it.
- **The key is the backup.** If `BACKUP_ENCRYPTION_KEY_FILE` is lost, the offsite copy is unrecoverable.
  Store it separately from `OFFSITE_DIR` (the whole point of encryption is that both are needed).
