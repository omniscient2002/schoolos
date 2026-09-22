/* Kernel file-artifact writer — the smallest possible bridge for kernel-generated artifacts (fee receipts)
 * into the SAME private store the files.store plugin owns (FEE-DAT-3b).
 *
 * Bytes are never web-served: they land under FILES_DIR (default <repo>/server/storage/<tenant_id>/) with a
 * server-side uuid name and a metadata row in app.files. The download path is files.store's audited door,
 * so a receipt PDF inherits the plugin's access checks (scope=student admits the child's guardians).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const storageBase = () => process.env.FILES_DIR ?? join(SERVER_DIR, 'storage');

export async function putFile(c, tenantId, uploaderId, { filename, mime = 'application/pdf', buf, scope = 'student', refId = null }) {
  const ext = /\.([a-z0-9]+)$/i.exec(String(filename))?.[1]?.toLowerCase() ?? 'bin';
  const dir = join(storageBase(), tenantId);
  const diskName = `${randomUUID()}.${ext}`;
  const relPath = `${tenantId}/${diskName}`;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, diskName), buf);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const row = (await c.query(
    `INSERT INTO app.files (tenant_id, uploader_id, filename, mime, bytes, sha256, storage_path, scope, ref_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, filename, mime, bytes, sha256, storage_path, scope, ref_id, created_at`,
    [tenantId, uploaderId, filename, mime, buf.length, sha256, relPath, scope, refId])).rows[0];
  return row;
}
