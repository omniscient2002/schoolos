#!/usr/bin/env node
/* OPS-16: replay DPDP redactions after restoring a database backup.
 *
 * The journal stores only an encrypted subject token. This process decrypts it
 * in memory, rewrites the same surfaces as the live erasure path, and records
 * replayed_at. It never prints or persists the recovered phone number. Run it
 * only after migrations and before serving restored traffic:
 *   node scripts/replay-erasure-journal.js
 */
import { sysq, tx } from '../src/db.js';
import { decryptValue } from '../src/settings-crypto.js';

const scrub = (value, digits, surrogate) => {
  if (typeof value === 'string') return value.replace(/(\+?\d[\d\s\-()–]{7,}\d)/g, (match) =>
    match.replace(/\D/g, '') === digits ? surrogate : match);
  if (Array.isArray(value)) return value.map((item) => scrub(item, digits, surrogate));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, digits, surrogate)]));
  return value;
};

async function replay(row) {
  const token = decryptValue(row.subject_token, row.tenant_id);
  const norm = String(token?.subject ?? '');
  const digits = norm.replace(/\D/g, '');
  if (!digits) throw new Error(`journal ${row.id} has an invalid replay token`);
  const counts = await tx(async (c) => {
    const result = {};
    const hit = async (name, sql, params) => { result[name] = (await c.query(sql, params)).rowCount ?? 0; };
    await hit('consent', `UPDATE plugin_dpdp.consent SET subject_ref='[erased:'||id||']', evidence=jsonb_build_object('erased',true,'replayedAt',now()) WHERE tenant_id=$1 AND regexp_replace(subject_ref, '[^0-9]', '', 'g') = $2`, [row.tenant_id, digits]);
    await hit('admissions', `UPDATE plugin_admissions.lead SET guardian_name=NULL, guardian_phone='[erased:'||id||']' WHERE tenant_id=$1 AND regexp_replace(guardian_phone, '[^0-9]', '', 'g') = $2`, [row.tenant_id, digits]);
    await hit('guardians', `UPDATE app.guardians SET phone=$3, name='[erased:'||id||']' WHERE tenant_id=$1 AND regexp_replace(phone, '[^0-9]', '', 'g') = $2`, [row.tenant_id, digits, row.surrogate]);

    const comms = (await c.query(`SELECT id, audience_json FROM app.communications WHERE tenant_id=$1 AND regexp_replace(audience_json::text, '[^0-9]', '', 'g') LIKE '%' || $2 || '%'`, [row.tenant_id, digits])).rows;
    for (const item of comms) await c.query(`UPDATE app.communications SET audience_json=$3::jsonb WHERE id=$1 AND tenant_id=$2`, [item.id, row.tenant_id, JSON.stringify(scrub(item.audience_json, digits, row.surrogate))]);
    result.comms = comms.length;

    for (const [schema, table] of [['plugin_razorpay', 'webhook_log'], ['plugin_razorpay', 'order_log'], ['plugin_upi', 'webhook_log']]) {
      const rows = (await c.query(`SELECT id, payload FROM ${schema}.${table} WHERE tenant_id=$1 AND regexp_replace(payload::text, '[^0-9]', '', 'g') LIKE '%' || $2 || '%'`, [row.tenant_id, digits]).catch(() => ({ rows: [] }))).rows;
      for (const item of rows) await c.query(`UPDATE ${schema}.${table} SET payload=$3::jsonb WHERE id=$1 AND tenant_id=$2`, [item.id, row.tenant_id, JSON.stringify(scrub(item.payload, digits, row.surrogate))]);
      result[`${schema}.${table}`] = rows.length;
    }
    await hit('pickupOtp', `DELETE FROM plugin_visitors.pickup_otp WHERE tenant_id=$1 AND regexp_replace(phone, '[^0-9]', '', 'g') = $2`, [row.tenant_id, digits]);
    await hit('authOtp', `DELETE FROM app.auth_otps WHERE tenant_id=$1 AND regexp_replace(phone, '[^0-9]', '', 'g') = $2`, [row.tenant_id, digits]);
    await hit('visitors', `UPDATE plugin_visitors.visit SET visitor_phone=NULL WHERE tenant_id=$1 AND regexp_replace(visitor_phone, '[^0-9]', '', 'g') = $2`, [row.tenant_id, digits]);
    await hit('sar', `UPDATE plugin_dpdp.sar SET subject_ref=$3 WHERE tenant_id=$1 AND regexp_replace(subject_ref, '[^0-9]', '', 'g') = $2`, [row.tenant_id, digits, row.surrogate]);
    await hit('students', `UPDATE app.students SET guardian_phone=NULL, guardian_name=CASE WHEN guardian_name IS NULL THEN NULL ELSE '[erased:'||id||']' END WHERE tenant_id=$1 AND regexp_replace(guardian_phone, '[^0-9]', '', 'g') = $2`, [row.tenant_id, digits]);
    await c.query(`UPDATE plugin_dpdp.erasure_journal SET replayed_at=now() WHERE id=$1`, [row.id]);
    return result;
  });
  return counts;
}

const rows = (await sysq(`SELECT id, tenant_id, surrogate, subject_token FROM plugin_dpdp.erasure_journal WHERE subject_token IS NOT NULL AND replayed_at IS NULL ORDER BY executed_at, id`)).rows;
let replayed = 0;
for (const row of rows) {
  await replay(row);
  replayed++;
}
console.log(`erasure replay: ${replayed} journal entr${replayed === 1 ? 'y' : 'ies'} reconciled`);
await import('../src/db.js').then(({ pool }) => pool.end());
