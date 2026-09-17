// SEC-23: envelope encryption for secret-class plugin settings.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { isSecretKey } from './settings-contract.js';

const masterKey = () => process.env.PLUGIN_SETTINGS_KEY ?? process.env.JWT_SECRET ?? 'dev-only-secret-change-me';
const keyFor = (tenantId) => createHash('sha256').update(`${masterKey()}:plugin-settings:${tenantId}`).digest();
const seal = (value, tenantId) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(tenantId), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return { __encrypted: true, v: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
};
const open = (value, tenantId) => {
  if (!value || value.__encrypted !== true) return value; // backwards-compatible migration
  const decipher = createDecipheriv('aes-256-gcm', keyFor(tenantId), Buffer.from(value.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64url')), decipher.final()]));
};
/* The same tenant-bound envelope is also used for the DPDP restore token. It
   is deliberately separate from plugin settings so callers cannot accidentally
   classify a recovery secret as a user-visible setting. */
export const encryptValue = (value, tenantId) => seal(value, tenantId);
export const decryptValue = (value, tenantId) => open(value, tenantId);
export const encryptSettings = (settings, tenantId) => Object.fromEntries(Object.entries(settings ?? {}).map(([k, v]) => [k, isSecretKey(k) && v != null && !(v && v.__encrypted) ? seal(v, tenantId) : v]));
export const decryptSettings = (settings, tenantId) => Object.fromEntries(Object.entries(settings ?? {}).map(([k, v]) => [k, isSecretKey(k) ? open(v, tenantId) : v]));
export const maskSettings = (settings) => Object.fromEntries(Object.entries(settings ?? {}).map(([k, v]) => [k, isSecretKey(k) && v != null ? '••••••••' : v]));
