// Auth: scrypt password hashing (node crypto — no native deps) + JWT claims.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export const ROLES = ['owner','principal','coordinator','finance','admissions','transport','facilities','technician','teacher','itadmin','parent','student'];

/** Surface a role's data scope: what tenant rows it may read. */
export function roleScope(role) {
  switch (role) {
    case 'parent': return { parentOfOnly: true };
    case 'student': return { selfOnly: true };
    case 'technician': return { maintenanceOnly: true };
    case 'teacher': return { teachingOnly: true };
    default: return { staff: true };
  }
}
