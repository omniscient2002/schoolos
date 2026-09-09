// Onboarding — self-serve school signup (Platform §1.1, migration 053).
//
// The ONE sanctioned runtime path that creates a tenant and its first owner:
// a school owner signs up, the platform mints the school (app.tenants), the
// owner account (the only legitimate owner-creation anywhere — people.admin
// structurally refuses role=owner), and the opening audit/event rows, all in
// ONE owner-path transaction. Everything afterwards rides normal doors:
// people.admin (owner/itadmin) for accounts, the plugins for modules.
//
// Laws honoured:
//   · public door, rate-limited tighter than login (3/min) and kill-switched
//     via SELF_SIGNUP_ENABLED (default: on in development, OFF in production
//     unless explicitly 'true') — a config-guarded refusal, never a silent one
//   · no email verification exists in the platform (no sender) — mitigations:
//     the rate limit, the kill-switch, the audit trail, and the fact that a
//     signup creates an EMPTY tenant (no student data)
//   · hash-chained ledger + event spine written in the creating transaction
//   · auto-login returns the same { token, user } shape as /auth/login
import { randomUUID } from 'node:crypto';
import { auditLog, emitEvent } from './audit.js';
import { q, withUser } from './db.js';
import { hashPassword } from './auth.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SECTIONS = Array.from({ length: 8 }, (_, i) => ({
  grade: String(i + 1),
  sections: ['A', 'B', 'C'],
}));

const slugify = (name) =>
  String(name ?? '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'school';

async function uniqueSlug(base) {
  let candidate = slugify(base);
  if (!SLUG_RE.test(candidate)) candidate = `school-${candidate}`.slice(0, 63);
  for (let n = 0; n < 50; n++) {
    const attempt = n === 0 ? candidate : `${candidate}-${n + 1}`;
    const hit = await q(`SELECT 1 FROM app.tenants WHERE slug=$1`, [attempt]);
    if (!hit.rows[0]) return attempt;
  }
  throw new Error('could not derive a unique school code — try a different name');
}

export function registerOnboarding(app) {
  // --- public: the school-owner signup door -------------------------------
  app.post('/onboard/signup', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (process.env.SELF_SIGNUP_ENABLED !== undefined && process.env.SELF_SIGNUP_ENABLED !== 'true') {
      return reply.code(403).send({ error: 'New-school signups are paused on this platform. Contact the operator.' });
    }
    if (process.env.SELF_SIGNUP_ENABLED === undefined && process.env.NODE_ENV === 'production') {
      return reply.code(403).send({ error: 'New-school signups are paused on this platform. Contact the operator.' });
    }
    const b = req.body ?? {};
    const schoolName = typeof b.schoolName === 'string' ? b.schoolName.trim() : '';
    const ownerName = typeof b.ownerName === 'string' ? b.ownerName.trim() : '';
    const ownerEmail = typeof b.ownerEmail === 'string' ? b.ownerEmail.trim().toLowerCase() : '';
    const ownerPassword = typeof b.ownerPassword === 'string' ? b.ownerPassword : '';
    if (schoolName.length < 3 || schoolName.length > 120) return reply.code(400).send({ error: 'Enter the school\'s full name (3–120 characters)' });
    if (!ownerName) return reply.code(400).send({ error: 'Enter your full name' });
    if (!EMAIL_RE.test(ownerEmail)) return reply.code(400).send({ error: 'Enter a valid email address — you will sign in with it' });
    if (ownerPassword.length < 8) return reply.code(400).send({ error: 'Choose a password of at least 8 characters' });
    const sections = Array.isArray(b.sections) && b.sections.length
      ? b.sections.slice(0, 15).map((s) => ({
          grade: String(s?.grade ?? '').trim(),
          sections: (Array.isArray(s?.sections) ? s.sections : []).map((x) => String(x).toUpperCase().slice(0, 3)).filter(Boolean).slice(0, 8),
        })).filter((s) => s.grade)
      : DEFAULT_SECTIONS;

    const slug = await uniqueSlug(schoolName);
    const config = {
      ...(typeof b.address === 'string' && b.address.trim() ? { address: b.address.trim().slice(0, 300) } : {}),
      ...(typeof b.board === 'string' && b.board.trim() ? { board: b.board.trim().slice(0, 60) } : {}),
      ...(typeof b.phone === 'string' && b.phone.trim() ? { phone: b.phone.trim().slice(0, 20) } : {}),
      setup: { sections, source: 'self-signup', at: new Date().toISOString() },
    };
    const passwordHash = hashPassword(ownerPassword);

    // ONE owner-path transaction: tenant + owner + ledger + event, or nothing.
    const client = await (await import('./db.js')).pool.connect();
    try {
      await client.query('BEGIN');
      const t = (await client.query(
        `INSERT INTO app.tenants (slug, name, config, onboarded_at, onboarded_via)
         VALUES ($1,$2,$3::jsonb, now(), 'self-signup') RETURNING id, slug, name, config`,
        [slug, schoolName, JSON.stringify(config)])).rows[0];
      const u = (await client.query(
        `INSERT INTO app.users (tenant_id, email, name, role, password_hash, active)
         VALUES ($1,$2,$3,'owner',$4,true) RETURNING id, email, name, role, tenant_id`,
        [t.id, ownerEmail, ownerName, passwordHash])).rows[0];
      await auditLog(client, t.id, {
        actor: ownerName, actorRole: 'platform', action: 'Tenant onboarded (self-signup)',
        recordType: 'Tenant', recordRef: `${t.slug} · ${ownerEmail}`,
        reason: 'school-owner signup', policyRef: 'Platform §1.1 (tenant provisioning)', risk: 'medium',
        outcome: `school '${t.name}' created with its first owner — no student data yet` });
      await emitEvent(client, t.id,
        { type: 'platform', label: `New school onboarded: ${t.name} (${t.slug})` },
        'platform.tenant.onboarded.v1',
        { tenantId: t.id, slug: t.slug, ownerUserId: u.id, ownerEmail: u.email, sections });
      await client.query('COMMIT');
      const token = app.jwt.sign({ sub: u.id, role: u.role, tenant: u.tenant_id, name: u.name, jti: randomUUID() }, {});
      return { token, user: { id: u.id, name: u.name, role: u.role, email: u.email, tenantId: u.tenant_id },
        tenant: { id: t.id, slug: t.slug, name: t.name },
        next: { checklist: ['/onboard/status'] } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (/users_.*unique|unique.*users_/iu.test(String(e?.constraint ?? e?.message))) {
        return reply.code(409).send({ error: 'An account with this email already exists in this school. Sign in instead, or use a different email.' });
      }
      if (/tenants_slug/u.test(String(e?.constraint ?? e?.message))) {
        return reply.code(409).send({ error: 'That school code was taken while you were signing up — try again (a fresh one is picked automatically).' });
      }
      req.log.error({ err: e }, 'onboard/signup failed');
      return reply.code(500).send({ error: 'We could not create the school — nothing was saved. Please try again.' });
    } finally {
      client.release();
    }
  });

  // --- owner: update the school profile ------------------------------------
  app.post('/onboard/school', { preHandler: app.authenticate }, async (req, reply) => {
    if (req.user.role !== 'owner') return reply.code(403).send({ error: 'Only the school owner can change the school profile' });
    const b = req.body ?? {};
    const allowed = ['schoolName', 'address', 'board', 'phone', 'campuses'];
    const patches = {};
    if (b.schoolName !== undefined) {
      const n = String(b.schoolName).trim();
      if (n.length < 3 || n.length > 120) return reply.code(400).send({ error: 'School name must be 3–120 characters' });
      patches.name = n;
    }
    for (const k of ['address', 'board', 'phone']) {
      if (b[k] !== undefined) patches[`config.${k}`] = String(b[k]).trim().slice(0, k === 'address' ? 300 : 60);
    }
    if (b.campuses !== undefined) {
      if (!Array.isArray(b.campuses) || b.campuses.length > 12) return reply.code(400).send({ error: 'Campuses must be a list (max 12)' });
      patches['config.campuses'] = b.campuses.map((x) => String(x).trim().slice(0, 60)).filter(Boolean);
    }
    if (!Object.keys(patches).length) return reply.code(400).send({ error: 'Nothing to update — send schoolName, address, board, phone or campuses' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const cur = (await c.query(`SELECT name, config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      if (!cur) return reply.code(404).send({ error: 'School not found' });
      const nextConfig = { ...(cur.config ?? {}) };
      const sets = [];
      const vals = [];
      let i = 1;
      if (patches.name) { sets.push(`name=$${i++}`); vals.push(patches.name); }
      for (const key of ['address', 'board', 'phone']) {
        if (patches[`config.${key}`] !== undefined) { nextConfig[key] = patches[`config.${key}`]; }
      }
      if (patches['config.campuses'] !== undefined) nextConfig.campuses = patches['config.campuses'];
      sets.push(`config=$${i++}`, `onboarded_via=COALESCE(onboarded_via,'self-signup')`);
      vals.push(JSON.stringify(nextConfig));
      await c.query(`UPDATE app.tenants SET ${sets.join(', ')} WHERE id=$${i}`, [...vals, req.user.tenant_id]);
      await auditLog(c, req.user.tenant_id, {
        actor: req.user.name, actorRole: req.user.role, action: 'Updated school profile',
        recordType: 'Tenant', recordRef: cur.name,
        reason: 'onboarding/setup', policyRef: 'Platform §1.1 (tenant provisioning)', risk: 'low',
        outcome: `profile updated: ${Object.keys(patches).join(', ')}` });
      await emitEvent(c, req.user.tenant_id,
        { type: 'platform', label: `School profile updated: ${patches.name ?? cur.name}` },
        'platform.school.updated.v1', { by: req.user.id, fields: Object.keys(patches) });
      return { ok: true, school: { name: patches.name ?? cur.name, config: nextConfig } };
    });
  });

  // --- any authenticated user: setup checklist facts -------------------------
  app.get('/onboard/status', { preHandler: app.authenticate }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = (await c.query(`SELECT name, slug, config, onboarded_at FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      const counts = (await c.query(
        `SELECT
           (SELECT count(*)::int FROM app.students WHERE tenant_id=$1 AND status='active') AS students,
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND role='itadmin') AS itadmins,
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND active) AS accounts,
           (SELECT count(*)::int FROM app.plugins WHERE tenant_id=$1 AND status='enabled') AS plugins_enabled`, [req.user.tenant_id])).rows[0];
      const sections = t?.config?.setup?.sections ?? [];
      return {
        school: { name: t?.name, slug: t?.slug, onboardedAt: t?.onboarded_at, sections },
        counts,
        checklist: [
          { id: 'itadmin', label: 'Create your IT admin (they can add the rest of the staff)', done: counts.itadmins > 0, href: '/people-admin' },
          { id: 'students', label: 'Admit your first students', done: counts.students > 0, href: '/people-admin' },
          { id: 'plugins', label: 'Switch on the modules you need (library, fees, transport…)', done: counts.plugins_enabled > 1, href: '/plugins' },
        ],
      };
    });
  });
}
