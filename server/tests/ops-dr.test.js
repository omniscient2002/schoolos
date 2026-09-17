// OPSX-10 — the off-host encrypted copy is a real, executable step, and PITR is actually configured.
//
// The register: "No off-host copy, encryption, PITR/WAL archiving, or restore drill; pg_restore --list
// proves readability only." The restore drill is executed for real in `backup-restore-drill.test.js`.
// This file pins the other two halves: `encrypt-offsite.sh` must produce an encrypted, verified,
// checksummed copy that decrypts back to the night's contents (not merely print that it did), and the
// PITR override must carry the WAL settings that make point-in-time recovery possible.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPS = join(REPO, 'ops', 'backup');

let tmp;
before(() => { tmp = mkdtempSync(join(tmpdir(), 'opsdr-')); });
after(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('OPSX-10 · encrypted off-host copy', () => {
  test('a night directory becomes a verified, checksummed AES-256 archive that decrypts back', () => {
    const night = join(tmp, '2026-09-17');
    writeFileSync(join(tmp, 'placeholder'), '');
    // build a small night dir
    execFileSync('mkdir', ['-p', night]);
    writeFileSync(join(night, 'globals.sql'), 'CREATE ROLE schoolos;\n');
    writeFileSync(join(night, 'schoolos.dump'), 'not-a-real-dump-but-real-bytes');
    const key = join(tmp, 'backup.key');
    writeFileSync(key, 'correct horse battery staple\n');
    const offsite = join(tmp, 'offsite');

    const out = execFileSync('bash', [join(OPS, 'encrypt-offsite.sh'), night], {
      encoding: 'utf8',
      env: { ...process.env, BACKUP_ENCRYPTION_KEY_FILE: key, OFFSITE_DIR: offsite },
    });
    assert.match(out, /✔/, `encrypt-offsite output: ${out}`);

    const enc = join(offsite, '2026-09-17.tar.gz.enc');
    assert.ok(existsSync(enc), 'the encrypted archive must exist');
    assert.ok(existsSync(`${enc}.sha256`), 'a checksum must be recorded');

    // the recorded checksum is the checksum of the bytes actually written
    const actual = createHash('sha256').update(readFileSync(enc)).digest('hex');
    assert.equal(readFileSync(`${enc}.sha256`, 'utf8').trim(), actual, 'checksum must match the archive');

    // the copy is genuinely ENCRYPTED — it is not a tar readable without the key
    assert.throws(() => execFileSync('tar', ['-tzf', enc], { stdio: 'pipe' }),
      'the offsite artifact must not be a plain tar');

    // and it decrypts back to the night's contents (the script verifies this, we prove it independently)
    const listed = execFileSync('bash', ['-c',
      `openssl enc -d -aes-256-cbc -pbkdf2 -pass file:'${key}' -in '${enc}' | tar -tzf -`],
    { encoding: 'utf8', env: { ...process.env } });
    assert.match(listed, /2026-09-17\/globals\.sql/);
    assert.match(listed, /2026-09-17\/schoolos\.dump/);
  });

  test('a wrong key cannot decrypt the offsite copy', () => {
    const emb = join(tmp, 'wrongcase');
    const night = join(emb, '2026-09-18');
    execFileSync('mkdir', ['-p', night]);
    writeFileSync(join(night, 'globals.sql'), 'CREATE ROLE schoolos;\n');
    const key = join(emb, 'k');
    writeFileSync(key, 'the-right-key\n');
    execFileSync('bash', [join(OPS, 'encrypt-offsite.sh'), night], {
      env: { ...process.env, BACKUP_ENCRYPTION_KEY_FILE: key, OFFSITE_DIR: join(emb, 'off') },
    });
    const bad = join(emb, 'bad');
    writeFileSync(bad, 'the-wrong-key\n');
    assert.throws(
      () => execFileSync('bash', ['-c', `openssl enc -d -aes-256-cbc -pbkdf2 -pass file:'${bad}' -in '${join(emb, 'off', '2026-09-18.tar.gz.enc')}' | tar -tzf -`], { stdio: 'pipe' }),
      'a wrong key must fail authentication');
  });
});

describe('OPSX-10 · PITR is configured', () => {
  test('the PITR override enables WAL archiving off the data volume', () => {
    const yml = readFileSync(join(OPS, 'pitr.compose.yml'), 'utf8');
    assert.match(yml, /wal_level=replica/, 'wal_level must be set for archiving');
    assert.match(yml, /archive_mode=on/, 'archive_mode must be on');
    assert.match(yml, /archive_command=.*%f/, 'archive_command must copy WAL segments');
    assert.match(yml, /wal-archive/, 'WAL must be archived to a path that is not the pgdata volume');
  });
});
