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
import { ensurePluginCatalog, DEFAULT_ON } from './plugin-catalog.js';
import { q, sysq, withUser } from './db.js';
import { hashPassword } from './auth.js';
import { toE164 } from './plugins/_shared/phone.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/* A new school starts with NO classes: the structure is the school's own to define (owner,
   principal or IT admin) on the Classes & sections screen, and the setup checklist points there.
   Fabricating "1–8 × A/B/C" put sections on the roster that nobody chose and every filter then
   offered. A caller MAY still supply `sections` in the signup body; absent that, the list is empty. */
const DEFAULT_SECTIONS = [];

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
    const hit = await sysq(`SELECT 1 FROM app.tenants WHERE slug=$1`, [attempt]);
    if (!hit.rows[0]) return attempt;
  }
  throw new Error('could not derive a unique school code — try a different name');
}

/* School profile — the identity card every future module reads. Stored in
   `app.tenants.config` beside the original address/board/phone keys (no new
   columns), so old and new schools share one shape:
     · structured address (line/city/state/postalCode/country) — invoices,
       report cards, tax and transport need parts, not a blob
     · contact email + website — printed on invoices, report cards, parent comms
     · timezone — IANA, validated. Attendance, sessions, timetables and reports
       all schedule in this; a school must never inherit the server's locale.
   Caps are REJECTED here, never silently sliced (the old slice-on-write hid
   data loss): over-long values answer 400 naming the field. */
const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const PROFILE_CAPS = {
  address: 300, city: 80, state: 80, postalCode: 20, country: 80,
  board: 60, phone: 30, email: 120, website: 120, timezone: 80,
};
const WEBSITE_RE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i;

const isValidTimeZone = (tz) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
};

/* Validate + normalise one profile value. Returns { value } for storage, or
   { error } with the 400 message. `undefined` means "not supplied" (signup);
   empty string means "clear it" (profile update) — the caller decides which
   keys to pass, this only judges them. */
function profileValue(key, raw) {
  if (raw === undefined) return {};
  const s = String(raw).trim();
  if (!s) return { value: '' };
  if (key === 'email') {
    const v = s.toLowerCase();
    if (!EMAIL_RE.test(v)) return { error: 'Enter a valid school email address' };
    return { value: v.slice(0, PROFILE_CAPS.email) };
  }
  if (key === 'website') {
    if (s.length > PROFILE_CAPS.website || !WEBSITE_RE.test(s)) {
      return { error: 'Enter a valid website, e.g. yourschool.in' };
    }
    return { value: (/^https?:\/\//i.test(s) ? s : `https://${s}`).slice(0, PROFILE_CAPS.website) };
  }
  if (key === 'timezone') {
    if (s.length > PROFILE_CAPS.timezone || !isValidTimeZone(s)) {
      return { error: 'Pick a valid timezone, e.g. Asia/Kolkata' };
    }
    return { value: s };
  }
  const cap = PROFILE_CAPS[key];
  if (cap === undefined) return {};
  if (s.length > cap) return { error: `School ${key} must be ${cap} characters or fewer` };
  return { value: s };
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
    /* Owner phone (optional): normalised to E.164 through the project's ONE
       normaliser — the stored shape the OTP doors look up, so a number saved
       here can actually sign in, receive resets and be MFA-reached later. */
    let ownerPhone = null;
    if (typeof b.ownerPhone === 'string' && b.ownerPhone.trim()) {
      ownerPhone = toE164(b.ownerPhone);
      if (!ownerPhone) return reply.code(400).send({ error: 'That phone number is not usable — enter it with the country code, e.g. +91 98450 00101' });
    }
    const sections = Array.isArray(b.sections) && b.sections.length
      ? b.sections.slice(0, 15).map((s) => ({
          grade: String(s?.grade ?? '').trim(),
          sections: (Array.isArray(s?.sections) ? s.sections : []).map((x) => String(x).toUpperCase().slice(0, 3)).filter(Boolean).slice(0, 8),
        })).filter((s) => s.grade)
      : DEFAULT_SECTIONS;

    const slug = await uniqueSlug(schoolName);
    /* Every profile key goes through the shared validator (reject, never
       silent-slice). Timezone defaults when omitted — a school must always
       have one, and the signup form proposes the browser's own zone. */
    const config = {};
    for (const key of Object.keys(PROFILE_CAPS)) {
      const raw = key === 'timezone' && (b.timezone === undefined || (typeof b.timezone === 'string' && !b.timezone.trim()))
        ? DEFAULT_TIMEZONE
        : b[key];
      const r = profileValue(key, raw);
      if (r.error) return reply.code(400).send({ error: r.error });
      if (r.value) config[key] = r.value;
    }
    config.setup = { sections, source: 'self-signup', at: new Date().toISOString() };
    const passwordHash = hashPassword(ownerPassword);

    // ONE owner-path transaction: tenant + owner + ledger + event, or nothing.
    const client = await (await import('./db.js')).pool.connect();
    try {
      await client.query('BEGIN');
      const t = (await client.query(
        `INSERT INTO app.tenants (slug, name, config, onboarded_at, onboarded_via)
         VALUES ($1,$2,$3::jsonb, now(), 'self-signup') RETURNING id, slug, name, config`,
        [slug, schoolName, JSON.stringify(config)])).rows[0];
      /* M5 POLICY DECISION — no forced change on self-signup. Unlike an admin-provisioned account
         (people.admin mints a CSPRNG temporary password and stamps `force_change=true` so the person
         must replace a secret they did not choose), the owner here CHOSE their own password and it is
         never shown to or stored by anyone else. A forced change would be ceremony with no security
         benefit, so `force_change` is deliberately left at its default (false). The account still
         carries `session_epoch`/MFA/idle protections like every other. */
      const u = (await client.query(
        `INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone, active)
         VALUES ($1,$2,$3,'owner',$4,$5,true) RETURNING id, email, name, role, tenant_id, session_epoch`,
        [t.id, ownerEmail, ownerName, passwordHash, ownerPhone])).rows[0];
      /* Every school is born with its full plugin catalog (docs/12): rows land
         'registered' — the plugin manager has real switches on day one and
         enabling stays an audited owner action. RLS on app.plugins checks
         schoolos.tenant_id, so scope the transaction to the new tenant first. */
      await client.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [t.id]);
      await ensurePluginCatalog(client, t.id);
      await auditLog(client, t.id, {
        actor: ownerName, actorRole: 'platform', action: 'Tenant onboarded (self-signup)',
        recordType: 'Tenant', recordRef: `${t.slug} · ${ownerEmail}`,
        reason: 'school-owner signup', policyRef: 'Platform §1.1 (tenant provisioning)', risk: 'medium',
        ip: req.ip ?? null,
        outcome: `school '${t.name}' created with its first owner — no student data yet` });
      await emitEvent(client, t.id,
        { type: 'platform', label: `New school onboarded: ${t.name} (${t.slug})` },
        'platform.tenant.onboarded.v1',
        { tenantId: t.id, slug: t.slug, ownerUserId: u.id, ownerEmail: u.email, sections });
      await client.query('COMMIT');
      /* S0 fix C1: stamp the session epoch like every other issue path —
         a future epoch default would otherwise lock fresh signups out. */
      const token = app.jwt.sign({ sub: u.id, role: u.role, tenant: u.tenant_id, name: u.name, jti: randomUUID(), ep: u.session_epoch ?? 1 }, {});
      /* C-3: issue the session cookies as /auth/login does. This handler has always returned the
         same { token, user } BODY, but not the HttpOnly `schoolos_session` + `schoolos_csrf`
         pair — so in a same-origin deployment, where the cookie is the durable credential and a
         cold open exchanges it for a bearer via POST /auth/renew, a freshly signed-up owner was
         bounced straight back to /login on the first refresh. The bearer alone is memory-only on
         the client by design (FEX-3), so without the cookie there was no durable session at all.
         Issued AFTER the COMMIT so a cookie is never minted for a transaction that rolled back. */
      app.issueSessionCookies(reply, token);
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
    /* No campuses: a school is ONE site. A second site is a second tenant, not a campus of this one. */
    const allowed = ['schoolName', ...Object.keys(PROFILE_CAPS)];
    const patches = {};
    if (b.schoolName !== undefined) {
      const n = String(b.schoolName).trim();
      if (n.length < 3 || n.length > 120) return reply.code(400).send({ error: 'School name must be 3–120 characters' });
      patches.name = n;
    }
    for (const k of Object.keys(PROFILE_CAPS)) {
      if (b[k] === undefined) continue;
      const r = profileValue(k, b[k]);
      if (r.error) return reply.code(400).send({ error: r.error });
      patches[`config.${k}`] = r.value ?? '';
    }
    if (!Object.keys(patches).length) return reply.code(400).send({ error: `Nothing to update — send ${allowed.join(', ')}` });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // RTE-19: lock the row for the JSONB read-modify-write. Without `FOR UPDATE` a concurrent profile
      // update loses one writer's `config` change.
      const cur = (await c.query(`SELECT name, config FROM app.tenants WHERE id=$1 FOR UPDATE`, [req.user.tenant_id])).rows[0];
      if (!cur) return reply.code(404).send({ error: 'School not found' });
      const nextConfig = { ...(cur.config ?? {}) };
      const sets = [];
      const vals = [];
      let i = 1;
      if (patches.name) { sets.push(`name=$${i++}`); vals.push(patches.name); }
      for (const key of Object.keys(PROFILE_CAPS)) {
        if (patches[`config.${key}`] !== undefined) { nextConfig[key] = patches[`config.${key}`]; }
      }
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
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND role='principal' AND active) AS principals,
           /* suspended IT admins do not count: a suspended sole IT admin must
              reopen the step, exactly like GET /school/setup reports it */
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND role='itadmin' AND active) AS itadmins,
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND active) AS accounts,
           (SELECT count(*)::int FROM app.plugins WHERE tenant_id=$1 AND status='enabled') AS plugins_enabled`, [req.user.tenant_id])).rows[0];
      const sections = t?.config?.setup?.sections ?? [];
      return {
        school: { name: t?.name, slug: t?.slug, onboardedAt: t?.onboarded_at, sections },
        counts,
        checklist: [
          { id: 'principal', label: 'Appoint your principal (owner only)', done: counts.principals > 0, href: '/setup' },
          { id: 'classes', label: 'Define your classes and sections', done: sections.length > 0, href: '/classes' },
          { id: 'itadmin', label: 'Create your IT admin (they can add the rest of the staff)', done: counts.itadmins > 0, href: '/setup' },
          { id: 'students', label: 'Admit your first students', done: counts.students > 0, href: '/people-admin' },
          /* S0 fix C10: four modules are born enabled (DEFAULT_ON) — counting
             them made this item born-done and useless. It completes only when
             the school switches on something beyond its birth set. */
          { id: 'plugins', label: 'Switch on the modules you need (library, fees, transport…)', done: counts.plugins_enabled > DEFAULT_ON.size, href: '/plugins' },
        ],
      };
    });
  });
}
