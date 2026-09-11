// Fastify application factory — routes, auth hook, error handling.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { pool, q, withUser } from './db.js';
import { hashPassword, verifyPassword, dummyVerify, ROLES } from './auth.js';
import { scryptSync, timingSafeEqual, randomBytes, randomUUID, randomInt, createHash } from 'node:crypto';
import { auditLog, emitEvent, requestAudit } from './audit.js';
import { registerRoutes } from './routes.js';
import { registerOnboarding } from './onboarding.js';
import { loadPlugins } from './plugins/loader.js';

// Wave C metrics (GET /metrics): in-memory process counters + a 60s flush into
// app.ops_counters (migration 050) so the monotonic totals survive a restart.
// Counters are advisory ops data — they ride the owner path and are never
// request-critical, so flush failures are swallowed.
const metrics = { requestsTotal: 0, errorsTotal: 0, startedAt: Date.now() };

export async function buildApp(opts = {}) {
  // RTR-001 Track F: trustProxy is opt-in via env. Hardcoding true made req.ip
  // XFF-derived, so rotating a spoofed X-Forwarded-For defeated every limiter.
  const app = Fastify({ logger: opts.logger ?? { level: config.logLevel }, trustProxy: process.env.TRUST_PROXY === 'true' });

  await app.register(cors, { origin: config.corsOrigins, credentials: false }); // auth is header-borne; no cookies yet
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.jwtTtl } });
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: '1 minute',
    // RTR-001 Track F: we deploy directly (no reverse proxy yet). Trusting
    // X-Forwarded-For let attackers rotate IPs past the limiter. When a real
    // proxy is added, set TRUST_PROXY=true in the environment.
    keyGenerator: (req) => process.env.TRUST_PROXY === 'true' ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip) : req.ip,
  });

  // --- auth decoration ---
  // --- L2-3.1: cookie session (HttpOnly) + CSRF double-submit ---------------
  // Bearer stays the API-client path (unchanged). Browser sessions additionally
  // get HttpOnly cookies: schoolos_session (the JWT, unreadable to JS) and
  // schoolos_csrf (JS-readable) which cookie-authed MUTATIONS must echo in
  // X-CSRF-Token. Secure is production-only so plain-HTTP localhost stays usable.
  const SESSION_COOKIE = 'schoolos_session';
  const CSRF_COOKIE = 'schoolos_csrf';
  const COOKIE_SECURE = config.env === 'production';
  const cookieAttrs = (maxAge) => `; Path=/; SameSite=Lax${COOKIE_SECURE ? '; Secure' : ''}; Max-Age=${maxAge}`;
  const readCookie = (req, name) => {
    const raw = req.headers.cookie;
    if (!raw) return null;
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
    }
    return null;
  };
  const issueSessionCookies = (reply, token) => {
    const payload = app.jwt.decode(token);
    const maxAge = payload?.exp ? Math.max(0, payload.exp - Math.floor(Date.now() / 1000)) : 12 * 3600;
    const csrf = randomBytes(24).toString('hex');
    reply.header('set-cookie', [
      `${SESSION_COOKIE}=${token}${cookieAttrs(maxAge)}; HttpOnly`,
      `${CSRF_COOKIE}=${csrf}${cookieAttrs(maxAge)}`,
    ]);
    return csrf;
  };
  const clearSessionCookies = (reply) => {
    reply.header('set-cookie', [
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE ? '; Secure' : ''}; Max-Age=0`,
      `${CSRF_COOKIE}=; Path=/; SameSite=Lax${COOKIE_SECURE ? '; Secure' : ''}; Max-Age=0`,
    ]);
  };

  // Security matrix A3: every token carries a jti; a logged-out jti is refused here
  // until natural expiry (038 auth.revoked_token). Verification failures never leak
  // which check failed.
  //
  // L2-4.1: X-API-Key machine identities — scoped, read-only, default-deny.
  // The raw key is shown once at creation; the row stores sha256(key). Allowed
  // doors live in API_DOOR_SCOPES (kernel read doors; L1's routes.js doors can
  // adopt requireScope() later — blocks.md note). Mutations are always refused.
  const API_DOOR_SCOPES = {
    'GET /me': null,              // identity door — no scope
    'GET /dataset': 'core.read',  // hydrated dataset
  };
  app.decorate('authenticate', async (req, reply) => {
    try {
      const apiKeyHeader = req.headers['x-api-key'];
      if (apiKeyHeader) {
        if (req.method !== 'GET') return reply.code(403).send({ error: 'API keys are read-only — mutations are refused.' });
        const keyHash = createHash('sha256').update(String(apiKeyHeader)).digest('hex');
        const k = await q(`SELECT id, tenant_id, name, scopes FROM app.api_keys WHERE key_hash=$1 AND revoked_at IS NULL`, [keyHash]);
        if (!k.rows[0]) return reply.code(401).send({ error: 'invalid or revoked API key' });
        const door = `${req.method} ${req.routeOptions?.url ?? req.url.split('?')[0]}`;
        if (!(door in API_DOOR_SCOPES)) return reply.code(403).send({ error: `API keys are limited to scoped read doors — '${door}' is not one.` });
        const needed = API_DOOR_SCOPES[door];
        if (needed && !(k.rows[0].scopes ?? []).includes(needed)) {
          return reply.code(403).send({ error: `API key lacks the '${needed}' scope for this door.` });
        }
        await q(`UPDATE app.api_keys SET last_used_at=now() WHERE id=$1`, [k.rows[0].id]);
        req.auth = { sub: k.rows[0].id, via: 'api-key', jti: `apikey:${k.rows[0].id}` };
        req.user = { id: k.rows[0].id, tenant_id: k.rows[0].tenant_id, role: 'api', name: `api:${k.rows[0].name}`, email: null, pg_role: 'schoolos_app' };
        req.apiScopes = k.rows[0].scopes ?? [];
        return; // synthetic principal resolved — JWT path skipped
      }
      const via = req.headers.authorization?.startsWith('Bearer ') ? 'bearer' : 'cookie';
      const token = via === 'bearer' ? req.headers.authorization.slice(7) : readCookie(req, SESSION_COOKIE);
      if (via === 'cookie') {
        // double-submit CSRF (cookie-authed mutations only; bearer API clients exempt)
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
          const csrfCookie = readCookie(req, CSRF_COOKIE);
          const csrfHeader = req.headers['x-csrf-token'];
          if (!csrfCookie || !csrfHeader || String(csrfHeader) !== csrfCookie) {
            return reply.code(403).send({ error: 'CSRF check failed — send the schoolos_csrf cookie value in the X-CSRF-Token header.' });
          }
        }
      }
      if (!token) return reply.code(401).send({ error: 'unauthorized' });
      const payload = await (via === 'bearer' ? req.jwtVerify() : app.jwt.verify(token));
      req.auth = { ...payload, via }; // token claims (incl. jti) — DB row below is authoritative for identity
      // A3 hard rule: every token MUST carry a jti, else it can never be revoked
      // (RT-7 P2-6). The pre-038 compat window is closed — re-login reissues tokens.
      if (!payload.jti) return reply.code(401).send({ error: 'session ended — sign in again' });
      const rev = await q(`SELECT 1 FROM auth.revoked_token WHERE jti=$1`, [payload.jti]);
      if (rev.rows[0]) return reply.code(401).send({ error: 'session ended — sign in again' });
      const u = await q(`SELECT id, tenant_id, name, role, pg_role, email, session_epoch, force_change, mfa_enrolled_at FROM app.users WHERE id=$1 AND active`, [payload.sub]);
      if (!u.rows[0]) return reply.code(401).send({ error: 'account disabled' });
      // L2-2.1: credential-change revocation. A token is stamped with the user's
      // session_epoch at issue time (`ep`; pre-055 tokens read as 1). When the
      // password changes the epoch is bumped, so every OTHER outstanding session
      // dies here without a registry of live jti.
      if (Number(u.rows[0].session_epoch ?? 1) !== Number(payload.ep ?? 1)) {
        return reply.code(401).send({ error: 'session ended — sign in again' });
      }
      // L2-2.1: a force_change account gets a RESTRICTED session at login
      // (claim `mustChange`) — it may only reach the password-change door (plus
      // /me and logout) until a new password is set. Every other door refuses.
      // L2-3.2: same shape for MFA challenges (claim `mfaPending`, 5-min TTL).
      if (payload.mustChange && u.rows[0].force_change) {
        const path = (req.routeOptions?.url ?? req.url ?? '').split('?')[0];
        if (!['/me/password', '/me', '/auth/logout'].includes(path)) {
          return reply.code(403).send({ error: 'Set a new password first — this session is limited to the password change.', mustChange: true });
        }
      }
      if (payload.mfaPending) {
        const path = (req.routeOptions?.url ?? req.url ?? '').split('?')[0];
        if (path !== '/me/mfa/verify') {
          return reply.code(403).send({ error: 'Second factor required — finish the MFA challenge.', mfaRequired: true });
        }
      }
      req.user = u.rows[0];
    } catch (e) {
      // S0 fix A7: a database outage must not read as "unauthorized" — 503 tells
      // ops the truth and keeps retry-logic honest. Everything else stays 401.
      const code = e?.code;
      if (code === 'ECONNREFUSED' || code === '08006' || code === '08003' || code === '57P03') {
        return reply.code(503).send({ error: 'service temporarily unavailable' });
      }
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // --- health (no auth) ---
  app.get('/health', async () => {
    const r = await q('SELECT 1 AS ok').catch(() => null);
    return { status: r ? 'ok' : 'degraded', db: !!r, time: new Date().toISOString() };
  });
  // Readiness for orchestrators (ops audit P0-4): 503 unless the DB actually answers.
  // /health stays 200-degraded for humans; THIS is what HEALTHCHECK/LBs must poll.
  app.get('/ready', async (_req, reply) => {
    const r = await q('SELECT 1 AS ok').catch(() => null);
    if (!r) return reply.code(503).send({ ready: false, reason: 'database unreachable' });
    return { ready: true };
  });

  // --- login (no auth) ---
  app.post('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, password, tenantId } = req.body ?? {};
    if (!email || !password) return reply.code(400).send({ error: 'email and password required' });
    // D-37(b): tenantId scopes the lookup (picker parity with the OTP doors) —
    // the app sends it straight from the 409 picker; unscoped multi-school
    // emails still 409 with the full picker.
    const scope = typeof tenantId === 'string' && UUID_RE.test(tenantId) ? tenantId : null;
    const u = await q(`SELECT u.id, u.tenant_id, u.name, u.role, u.email, u.password_hash, u.session_epoch, u.force_change, (m.enabled = true) AS mfa_enabled, t.name AS tenant_name FROM app.users u LEFT JOIN auth.mfa_secrets m ON m.user_id = u.id JOIN app.tenants t ON t.id = u.tenant_id WHERE lower(u.email)=lower($1) AND u.active ${scope ? 'AND u.tenant_id=$2' : ''} ORDER BY u.created_at`, scope ? [email, scope] : [email]);
    // Self-serve onboarding (053) allows the same email in several schools.
    // One match signs in; several MUST NOT pick arbitrarily — the person
    // chooses their school (409 with guidance), never a wrong-tenant login.
    if (u.rows.length > 1) {
      // L2-4.2: full picker contract — ids + names (multiTenantReply parity)
      return reply.code(409).header('x-tenant-hint', u.rows.map((r) => r.tenant_id).join(',')).send({
        error: 'This email is used in more than one school on this platform. Sign in from your school\'s own sign-in page, or ask the school office which school your account belongs to.',
        multiTenant: true, schools: u.rows.map((r) => ({ tenantId: r.tenant_id, name: r.tenant_name ?? null })),
      });
    }
    const user = u.rows[0];
    if (!user) {
      // Timing-equalization: burn the same scrypt cost as a real verify so
      // response time doesn't reveal whether the email exists (RT-7cyc8 P2-16).
      dummyVerify(password);
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    if (!verifyPassword(password, user.password_hash)) return reply.code(401).send({ error: 'invalid credentials' });
    // D-37(a): MFA challenge is a plain JSON 401 — no 307/Location. A staff
    // account with an enabled TOTP factor does NOT get a session yet; the body
    // carries a 5-minute challenge token (claim mfaPending) that the
    // authenticate hook limits to /me/mfa/verify.
    if (user.mfa_enabled) {
      const challengeToken = app.jwt.sign({ sub: user.id, role: user.role, tenant: user.tenant_id, name: user.name, jti: randomUUID(), mfaPending: true }, { expiresIn: '5m' });
      await withUser(user.tenant_id, user.role, (c) =>
        auditLog(c, user.tenant_id, { actor: user.name, actorRole: user.role, action: 'Signed in (MFA challenge)', recordType: 'Auth', recordRef: user.email, policyRef: 'Platform §2.4 (identity & access)', outcome: 'password verified · second factor required before session issue' }));
      return reply.code(401).send({ error: 'Second factor required — verify your authenticator code to finish signing in.', mfaRequired: true, challengeToken, user: { id: user.id, name: user.name, email: user.email } });
    }
    // D-37(c): ONE shared issue path — force_change is stamped on every
    // session issue (password · OTP · SSO · MFA-verify · renew), so a
    // provisioned-with-temp-password account is restricted no matter how it
    // signed in. Password login surfaces the restriction as 403 + reason.
    const s = await issueSession(user, 'password', reply);
    if (s.mustChange) {
      return reply.code(403).send({
        error: 'Your account uses a temporary password — set a new one before continuing.',
        mustChange: true, token: s.token, user: s.user,
      });
    }
    return { token: s.token, user: s.user };
  });

  // D-37(e): POST /auth/renew — cookie-authed (or bearer) re-issue. The app
  // calls this on 401-pending activity to keep a live session fresh without a
  // re-login; absent/invalid session → 401 (L5 flips RENEW_DOOR_LIVE only now
  // that the door exists). Rides the full authenticate hook, so denylist,
  // epoch, CSRF-on-cookie and mustChange/mfaPending limits all apply.
  app.post('/auth/renew', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const hasCreds = req.headers.authorization?.startsWith('Bearer ') || readCookie(req, SESSION_COOKIE);
    if (!hasCreds) return reply.code(401).send({ error: 'no session to renew — sign in' });
    await app.authenticate(req, reply); // 401s on absent/expired/revoked/stale-epoch
    if (reply.sent) return reply; // the hook already answered (401/403)
    if (req.auth?.via === 'api-key') return reply.code(403).send({ error: 'API keys do not renew sessions.' });
    const u = await q(`SELECT id, tenant_id, name, role, email, session_epoch, force_change FROM app.users WHERE id=$1 AND active`, [req.user.id]);
    if (!u.rows[0]) return reply.code(401).send({ error: 'account disabled' });
    const s = await issueSession(u.rows[0], 'renew', reply);
    // S0 fix A6: retire the token being renewed — without this the old jti
    // stayed valid until natural expiry alongside its replacement.
    if (req.auth?.jti) {
      const oldExp = req.auth.exp ? new Date(req.auth.exp * 1000) : new Date(Date.now() + 13 * 3600 * 1000);
      await q(`INSERT INTO auth.revoked_token (jti, tenant_id, exp) VALUES ($1,$2,$3)
               ON CONFLICT (jti) DO NOTHING`, [req.auth.jti, req.user.tenant_id, oldExp]);
    }
    return { token: s.token, mustChange: s.mustChange, user: s.user };
  });

  // ---- full authentication (008): phone OTP · Google SSO · logout ----
  // D-37(c): the single shared session-issue helper. Stamps `mustChange` from
  // the user row (never from the caller's word), sets cookies, audits, and
  // returns the shape every auth door answers with.
  const issueSession = async (user, via, reply) => {
    const mustChange = !!user.force_change;
    const token = app.jwt.sign({ sub: user.id, role: user.role, tenant: user.tenant_id, name: user.name, jti: randomUUID(), ep: user.session_epoch ?? 1, ...(mustChange ? { mustChange: true } : {}) },
      user.role === 'student' ? { expiresIn: config.studentSessionTtl } : {});
    await withUser(user.tenant_id, user.role, (c) =>
      auditLog(c, user.tenant_id, { actor: user.name, actorRole: user.role, action: `Signed in (${via})`, recordType: 'Auth', recordRef: via === 'phone' ? user.phone : user.email, policyRef: 'Platform §2.4 (identity & access)', outcome: `JWT issued${mustChange ? ' (restricted — password change required)' : ''}${user.role === 'student' ? ` (short-lived shared-computer session, ${config.studentSessionTtl})` : ''}` }));
    issueSessionCookies(reply, token);
    return { mustChange, token, user: { id: user.id, name: user.name, role: user.role, email: user.email, tenantId: user.tenant_id } };
  };

  // --- phone + OTP ---
  // T103 (§7 P0-3): identity resolution is TENANT-BOUND end to end. A phone that
  // exists in several tenants must never let the kernel silently pick rows[0] —
  // a self-signup attacker could plant the victim's phone in their own school and
  // receive/verify the victim's code. Multi-row matches 409 exactly like password
  // login; X-Tenant-Hint carries the opaque tenant ids (no names, no PII) so a
  // future chooser can re-submit with an explicit tenantId.
  // L2-4.2: the multi-school picker contract REPLACES the Wave-1 opaque-id-only
  // hint — the 409 carries ids + names so the person can actually choose. Names
  // are platform-level facts (a planted phone reveals school names, not personal
  // data); the alternative (blind uuid picking) made the 409 unusable.
  const multiTenantReply = (reply, rows) => reply.code(409)
    .header('x-tenant-hint', rows.map((r) => r.tenant_id).join(','))
    .send({
      error: 'This identity is used in more than one school on this platform. Sign in from your school\'s own sign-in page (password), or ask the school office which school your account belongs to.',
      multiTenant: true, schools: rows.map((r) => ({ tenantId: r.tenant_id, name: r.tenant_name ?? null })),
    });
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.post('/auth/otp/request', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { phone, tenantId } = req.body ?? {};
    if (!phone || !/^\+?[0-9]{10,14}$/.test(phone)) return reply.code(400).send({ error: 'valid phone required (+countrycode)' });
    const scope = typeof tenantId === 'string' && UUID_RE.test(tenantId) ? tenantId : null;
    const u = await q(
      `SELECT users.id, users.tenant_id, users.name, users.role, users.phone, users.session_epoch, t.name AS tenant_name FROM app.users JOIN app.tenants t ON t.id = users.tenant_id WHERE users.phone=$1 AND users.active ${scope ? 'AND tenant_id=$2' : ''} ORDER BY users.created_at`,
      scope ? [phone, scope] : [phone]);
    // Uniform response shape — phone enumeration must not distinguish
    // registered from unregistered numbers (a multi-tenant 409 mirrors the
    // password-login contract; see T103 comment above).
    if (!scope && u.rows.length > 1) return multiTenantReply(reply, u.rows);
    const user = u.rows[0] ?? null;
    const body = { sent: true, expiresInSeconds: Math.round(config.otp.ttlMs / 1000), devEcho: config.otp.devEcho };
    if (user) {
      const code = String(randomInt(100000, 1000000)); // CSPRNG — Math.random is not a secret source (ops.visitors precedent)
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(code, salt, 64).toString('hex');
      // kernel path: the OTP vault denies the app role entirely (RLS policy) —
      // only the owner connection may write verification secrets. The row is
      // bound to the issuing tenant (auth_otps.tenant_id) — T103.
      await q(`INSERT INTO app.auth_otps (tenant_id, phone, code_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4))`,
        [user.tenant_id, phone, `${salt}:${hash}`, config.otp.ttlMs / 1000]);
      req.log.warn({ phone: phone.slice(-4), tenant: user.tenant_id, msg: 'OTP issued' });
      if (config.otp.devEcho) body.devCode = code; // dev-only echo, opt-in via OTP_DEV_ECHO
    }
    return body;
  });

  app.post('/auth/otp/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { phone, code, tenantId } = req.body ?? {};
    if (!phone || !code) return reply.code(400).send({ error: 'phone and code required' });
    const scope = typeof tenantId === 'string' && UUID_RE.test(tenantId) ? tenantId : null;
    const u = await q(
      `SELECT users.id, users.tenant_id, users.name, users.role, users.phone, users.session_epoch, t.name AS tenant_name FROM app.users JOIN app.tenants t ON t.id = users.tenant_id WHERE users.phone=$1 AND users.active ${scope ? 'AND tenant_id=$2' : ''} ORDER BY users.created_at`,
      scope ? [phone, scope] : [phone]);
    // Uniform failure copy for EVERY path — registered/unregistered/expired/missing
    // code all look identical from outside (phone-enumeration defense, RT-7cyc8).
    const DENIED = { error: 'that code didn’t work — request a new one and try again' };
    const deny = () => reply.code(401).send(DENIED);
    if (!scope && u.rows.length > 1) return multiTenantReply(reply, u.rows);
    const user = u.rows[0];
    // T103 (P0-3): the vault row must match phone AND the issuing tenant. An OTP
    // issued in tenant A can never verify the account of the same phone in
    // tenant B — the cross-tenant session-issuance path is closed.
    const otp = user ? await q(
      `SELECT id, code_hash, attempts, expires_at, consumed_at FROM app.auth_otps
       WHERE phone=$1 AND tenant_id=$2 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`, [phone, user.tenant_id]) : { rows: [] };
    const row = otp.rows[0];
    if (!row) return deny();
    if (new Date(row.expires_at) < new Date()) return deny(); // expiry uses config.otp.ttlMs
    if (row.attempts >= config.otp.maxAttempts) return deny();
    const [salt, hash] = row.code_hash.split(':');
    const ok = (() => { try { return timingSafeEqual(scryptSync(String(code), salt, 64), Buffer.from(hash, 'hex')); } catch { return false; } })();
    if (!ok) {
      await q(`UPDATE app.auth_otps SET attempts = attempts + 1 WHERE id=$1`, [row.id]);
      return deny(); // same copy as every other failure — no oracle at all
    }
    await q(`UPDATE app.auth_otps SET consumed_at = now() WHERE id=$1`, [row.id]);
    return issueSession(user, 'phone', reply);
  });

  // --- Google SSO (OAuth 2.0 authorization code flow) ---
  const googleConfigured = () => !!(config.google.clientId && config.google.clientSecret && config.google.redirectUri);
  app.get('/auth/google/start', async (req, reply) => {
    if (!googleConfigured()) return reply.code(503).send({ error: 'Google SSO not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)' });
    const state = randomBytes(16).toString('hex');
    // P1-8: state is stored server-side (short TTL) and verified in the callback —
    // generated-but-unvalidated state = login CSRF. S0 fix A5: the runtime-DDL
    // fallback is gone — app.oauth_states exists in migrations; a request path
    // must never CREATE TABLE.
    await q(`INSERT INTO app.oauth_states (state, created_at) VALUES ($1, now()) ON CONFLICT (state) DO NOTHING`, [state]);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', config.google.clientId);
    url.searchParams.set('redirect_uri', config.google.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    return reply.redirect(url.toString());
  });

  app.get('/auth/google/callback', async (req, reply) => {
    if (!googleConfigured()) return reply.code(503).send({ error: 'Google SSO not configured' });
    const { code, state } = req.query ?? {};
    if (!code || !state) return reply.code(400).send({ error: 'missing code or state' });
    const st = await q(`DELETE FROM app.oauth_states WHERE state=$1 AND created_at > now() - interval '10 minutes' RETURNING state`, [String(state)]);
    if (!st.rows[0]) return reply.code(401).send({ error: 'expired login attempt — start again' });
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: config.google.redirectUri, grant_type: 'authorization_code' }),
      });
      if (!tokenRes.ok) return reply.code(401).send({ error: 'google token exchange failed' });
      const { access_token } = await tokenRes.json();
      const profRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${access_token}` } });
      if (!profRes.ok) return reply.code(401).send({ error: 'google profile fetch failed' });
      const profile = await profRes.json();
      const email = (profile.email ?? '').toLowerCase();
      if (!email || profile.email_verified === false) return reply.code(401).send({ error: 'google email not verified' });
      // T103 (P0-3): never rows[0] on a multi-tenant email — same 409 contract as
      // password login; X-Tenant-Hint lists the opaque tenant ids.
      const u = await q(`SELECT users.id, users.tenant_id, users.name, users.role, users.email, users.session_epoch, t.name AS tenant_name FROM app.users JOIN app.tenants t ON t.id = users.tenant_id WHERE lower(users.email)=lower($1) AND users.active ORDER BY users.created_at`, [email]);
      if (u.rows.length > 1) return multiTenantReply(reply, u.rows);
      if (!u.rows[0]) return reply.code(403).send({ error: `no SchoolOS account for ${email} — contact your school admin` });
      await q(`UPDATE app.users SET auth_provider='google' WHERE id=$1`, [u.rows[0].id]);
      return issueSession(u.rows[0], 'google-sso', reply);
    } catch (e) { req.log.error(e); return reply.code(502).send({ error: 'google sso unreachable' }); }
  });

  // Dev SSO simulator — armed ONLY by config.devSsoEnabled (T101/P0-2: NODE_ENV
  // must be exactly 'development' AND AUTH_DEV_SSO explicitly set; config logs a
  // loud warning at boot when it arms). Production has no path to this door, and
  // a real Google OAuth config always takes precedence.
  app.post('/auth/google/demo', async (req, reply) => {
    if (!config.devSsoEnabled || googleConfigured()) return reply.code(403).send({ error: 'dev SSO simulator disabled' });
    const { email } = req.body ?? {};
    if (!email) return reply.code(400).send({ error: 'email required' });
    // T103 (P0-3): multi-tenant email → 409 with X-Tenant-Hint, never rows[0].
    const u = await q(`SELECT users.id, users.tenant_id, users.name, users.role, users.email, users.session_epoch, t.name AS tenant_name FROM app.users JOIN app.tenants t ON t.id = users.tenant_id WHERE lower(users.email)=lower($1) AND users.active ORDER BY users.created_at`, [email]);
    if (u.rows.length > 1) return multiTenantReply(reply, u.rows);
    if (!u.rows[0]) return reply.code(403).send({ error: `no SchoolOS account for ${email}` });
    return issueSession(u.rows[0], 'google-sso (dev simulator)', reply);
  });

  // --- logout (audited) ---
  // Shared-computer guarantee (StudentOS §78/§79): ending a session wipes the
  // browser's cached content and storage — the next student on this machine can
  // never reopen the previous student's data. Personal-data planes are no-store.
  app.addHook('onSend', async (req, reply) => {
    const path = (req.raw?.url || '').split('?')[0];
    if (/^\/(auth|me|parent|student)(\/|$)/.test(path)) reply.header('cache-control', 'no-store');
    // Wave C: security headers on every response (verified: Fastify onSend hooks
    // apply to all routes regardless of registration order). HSTS only when TLS
    // is actually enforced at the proxy (FORCES_HTTPS=true) — TLS terminates
    // there, and STS on a plain-HTTP deployment would brick local development.
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.FORCES_HTTPS === 'true') reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    metrics.requestsTotal += 1; // one response = one served request (wave-c)
  });
  app.post('/auth/logout', { preHandler: app.authenticate }, async (req, reply) => {
    reply.header('Clear-Site-Data', '"cache", "storage"');
    clearSessionCookies(reply); // L2-3.1: the browser's cookies die with the session
    // A3: actually end the session — the jti is dead the moment this returns.
    if (req.auth?.jti) {
      const exp = req.auth.exp ? new Date(req.auth.exp * 1000) : new Date(Date.now() + 13 * 3600 * 1000);
      await q(`INSERT INTO auth.revoked_token (jti, tenant_id, exp) VALUES ($1,$2,$3)
               ON CONFLICT (jti) DO NOTHING`, [req.auth.jti, req.user.tenant_id, exp]);
      await q(`DELETE FROM auth.revoked_token WHERE exp < now()`); // opportunistic cleanup
    }
    await withUser(req.user.tenant_id, req.user.role, (c) =>
      auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Signed out', recordType: 'Auth', recordRef: req.user.email, policyRef: 'Platform §2.4 (identity & access) · StudentOS §78 shared computers', outcome: 'session revoked (jti denylist) · browser storage wipe requested (Clear-Site-Data)' }));
    return { ok: true };
  });

  // --- L2-4.2: multi-school resolution ----------------------------------------
  // The person's identity is their EMAIL across tenants; roles are per-tenant.
  // /me/tenants lists memberships (authenticated — safe to show names);
  // /me/switch re-issues the session against the chosen tenant's row.
  app.get('/me/tenants', { preHandler: app.authenticate }, async (req) => {
    if (!req.user.email) return { tenants: [] }; // API-key principals have no memberships
    const rows = await q(
      `SELECT u.tenant_id, u.role, t.name AS tenant_name
       FROM app.users u JOIN app.tenants t ON t.id = u.tenant_id
       WHERE lower(u.email)=lower($1) AND u.active ORDER BY t.name`, [req.user.email]);
    return { tenants: rows.rows.map((r) => ({ tenantId: r.tenant_id, name: r.tenant_name, role: r.role })) };
  });

  app.post('/me/switch', { preHandler: app.authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { tenantId } = req.body ?? {};
    if (!tenantId || !UUID_RE.test(String(tenantId))) return reply.code(400).send({ error: 'valid tenantId required' });
    if (!req.user.email) return reply.code(403).send({ error: 'API keys cannot switch schools.' });
    /* S0 fix A4: switching schools re-issues a session for ANOTHER account — a
       stolen browser session must not escalate into the person's other-school
       role (teacher in A → owner in B). When the caller's account HAS a
       password, the switch requires it (knowledge factor, like /me/mfa/disable).
       Passwordless accounts (OTP-only desks) switch on their phone factor. */
    const caller = await q(`SELECT password_hash FROM app.users WHERE id=$1 AND active`, [req.user.id]);
    if (caller.rows[0]?.password_hash) {
      const { currentPassword } = req.body ?? {};
      if (!currentPassword || !verifyPassword(String(currentPassword), caller.rows[0].password_hash)) {
        return reply.code(403).send({ error: 'Enter your current password to switch schools.', passwordRequired: true });
      }
    }
    const target = await q(
      `SELECT u.id, u.tenant_id, u.name, u.role, u.email, u.session_epoch, u.force_change, t.name AS tenant_name
       FROM app.users u JOIN app.tenants t ON t.id = u.tenant_id
       WHERE lower(u.email)=lower($1) AND u.tenant_id=$2 AND u.active`, [req.user.email, tenantId]);
    if (!target.rows[0]) return reply.code(403).send({ error: 'No active account for you in that school.' });
    const user = target.rows[0];
    const mustChange = !!user.force_change;
    const token = app.jwt.sign({ sub: user.id, role: user.role, tenant: user.tenant_id, name: user.name, jti: randomUUID(), ep: user.session_epoch ?? 1, ...(mustChange ? { mustChange: true } : {}) },
      user.role === 'student' ? { expiresIn: config.studentSessionTtl } : {});
    await withUser(user.tenant_id, user.role, (c) =>
      auditLog(c, user.tenant_id, { actor: user.name, actorRole: user.role, action: 'Switched school', recordType: 'Auth', recordRef: user.email, policyRef: 'Platform §2.4 (identity & access)', outcome: `session re-issued against ${user.tenant_name}${mustChange ? ' (force_change pending — restricted)' : ''}` }));
    issueSessionCookies(reply, token);
    return { ok: true, token, mustChange, tenant: { tenantId: user.tenant_id, name: user.tenant_name }, user: { id: user.id, name: user.name, role: user.role, email: user.email, tenantId: user.tenant_id } };
  });

  // --- L2-2.1: password change (self-service; force_change exit) ---------------
  app.post('/me/password', { preHandler: app.authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) return reply.code(400).send({ error: 'current and new password are required' });
    if (typeof newPassword !== 'string' || newPassword.length < 8) return reply.code(400).send({ error: 'New password must be at least 8 characters' });
    if (newPassword === currentPassword) return reply.code(400).send({ error: 'The new password must be different from the current one' });
    const u = await q(`SELECT id, tenant_id, name, role, email, password_hash, session_epoch FROM app.users WHERE id=$1 AND active`, [req.user.id]);
    if (!u.rows[0]) return reply.code(401).send({ error: 'account disabled' });
    if (!verifyPassword(currentPassword, u.rows[0].password_hash)) return reply.code(401).send({ error: 'The current password is not right' });
    // epoch bump revokes every OTHER session; this caller is re-issued below.
    const epoch = Number(u.rows[0].session_epoch ?? 1) + 1;
    await q(`UPDATE app.users SET password_hash=$1, session_epoch=$2, force_change=false WHERE id=$3`,
      [hashPassword(newPassword), epoch, u.rows[0].id]);
    await withUser(u.rows[0].tenant_id, u.rows[0].role, (c) =>
      auditLog(c, u.rows[0].tenant_id, { actor: u.rows[0].name, actorRole: u.rows[0].role, action: 'Password changed', recordType: 'Auth', recordRef: u.rows[0].email, policyRef: 'Platform §2.4 (identity & access)', outcome: `password set by the account owner · session_epoch → ${epoch} (older sessions revoked)` }));
    const token = app.jwt.sign({ sub: u.rows[0].id, role: u.rows[0].role, tenant: u.rows[0].tenant_id, name: u.rows[0].name, jti: randomUUID(), ep: epoch },
      u.rows[0].role === 'student' ? { expiresIn: config.studentSessionTtl } : {});
    issueSessionCookies(reply, token);
    return { ok: true, token, mustChange: false, user: { id: u.rows[0].id, name: u.rows[0].name, role: u.rows[0].role, email: u.rows[0].email, tenantId: u.rows[0].tenant_id } };
  });

  // --- L2-2.2: self-service password reset (email rail, sandbox-verified) -----
  {
    const { bindKernel: bindEmailKernel, sendEmail } = await import('./plugins/rails.email/index.js');
    bindEmailKernel(q);
    const sha256 = (s) => createHash('sha256').update(s).digest('hex');
    const TTL_MS = config.auth?.resetTtlMs ?? 30 * 60 * 1000;

    app.post('/me/reset-request', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { email, tenantId } = req.body ?? {};
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return reply.code(400).send({ error: 'valid email required' });
      const scope = typeof tenantId === 'string' && UUID_RE.test(tenantId) ? tenantId : null;
      // T103 contract parity: identity resolution is tenant-bound; several rows
      // must never let the kernel pick silently. Anti-enumeration posture: an
      // unknown email answers the SAME 200 "sent" copy as a known one.
      const u = await q(
        `SELECT id, tenant_id, email FROM app.users WHERE lower(email)=lower($1) AND active ${scope ? 'AND tenant_id=$2' : ''} ORDER BY users.created_at`,
        scope ? [email, scope] : [email]);
      if (u.rows.length === 0) return { sent: true };
      if (u.rows.length > 1) return multiTenantReply(reply, u.rows);
      const user = u.rows[0];
      // Channel gate (comms honesty rule): no email rail configured for the
      // school → 503, never a fake "sent". (Existence tradeoff: the alternative
      // — uniform 200 — would silently strand the user; the login door already
      // answers 409 multiTenant for this identity, so this does not widen the
      // enumeration surface materially.)
      const channel = await q(`SELECT 1 FROM app.plugins WHERE tenant_id=$1 AND plugin_id='rails.email' LIMIT 1`, [user.tenant_id]);
      if (!channel.rows[0]) {
        return reply.code(503).send({ error: 'No email channel is configured for this school yet — ask the school office to reset your password in person.' });
      }
      // one open token per account: a fresh request invalidates the previous one
      await q(`DELETE FROM auth.reset_tokens WHERE user_id=$1 AND consumed_at IS NULL`, [user.id]);
      const raw = randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + TTL_MS);
      const rt = await q(
        `INSERT INTO auth.reset_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4) RETURNING id`,
        [user.tenant_id, user.id, sha256(raw), expires]);
      const dedupKey = `pwreset:${rt.rows[0].id}:${sha256(raw).slice(0, 8)}`;
      const body = [
        'A password reset was requested for your SchoolOS account.',
        `Your one-time reset code is: ${raw}`,
        `It expires in ${Math.round(TTL_MS / 60000)} minutes and can be used once.`,
        'If you did not request this, ignore this email and your password stays as it is.',
      ].join('\n');
      const r = await sendEmail({ to: user.email, subject: 'Reset your SchoolOS password', body, dedupKey, tenantId: user.tenant_id });
      // S0 fix A3: the comms ledger is app-role-readable tenant data — a live
      // single-use reset token must not persist queryable in it. REAL sends store
      // a redacted body (delivery proof, not the secret); SANDBOX sends keep the
      // full body because the ledger row IS the dev delivery artifact (logger
      // provider, no real mailbox) — acceptable on developer machines only.
      const ledgerBody = r.sandbox ? body : body.replace(raw, `${raw.slice(0, 6)}…(redacted — delivered by email)`);
      await q(
        `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key, sent_at, delivered_at)
         VALUES ($1,'email',$2::jsonb,'email','PASSWORD_RESET',$3,$4,$5,now(),now())`,
        [user.tenant_id, JSON.stringify([user.email]), ledgerBody,
          r.ok ? 'sent' : 'failed',
          r.ok ? dedupKey : `${dedupKey}:failed`]);
      if (!r.ok) {
        return reply.code(503).send({ error: `Email channel is configured but the send failed (${r.error ?? 'provider error'}) — try again or ask the school office.` });
      }
      await withUser(user.tenant_id, 'system', (c) =>
        auditLog(c, user.tenant_id, { actor: 'system:password-reset', actorRole: 'system', action: 'Password reset requested', recordType: 'Auth', recordRef: user.email, policyRef: 'Platform §2.4 (identity & access)', outcome: `single-use reset token issued (sha256-stored, expires ${expires.toISOString()}) · email via ${r.provider}${r.sandbox ? ' (sandbox)' : ''}` }));
      return { sent: true };
    });

    app.post('/me/reset-confirm', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { token, newPassword } = req.body ?? {};
      const INVALID = 'That reset code is not valid or has expired — request a new one.';
      if (!token || typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token)) return reply.code(400).send({ error: INVALID });
      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) return reply.code(400).send({ error: 'New password must be at least 8 characters' });
      const rt = await q(
        `SELECT rt.id, rt.expires_at, rt.user_id, rt.tenant_id, u.email, u.name, u.role, u.active
         FROM auth.reset_tokens rt JOIN app.users u ON u.id = rt.user_id
         WHERE rt.token_hash=$1`, [sha256(token)]);
      const row = rt.rows[0];
      // unknown / disabled / expired / already-consumed all answer the same copy
      // (consumed is caught race-safely by the UPDATE below).
      if (!row || !row.active || new Date(row.expires_at).getTime() < Date.now()) {
        return reply.code(400).send({ error: INVALID });
      }
      // race-safe consume: exactly one caller flips the token
      const consumed = await q(`UPDATE auth.reset_tokens SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL RETURNING id`, [row.id]);
      if (!consumed.rows[0]) return reply.code(400).send({ error: INVALID });
      const epoch = await q(
        `UPDATE app.users SET password_hash=$1, session_epoch = session_epoch + 1, force_change=false WHERE id=$2 RETURNING session_epoch`,
        [hashPassword(newPassword), row.user_id]);
      await withUser(row.tenant_id, 'system', (c) =>
        auditLog(c, row.tenant_id, { actor: 'system:password-reset', actorRole: 'system', action: 'Password reset completed', recordType: 'Auth', recordRef: row.email, policyRef: 'Platform §2.4 (identity & access)', outcome: `password set via single-use reset link · session_epoch → ${epoch.rows[0].session_epoch} (older sessions revoked)` }));
      return { ok: true };
    });
  }

  // --- L2-3.2: staff MFA (TOTP, RFC 6238) ------------------------------------
  // Secrets/recovery codes live in kernel-only tables (057); the roster-visible
  // fact is users.mfa_enrolled_at. Parents/students cannot enroll (shared-computer
  // + short-session posture: their factor is the OTP channel, not TOTP).
  {
    const { generateSecret, verifyTotp, otpauthUri } = await import('./totp.js');
    const sha256 = (s) => createHash('sha256').update(s).digest('hex');
    const MFA_COPY = 'Enter the 6-digit code from your authenticator app (or a recovery code).';

    app.post('/me/mfa/enroll', { preHandler: app.authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (['parent', 'student'].includes(req.user.role)) return reply.code(403).send({ error: 'MFA enrollment is available to staff accounts only.' });
      // D-37(d): re-enrollment while the factor is live would silently rotate
      // secrets — turning two-step OFF has its own re-authenticated door.
      const existing = await q(`SELECT enabled FROM auth.mfa_secrets WHERE user_id=$1`, [req.user.id]);
      if (existing.rows[0]?.enabled || req.user.mfa_enrolled_at) {
        return reply.code(409).send({ error: 'Two-step verification is already on for this account. Turn it off (with your password) before enrolling again.' });
      }
      const secret = generateSecret();
      await q(
        `INSERT INTO auth.mfa_secrets (user_id, tenant_id, secret, enabled) VALUES ($1,$2,$3,false)
         ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, enabled = false`, [req.user.id, req.user.tenant_id, secret]);
      return { secret, otpauth: otpauthUri({ secret, account: req.user.email }) };
    });

    // D-37(d): turning two-step OFF requires password re-auth (a stolen
    // session — or a challenge token — must never be able to disarm MFA).
    app.post('/me/mfa/disable', { preHandler: app.authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (!req.user.email) return reply.code(403).send({ error: 'API keys have no MFA to disable.' });
      const { password } = req.body ?? {};
      if (!password) return reply.code(400).send({ error: 'your password is required to turn off two-step verification' });
      const u = await q(`SELECT password_hash FROM app.users WHERE id=$1 AND active`, [req.user.id]);
      if (!u.rows[0] || !verifyPassword(password, u.rows[0].password_hash)) return reply.code(401).send({ error: 'that password didn’t match — two-step stays on' });
      await q(`DELETE FROM auth.mfa_secrets WHERE user_id=$1`, [req.user.id]);
      await q(`DELETE FROM auth.mfa_recovery_codes WHERE user_id=$1`, [req.user.id]);
      await q(`UPDATE app.users SET mfa_enrolled_at=NULL WHERE id=$1`, [req.user.id]);
      await withUser(req.user.tenant_id, req.user.role, (c) =>
        auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'MFA disabled', recordType: 'Auth', recordRef: req.user.email, policyRef: 'Platform §2.4 (identity & access)', outcome: 'two-step verification turned off after password re-authentication — factor, recovery codes and enrollment state removed' }));
      return { ok: true };
    });

    // Dual-path door: (a) an AUTHED user confirming enrollment (bearer/cookie —
    // optionalAuth runs the full authenticate incl. CSRF for cookies); (b) a
    // login CHALLENGE (no credentials on the request — the mfaPending token in
    // the body is the only authority). Without credentials the preHandler no-ops.
    app.post('/me/mfa/verify', { preHandler: async (req, reply) => {
      if (req.headers.authorization?.startsWith('Bearer ') || readCookie(req, SESSION_COOKIE)) {
        await app.authenticate(req, reply); // terminates the request on failure
      }
    }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { code, challengeToken } = req.body ?? {};
      if (!code) return reply.code(400).send({ error: MFA_COPY });
      // Two entry paths: (a) an authed user CONFIRMING enrollment (bearer/cookie
      // session, no challenge token); (b) a login CHALLENGE (mfaPending token,
      // pre-auth). Path (b) issues the real session on success.
      let challenger = null;
      if (challengeToken) {
        let payload;
        try { payload = app.jwt.verify(String(challengeToken)); } catch { return reply.code(401).send({ error: 'The sign-in attempt expired — sign in again.', mfaRequired: true }); }
        if (!payload.mfaPending) return reply.code(400).send({ error: 'Not an MFA challenge token — sign in again.' });
        challenger = payload;
      }
      const userId = challenger?.sub ?? req.user?.id;
      const tenantId = challenger?.tenant ?? req.user?.tenant_id;
      if (!userId) return reply.code(401).send({ error: 'unauthorized' });
      const m = await q(`SELECT secret, enabled FROM auth.mfa_secrets WHERE user_id=$1`, [userId]);
      if (!m.rows[0]?.secret) return reply.code(400).send({ error: 'No MFA enrollment in progress — enroll first.' });

      // TOTP first; recovery code second (single-use, sha256-stored).
      let usedRecovery = false;
      if (!verifyTotp(m.rows[0].secret, code)) {
        const rc = await q(
          `SELECT rc.id FROM auth.mfa_recovery_codes rc WHERE rc.user_id=$1 AND rc.consumed_at IS NULL AND rc.code_hash=$2`,
          [userId, sha256(String(code).trim())]);
        if (!rc.rows[0]) return reply.code(401).send({ error: MFA_COPY });
        await q(`UPDATE auth.mfa_recovery_codes SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL`, [rc.rows[0].id]);
        usedRecovery = true;
      }

      if (!m.rows[0].enabled) {
        // confirmation of an in-progress enrollment: enable + mint recovery codes
        const codes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex').padStart(10, '0'));
        for (const c of codes) {
          await q(`INSERT INTO auth.mfa_recovery_codes (user_id, tenant_id, code_hash) VALUES ($1,$2,$3)`, [userId, tenantId, sha256(c)]);
        }
        await q(`UPDATE auth.mfa_secrets SET enabled=true WHERE user_id=$1`, [userId]);
        await q(`UPDATE app.users SET mfa_enrolled_at=now() WHERE id=$1`, [userId]);
        await withUser(tenantId, 'system', (c) =>
          auditLog(c, tenantId, { actor: req.user?.name ?? challenger?.name ?? '(challenge)', actorRole: req.user?.role ?? challenger?.role ?? 'system', action: 'MFA enabled', recordType: 'Auth', recordRef: req.user?.email ?? challenger?.name, policyRef: 'Platform §2.4 (identity & access)', outcome: 'TOTP verified at enrollment · 8 single-use recovery codes issued (shown once)' }));
        return { enabled: true, recoveryCodes: codes };
      }

      if (!challenger) return { enabled: true };
      // login challenge satisfied → D-37(c): the shared issue path (stamps
      // force_change on the MFA-issued session too); the audit adds the
      // second-factor detail on top of the shared 'Signed in (…)' row.
      const u = await q(`SELECT id, tenant_id, name, role, email, session_epoch, force_change FROM app.users WHERE id=$1 AND active`, [userId]);
      if (!u.rows[0]) return reply.code(401).send({ error: 'account disabled' });
      const s = await issueSession(u.rows[0], usedRecovery ? 'MFA recovery code' : 'MFA', reply);
      await withUser(u.rows[0].tenant_id, u.rows[0].role, (c) =>
        auditLog(c, u.rows[0].tenant_id, { actor: u.rows[0].name, actorRole: u.rows[0].role, action: 'MFA second factor verified', recordType: 'Auth', recordRef: u.rows[0].email, policyRef: 'Platform §2.4 (identity & access)', outcome: usedRecovery ? 'recovery code consumed (single-use)' : 'TOTP verified · 30s window' }));
      return { mustChange: s.mustChange, token: s.token, user: s.user };
    });
  }

  // --- L2-4.1: scoped API keys + outbound webhook subscriptions ---------------
  {
    const sha256 = (s) => createHash('sha256').update(s).digest('hex');
    const adminOnly = (...roles) => async (req, reply) => {
      await app.authenticate(req, reply);
      if (!['owner', 'itadmin'].includes(req.user?.role)) return reply.code(403).send({ error: 'owner or itadmin only' });
    };

    app.post('/api-keys', { preHandler: adminOnly(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { name, scopes } = req.body ?? {};
      if (!name || typeof name !== 'string') return reply.code(400).send({ error: 'key name required' });
      const SCOPES = ['core.read', 'students.read', 'fees.read', 'attendance.read', 'events.read'];
      const list = Array.isArray(scopes) ? scopes.filter((s) => SCOPES.includes(s)) : [];
      const raw = `sk_${randomBytes(24).toString('hex')}`;
      const row = await q(
        `INSERT INTO app.api_keys (tenant_id, key_hash, name, scopes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [req.user.tenant_id, sha256(raw), name.slice(0, 80), list, req.user.id]);
      await withUser(req.user.tenant_id, req.user.role, (c) =>
        auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'API key created', recordType: 'ApiKey', recordRef: row.rows[0].id, policyRef: 'Platform §2.4 (identity & access)', outcome: `key '${name.slice(0, 80)}' · scopes [${list.join(', ')}] · raw key shown once` }));
      return { id: row.rows[0].id, name, scopes: list, key: raw, note: 'This key is shown once — only its hash is stored. Use it as the X-API-Key header on read doors.' };
    });

    app.get('/api-keys', { preHandler: adminOnly() }, async (req) => {
      const rows = await q(`SELECT id, name, scopes, revoked_at, last_used_at, created_at FROM app.api_keys WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user.tenant_id]);
      return { keys: rows.rows };
    });

    app.delete('/api-keys/:id', { preHandler: adminOnly() }, async (req, reply) => {
      if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'valid id required' });
      const r = await q(`UPDATE app.api_keys SET revoked_at=now() WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL RETURNING id`, [req.params.id, req.user.tenant_id]);
      if (!r.rows[0]) return reply.code(404).send({ error: 'no such active API key' });
      await withUser(req.user.tenant_id, req.user.role, (c) =>
        auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'API key revoked', recordType: 'ApiKey', recordRef: r.rows[0].id, policyRef: 'Platform §2.4 (identity & access)', outcome: 'key revoked — requests die at next use' }));
      return { ok: true };
    });

    app.post('/webhooks', { preHandler: adminOnly(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { url, events } = req.body ?? {};
      // https for real receivers; plain http ONLY for loopback (sandbox tests/dev)
      const u = (() => { try { return new URL(String(url ?? '')); } catch { return null; } })();
      const loopback = u && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
      if (!u || (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback))) {
        return reply.code(400).send({ error: 'an absolute https webhook url is required (http allowed for loopback hosts only)' });
      }
      const list = Array.isArray(events) ? events.map(String).slice(0, 50) : [];
      const secret = `whsec_${randomBytes(24).toString('hex')}`;
      const row = await q(
        `INSERT INTO app.webhook_subscriptions (tenant_id, url, events, sign_secret, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [req.user.tenant_id, String(url).slice(0, 500), list, secret, req.user.id]);
      await withUser(req.user.tenant_id, req.user.role, (c) =>
        auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Webhook subscription created', recordType: 'Webhook', recordRef: row.rows[0].id, policyRef: 'Platform §2.4 (identity & access)', outcome: `url ${String(url).slice(0, 80)} · topics [${list.join(', ') || '*'}] · signing secret shown once` }));
      return { id: row.rows[0].id, url, events: list, signSecret: secret, note: 'Deliveries are signed: X-SchoolOS-Signature: t=<unix>,v1=hex(hmac_sha256(secret, t + "." + body)) — verify before trusting. The secret is shown once.' };
    });

    app.get('/webhooks', { preHandler: adminOnly() }, async (req) => {
      const rows = await q(`SELECT id, url, events, active, created_at FROM app.webhook_subscriptions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user.tenant_id]);
      return { subscriptions: rows.rows };
    });

    app.delete('/webhooks/:id', { preHandler: adminOnly() }, async (req, reply) => {
      if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'valid id required' });
      const r = await q(`UPDATE app.webhook_subscriptions SET active=false WHERE id=$1 AND tenant_id=$2 AND active RETURNING id`, [req.params.id, req.user.tenant_id]);
      if (!r.rows[0]) return reply.code(404).send({ error: 'no such active webhook subscription' });
      await withUser(req.user.tenant_id, req.user.role, (c) =>
        auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Webhook subscription deactivated', recordType: 'Webhook', recordRef: r.rows[0].id, policyRef: 'Platform §2.4 (identity & access)', outcome: 'no further deliveries will be scheduled' }));
      return { ok: true };
    });
  }

  await registerRoutes(app, { withUser, auditLog, emitEvent, ROLES });
  // Self-serve school onboarding (053): the one sanctioned runtime tenant path.
  // Mounted beside the core routes (before plugins) so /onboard/* exists even
  // when every plugin is disabled — a brand-new school has none enabled.
  registerOnboarding(app);

  // --- plugin factory (docs/11 §2.2): the ONE registration point ---
  // Every plugin lives in src/plugins/<id>/ with manifest.js + index.js exporting
  // register(app, kernel). Adding a plugin = dropping a folder + one migration;
  // zero core edits. Enable/disable stays registry-driven (app.plugins via the
  // /plugins endpoints + drain protocol) — the loader only mounts doors.
  const requireRole = (...roles) => async (req, reply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    if (!roles.includes(req.user?.role)) {
      return reply.code(403).send({ error: `role ${req.user?.role} not permitted` });
    }
    return req.user;
  };
   await loadPlugins(app, { withUser, auditLog, emitEvent, requestAudit, q, require: requireRole });

  // --- dataset: the demo domain, server-owned (see src/generated/) ---
  const { dataset } = await import('./dataset.js');
  let datasetPayload = null;
  app.get('/dataset', { preHandler: app.authenticate }, async (req, reply) => {
    // The dataset is per-tenant and changes with enablement/records — a browser
    // must never serve it from cache (stale demo blob = 'old data' reports).
    reply.header('cache-control', 'no-store');
    if (!datasetPayload) datasetPayload = dataset();
    // Tenant identity override: the school block MUST be the caller's own
    // school (self-signup schools saw the demo brand). The rest of the blob
    // is the demo domain — replacing that world per-tenant is a product
    // decision, not an isolation bug (each tenant's LIVE data is fully RLS-
    // separated; only this demo backdrop is shared).
    const t = await q(`SELECT name, slug, config FROM app.tenants WHERE id=$1`, [req.user.tenant_id]).catch(() => ({ rows: [] }));
    const tn = t.rows[0];
    if (tn && tn.slug !== 'meridian') {
      // NON-DEMO TENANTS GET AN EMPTY WORLD — now by ALLOWLIST (T104, §7.4 P2-2 /
      // §9.5): a self-signup school receives ONLY (a) its own school identity and
      // (b) a fixed set of STRUCTURAL keys — collections as honest empties, plus
      // the two zero-shapes screens compute against. Every seed-derived key
      // (DEMO_STUDENT, DEMO_GUARDIAN, DEMO_SECTION_ID, FEE_STORY, SLA_POLICY,
      // deskSettings, SCENARIOS, and the demo corpus behind every collection) is
      // ABSENT from the payload — an allowlist cannot forget a key the way the
      // old spread-then-override blocklist did. The frontend kernel tolerates
      // every removed key (decisions D-4/D-5: DEFAULT_SLA lives client-side).
      const EMPTY_WORLD_COLLECTIONS = [
        'students', 'teachers', 'staff', 'guardians', 'guardianLinks',
        'sections', 'timetable', 'busRoutes', 'attendance',
        'feeObligations', 'payments', 'obligations', 'leads', 'documents',
        'incidents', 'cases', 'actionItems', 'decisions', 'meetings',
        'memoryDocs', 'policies', 'workflows', 'workflowRuns', 'calendarEvents',
        'healthIssues', 'notifications', 'auditEntries', 'insights',
        'assets', 'vendors', 'maintPlans', 'inspections', 'inventory',
        'workOrders', 'technicians', 'calls', 'gatePasses', 'visitors',
        'deskIntents', 'guardianChat', 'models',
      ];
      const cfg = tn.config ?? {};
      const ownCampus = (cfg.campuses?.length ? cfg.campuses : [{ id: 'main', name: `${tn.name} — Main`, shortName: 'Main' }]).map((c, i) => ({
        id: c.id ?? `campus-${i + 1}`, name: c.name ?? c, shortName: c.shortName ?? String(c.name ?? c).split(' ')[0],
        students: 0, capacity: null, hue: 'var(--campus-a)',
      }));
      const empty = {
        // tenant-real identity blocks
        SCHOOL: { name: tn.name, short: tn.name.split(' ')[0], established: null, board: cfg.board ?? null },
        campuses: ownCampus,
        // honest structural empties
        TERM_DAYS: [],
        ...Object.fromEntries(EMPTY_WORLD_COLLECTIONS.map((k) => [k, []])),
        guardianIdByStudent: {},
        // zero-shapes (b86d6fa contract: ItAdmin/HR render from these, never crash)
        aiUsage: { days: [], byFeature: [], latency: { p50: 0, p95: 0 }, failureRate: 0, monthSpend: 0, budget: 0 },
      };
      for (const k of Object.keys(empty)) if (empty[k] === undefined) delete empty[k];
      return empty;
    }
    return datasetPayload;
  });

  // --- capabilities door (Wave C decoupling contract): ONE endpoint the UI asks
  // "what is configured / what is enabled" — features are hidden client-side from
  // this answer, never hard-coded. configured = operator env/settings present;
  // enabled = app.plugins registry status (owner-path q() is fine: registry rows
  // only, and the caller's own tenant scopes the read).
  app.get('/capabilities', { preHandler: app.authenticate }, async (req) => {
    const reg = await q(`SELECT plugin_id, status, settings FROM app.plugins WHERE tenant_id=$1`, [req.user.tenant_id]).catch(() => ({ rows: [] }));
    const byId = Object.fromEntries(reg.rows.map((r) => [r.plugin_id, r]));
    const on = (id) => ['enabled', 'active', 'degraded'].includes(byId[id]?.status);
    const s = (id) => byId[id]?.settings ?? {};
    return {
      rails: {
        // rails.sms is settings-driven (provider 'logger' default, 'http-generic'
        // over env) — configured = operator env OR the rail enabled with settings.
        sms: {
          configured: !!process.env.SMS_PROVIDER || on('rails.sms'),
          provider: process.env.SMS_PROVIDER ?? s('rails.sms').provider ?? null,
        },
        whatsapp: {
          configured: on('comms.whatsapp') && !!(s('comms.whatsapp').bsp_provider ?? process.env.WHATSAPP_BSP_PROVIDER),
          provider: s('comms.whatsapp').bsp_provider ?? process.env.WHATSAPP_BSP_PROVIDER ?? null,
        },
        razorpay: { configured: !!(process.env.RAZORPAY_KEY_ID ?? s('payments.upi').key_id) },
        files: { configured: true }, // artifact store is kernel-native (docs/12 §3)
        // S0 fix A2: the registry/catalog id is 'library' — 'library.core' never
        // existed, so capabilities always reported the module off.
        library: { enabled: on('library') },
        transport: { enabled: on('transport.gps') },
      },
    };
  });

  // --- /metrics door (Wave C): Prometheus text format, owner/itadmin only.
  // Reads the in-memory counters + live DB depths; app.ops_counters rows are the
  // persisted flush state (migration 050). Counters were deliberately kept in
  // memory — an UPDATE per response would be far too hot.
  // --- L2-5.1: AI gateway — ledger + budget + eval-harness door shape ---------
  // One seam for every AI call: providers are pluggable ('logger' sandbox
  // default; real providers arrive with D-32 credentials-last). The ledger
  // write is kernel-path (q) — the doors themselves run as the app role.
  {
    const { createAiGateway } = await import('./plugins/_shared/ai-gateway.js');
    const gateway = createAiGateway({ q, kernelQ: q });
    app.post('/ai/call', { preHandler: app.authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { pluginId, purpose, provider, input, settings } = req.body ?? {};
      if (!pluginId || !purpose || input == null) return reply.code(400).send({ error: 'pluginId, purpose and input are required' });
      if (req.user.role === 'student') return reply.code(403).send({ error: 'AI doors are staff-only.' });
      const r = await gateway.call({ tenantId: req.user.tenant_id, userId: req.user.id, pluginId, purpose, provider, input, settings });
      if (!r.ok && r.code === 'budget') return reply.code(429).send({ error: r.error, code: 'budget' });
      if (!r.ok) return reply.code(503).send({ error: r.error ?? 'AI provider unavailable', code: r.code ?? 'unconfigured' });
      return r;
    });
    app.get('/ai/calls', { preHandler: requireRole('owner', 'itadmin') }, async (req) => {
      return withUser(req.user.tenant_id, req.user.role, async (c) => {
        const r = await c.query(
          `SELECT id, plugin_id, purpose, provider, model, tokens_in, tokens_out, latency_ms, outcome, error, sandbox, created_at
           FROM app.ai_calls WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user.tenant_id]);
        return { calls: r.rows };
      });
    });
    app.post('/ai/eval', { preHandler: requireRole('owner', 'itadmin'), config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
      const { pluginId, provider, cases, settings } = req.body ?? {};
      if (!Array.isArray(cases) || !cases.length) return reply.code(400).send({ error: 'cases: a non-empty array of {name?, input} is required' });
      const r = await gateway.evalRun({ tenantId: req.user.tenant_id, userId: req.user.id, pluginId, provider, cases, settings });
      return r;
    });
  }

  // --- L2-5.2: workflow rules — minimal honest step-runner state --------------
  // One rule = topic filter + tiny condition + ONE action (see
  // .coop/L2-5.2-workflow-runtime-decision.md). No UI yet; every change audited.
  app.get('/workflow-rules', { preHandler: requireRole('owner', 'itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT id, name, topic, condition, action, enabled, created_at FROM app.workflow_rules WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.user.tenant_id]);
      return { rules: r.rows };
    });
  });
  app.post('/workflow-rules', { preHandler: requireRole('owner', 'itadmin'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { name, topic, condition, action } = req.body ?? {};
    if (!name || !topic || !action?.kind) return reply.code(400).send({ error: 'name, topic and action.kind are required' });
    if (!['outbox', 'comms'].includes(action.kind)) return reply.code(400).send({ error: 'action.kind must be outbox or comms' });
    if (condition && !['exists', 'equals', 'contains'].includes(condition.op)) return reply.code(400).send({ error: 'condition.op must be exists, equals or contains' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `INSERT INTO app.workflow_rules (tenant_id, name, topic, condition, action, created_by)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6) RETURNING id`,
        [req.user.tenant_id, String(name).slice(0, 80), String(topic).slice(0, 120),
          condition ? JSON.stringify(condition) : null, JSON.stringify(action), req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Workflow rule created', recordType: 'WorkflowRule', recordRef: r.rows[0].id, policyRef: 'Platform §3.1', outcome: `topic '${String(topic).slice(0, 60)}' → ${action.kind}${action.topic ? ` '${String(action.topic).slice(0, 60)}'` : ''}` });
      return { id: r.rows[0].id };
    });
  });
  app.delete('/workflow-rules/:id', { preHandler: requireRole('owner', 'itadmin') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      /* S0 fix A1: the app role has NO table-level DELETE in schema app (D-35 law;
         migration 071 grants SELECT/INSERT/UPDATE only) — the hard DELETE here 500'd
         on every call. Soft-delete matches api-keys/webhooks: the row survives as
         audit surface, the rule simply stops applying. */
      const r = await c.query(`UPDATE app.workflow_rules SET enabled=false WHERE id=$1 AND tenant_id=$2 RETURNING id`, [req.params.id, req.user.tenant_id]);
      if (!r.rows[0]) return reply.code(404).send({ error: 'no such rule' });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Workflow rule disabled', recordType: 'WorkflowRule', recordRef: r.rows[0].id, policyRef: 'Platform §3.1', outcome: 'rule disabled — applies to no future events' });
      return { ok: true };
    });
  });

  app.get('/metrics', { preHandler: requireRole('owner', 'itadmin') }, async (_req, reply) => {
    const d = await q(`SELECT
        (SELECT count(*)::int FROM app.outbox WHERE processed_at IS NULL)    AS outbox_pending,
        (SELECT count(*)::int FROM app.communications WHERE status='queued') AS comms_queued,
        (SELECT count(*)::int FROM app.events WHERE created_at > now() - interval '1 hour') AS events_last_hour,
        (SELECT count(*)::int FROM app.schema_migrations)                    AS schema_migrations
      `).catch(() => null);
    // separate read: survives 050 not yet being applied in an environment
    const persisted = await q(`SELECT name, value FROM app.ops_counters`).catch(() => ({ rows: [] }));
    const row = d?.rows[0];
    const lines = [
      '# TYPE schoolos_uptime_seconds gauge',
      `schoolos_uptime_seconds ${Math.floor((Date.now() - metrics.startedAt) / 1000)}`,
      '# TYPE schoolos_requests_total counter',
      `schoolos_requests_total ${metrics.requestsTotal}`,
      '# TYPE schoolos_errors_total counter',
      `schoolos_errors_total ${metrics.errorsTotal}`,
      '# TYPE schoolos_pg_pool_total gauge',
      `schoolos_pg_pool_total ${pool.totalCount ?? 0}`,
      '# TYPE schoolos_pg_pool_idle gauge',
      `schoolos_pg_pool_idle ${pool.idleCount ?? 0}`,
      '# TYPE schoolos_pg_pool_waiting gauge',
      `schoolos_pg_pool_waiting ${pool.waitingCount ?? 0}`,
    ];
    if (row) {
      lines.push(
        '# TYPE schoolos_outbox_pending gauge', `schoolos_outbox_pending ${row.outbox_pending}`,
        '# TYPE schoolos_comms_queued gauge', `schoolos_comms_queued ${row.comms_queued}`,
        '# TYPE schoolos_events_last_hour gauge', `schoolos_events_last_hour ${row.events_last_hour}`,
        '# TYPE schoolos_schema_migrations gauge', `schoolos_schema_migrations ${row.schema_migrations}`);
      for (const { name, value } of persisted.rows) {
        lines.push(`# TYPE schoolos_${name} counter`, `schoolos_${name} ${value}`);
      }
    }
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(lines.join('\n') + '\n');
  });

  // Persist the hot counters every 60s (best-effort; cleared in onClose so the
  // process — and every test run — can actually exit). Boot-seed merges the
  // persisted totals so restarts continue the monotonic series, never regress it.
  q(`SELECT name, value FROM app.ops_counters`).then((r) => {
    for (const { name, value } of r.rows) {
      if (name === 'requests_total') metrics.requestsTotal = Math.max(metrics.requestsTotal, Number(value) || 0);
      if (name === 'errors_total') metrics.errorsTotal = Math.max(metrics.errorsTotal, Number(value) || 0);
    }
  }).catch(() => { /* fresh table or DB not ready — start from zero */ });
  const flushTimer = setInterval(() => {
    q(`INSERT INTO app.ops_counters (name, value) VALUES ('requests_total', $1), ('errors_total', $2)
       ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [metrics.requestsTotal, metrics.errorsTotal]).catch(() => {});
  }, 60_000);
  flushTimer.unref?.();

  // --- error handler ---
  app.setErrorHandler((err, req, reply) => {
    const code = err.statusCode ?? 500;
    if (code >= 500) { req.log.error(err); metrics.errorsTotal += 1; } // wave-c: 5xx only
    reply.code(code).send({ error: code >= 500 ? 'internal error' : err.message });
  });

  app.addHook('onClose', async () => { clearInterval(flushTimer); await pool.end(); });
  return app;
}
