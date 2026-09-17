// Auth: scrypt password hashing (node crypto — no native deps) + JWT claims.
// Security audit P1-6/P2-16 hardening:
//   · COST — hashing now uses scrypt N=2^17, r=8, p=1, keylen 64, maxmem 160MB
//     (~2^17·128·8 = 128MB working memory + node's slack; 32MB/64MB node defaults
//     reject N=2^17 outright). ~0.4s/hash: brute-force over stolen dumps is ~400×
//     more expensive than the old default-cost N=16384 (~1ms).
//   · VERIFY COMPATIBILITY — stored hashes carry no parameters, so verifyPassword
//     tries the current cost first and falls back to the legacy N=16384 on mismatch;
//     every login gradually rehashes accounts to the new cost (hashPassword).
//   · MALFORMED INPUT — scryptSync throws on garbage (salt/hash not hex, absurd
//     lengths): every call is wrapped and returns false instead of a 500.
//   · dummyVerify — user-miss logins still pay the full hash cost (the "fake user"
//     timing oracle is closed by the caller; out of this lane's files, wiring owned
//     by the orchestrator).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
// maxmem must cover scrypt's 128·N·r working set (128MiB at N=2^17, r=8) — node's
// 32MB default and 64MB both raise ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
const STRONG = { N: 2 ** 17, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const LEGACY = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN, STRONG).toString('hex');
  return `${salt}:${hash}`;
}

/** P2-16: never throw on attacker-controlled stored hashes — malformed ⇒ false. */
function scryptEqual(password, salt, hashHex, params) {
  try {
    const candidate = scryptSync(password, salt, KEYLEN, params);
    const expected = Buffer.from(hashHex, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function verifyPasswordDetailed(password, stored) {
  if (typeof stored !== 'string') return { valid: false, needsRehash: false };
  const parts = stored.split(':');
  if (parts.length < 2) return { valid: false, needsRehash: false };
  const [salt, hash] = parts;
  if (!salt || !hash) return { valid: false, needsRehash: false };
  // P1-6: hashes store no params — new cost first, then the legacy cost so every
  // pre-hardening account keeps logging in (and is rehashed to STRONG on next
  // password set via hashPassword).
  if (scryptEqual(password, salt, hash, STRONG)) return { valid: true, needsRehash: false };
  if (scryptEqual(password, salt, hash, LEGACY)) return { valid: true, needsRehash: true };
  return { valid: false, needsRehash: false };
}

export function verifyPassword(password, stored) {
  return verifyPasswordDetailed(password, stored).valid;
}

// Constant-work fixture for the user-miss path: the caller verifies the throwaway
// hash when the email doesn't exist so both bad-password and unknown-user logins
// burn the same ~0.4s (no timing oracle on account existence).
const DUMMY_HASH = 'b211b89401ef24267eec2caa1073edda:e8e41e87803bb45a8ff742fcffaff954544e53bf03a8cbb613b4d6e5130d99ed34b8e34f1b222458d1d8e44134cf6978f2a25ee69e239aaf12cefa98fa031a91';
export function dummyVerify(password) {
  return verifyPassword(password, DUMMY_HASH);
}

/* RBAC-2: `counselor` is the 13th role and it was MISSING here while five gate lists named it — so the
   safeguarding surfaces (the product's most sensitive) could never have a dedicated role, and the two
   shipped screens that authorise a counselor (`app/src/screens/student/WellbeingQueue.tsx` STAFF_ROLES,
   `teacher.support`'s box readers) described a role the server refused to issue. The docs already publish
   13 roles; the code now agrees with them (RBAC-8). Adding it here is what makes those lists satisfiable and
   lets a custom role use `counselor` as its base. */
export const ROLES = ['owner','principal','coordinator','counselor','finance','admissions','transport','facilities','technician','teacher','itadmin','parent','student'];

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
