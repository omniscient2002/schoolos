#!/usr/bin/env bash
# OPSX-10 — encrypted off-host copy of a completed backup night.
#
# The register's gap: `backup.sh` writes a night directory locally and proves it is READABLE, but a local
# disk is not an off-host copy, and PII at rest was unencrypted. This script turns a night directory into a
# single AES-256 encrypted archive, verifies it decrypts, records a checksum, and places it in OFFSITE_DIR —
# which in production is a mounted remote (rclone/sshfs/NFS/object-store FUSE). Being a plain directory
# target is deliberate: the same code path is provable locally in a test, and swapping the mount for a
# remote needs no change here.
#
#   usage: encrypt-offsite.sh <night-dir>
#   env:   OFFSITE_DIR               (required) destination directory
#          BACKUP_ENCRYPTION_KEY      passphrase, OR
#          BACKUP_ENCRYPTION_KEY_FILE file containing the passphrase (preferred)
set -euo pipefail

SRC="${1:?usage: encrypt-offsite.sh <night-dir>}"
OFFSITE_DIR="${OFFSITE_DIR:?set OFFSITE_DIR to the off-host destination}"
SRC="$(cd "$SRC" && pwd)"
[ -d "$SRC" ] || { echo "encrypt-offsite: $SRC is not a directory" >&2; exit 1; }
command -v openssl >/dev/null || { echo "encrypt-offsite: openssl not found" >&2; exit 1; }
command -v tar >/dev/null || { echo "encrypt-offsite: tar not found" >&2; exit 1; }

if [ -n "${BACKUP_ENCRYPTION_KEY_FILE:-}" ]; then
  [ -r "$BACKUP_ENCRYPTION_KEY_FILE" ] || { echo "encrypt-offsite: key file not readable" >&2; exit 1; }
  PASSARG=(-pass "file:$BACKUP_ENCRYPTION_KEY_FILE")
elif [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  export BACKUP_ENCRYPTION_KEY
  PASSARG=(-pass env:BACKUP_ENCRYPTION_KEY)
else
  echo "encrypt-offsite: set BACKUP_ENCRYPTION_KEY_FILE (preferred) or BACKUP_ENCRYPTION_KEY" >&2
  exit 1
fi

name="$(basename "$SRC")"
out="$OFFSITE_DIR/$name.tar.gz.enc"
mkdir -p "$OFFSITE_DIR"
tmp="$out.partial"
rm -f "$tmp"

# tar the WHOLE night directory (globals.sql + dump + files.tar.gz), then encrypt the stream. The `.partial`
# suffix means an interrupted upload can never masquerade as a completed offsite copy.
tar -czf - -C "$(dirname "$SRC")" "$name" | openssl enc -aes-256-cbc -pbkdf2 -salt "${PASSARG[@]}" -out "$tmp"
mv "$tmp" "$out"

# A copy is only a copy if it decrypts back to a readable archive.
if ! openssl enc -d -aes-256-cbc -pbkdf2 "${PASSARG[@]}" -in "$out" | tar -tzf - >/dev/null 2>&1; then
  rm -f "$out"
  echo "encrypt-offsite: verification failed — the encrypted archive did not decrypt to a readable tar" >&2
  exit 1
fi

sha256sum "$out" | awk '{print $1}' > "$out.sha256"
echo "encrypt-offsite: ✔ $name → $out ($(du -h "$out" | cut -f1), sha256 recorded)"
