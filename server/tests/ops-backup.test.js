import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const backup = readFileSync(join(ROOT, 'scripts/backup.sh'), 'utf8');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

test('nightly backup includes and verifies private file storage', () => {
  assert.match(backup, /FILES_DIR/);
  assert.match(backup, /files\.tar\.gz/);
  assert.match(backup, /tar -tzf "\$storage_archive"/);
  assert.match(readme, /files\.tar\.gz/);
  assert.match(readme, /tar -xzf \/var\/backups\/schoolos/);
});
