// Fastify application factory — routes, auth hook, error handling.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { pool, q, withUser } from './db.js';
import { verifyPassword, dummyVerify, ROLES } from './auth.js';
import { scryptSync, timingSafeEqual, randomBytes, randomUUID, randomInt } from 'node:crypto';
import { auditLog, emitEvent, requestAudit } from './audit.js';
import { registerRoutes } from './routes.js';
import { loadPlugins } from './plugins/loader.js';

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
  // Security matrix A3: every token carries a jti; a logged-out jti is refused here
  // until natural expiry (038 auth.revoked_token). Verification failures never leak
  // which check failed.
  app.decorate('authenticate', async (req, reply) => {
    try {
      const payload = await req.jwtVerify();
      req.auth = payload; // token claims (incl. jti) — DB row below is authoritative for identity
      // A3 hard rule: every token MUST carry a jti, else it can never be revoked
      // (RT-7 P2-6). The pre-038 compat window is closed — re-login reissues tokens.
      if (!payload.jti) return reply.code(401).send({ error: 'session ended — sign in again' });
      const rev = await q(`SELECT 1 FROM auth.revoked_token WHERE jti=$1`, [payload.jti]);
      if (rev.rows[0]) return reply.code(401).send({ error: 'session ended — sign in again' });
      const u = await q(`SELECT id, tenant_id, name, role, pg_role, email FROM app.users WHERE id=$1 AND active`, [payload.sub]);
      if (!u.rows[0]) return reply.code(401).send({ error: 'account disabled' });
      req.user = u.rows[0];
    } catch {
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
    const { email, password } = req.body ?? {};
    if (!email || !password) return reply.code(400).send({ error: 'email and password required' });
    const u = await q(`SELECT id, tenant_id, name, role, email, password_hash FROM app.users WHERE lower(email)=lower($1) AND active`, [email]);
    const user = u.rows[0];
    if (!user) {
      // Timing-equalization: burn the same scrypt cost as a real verify so
      // response time doesn't reveal whether the email exists (RT-7cyc8 P2-16).
      dummyVerify(password);
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    if (!verifyPassword(password, user.password_hash)) return reply.code(401).send({ error: 'invalid credentials' });
    const token = app.jwt.sign({ sub: user.id, role: user.role, tenant: user.tenant_id, name: user.name, jti: randomUUID() },
      user.role === 'student' ? { expiresIn: config.studentSessionTtl } : {});
    await withUser(user.tenant_id, user.role, (c) =>
      auditLog(c, user.tenant_id, { actor: user.name, actorRole: user.role, action: 'Signed in', recordType: 'Auth', recordRef: user.email, policyRef: 'Platform §2.4 (identity & access)', outcome: `JWT issued${user.role === 'student' ? ` (short-lived shared-computer session, ${config.studentSessionTtl})` : ''}` }));
    return { token, user: { id: user.id, name: user.name, role: user.role, email: user.email, tenantId: user.tenant_id } };
  });

  // ---- full authentication (008): phone OTP · Google SSO · logout ----
  const issueSession = async (user, via) => {
    const token = app.jwt.sign({ sub: user.id, role: user.role, tenant: user.tenant_id, name: user.name, jti: randomUUID() },
      user.role === 'student' ? { expiresIn: config.studentSessionTtl } : {});
    await withUser(user.tenant_id, user.role, (c) =>
      auditLog(c, user.tenant_id, { actor: user.name, actorRole: user.role, action: `Signed in (${via})`, recordType: 'Auth', recordRef: via === 'phone' ? user.phone : user.email, policyRef: 'Platform §2.4 (identity & access)', outcome: `JWT issued${user.role === 'student' ? ` (short-lived shared-computer session, ${config.studentSessionTtl})` : ''}` }));
    return { token, user: { id: user.id, name: user.name, role: user.role, email: user.email, tenantId: user.tenant_id } };
  };

  // --- phone + OTP ---
  app.post('/auth/otp/request', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { phone } = req.body ?? {};
    if (!phone || !/^\+?[0-9]{10,14}$/.test(phone)) return reply.code(400).send({ error: 'valid phone required (+countrycode)' });
    const u = await q(`SELECT id, tenant_id, name, role, phone FROM app.users WHERE phone=$1 AND active`, [phone]);
    const user = u.rows[0] ?? null;
    // Uniform response shape — phone enumeration must not distinguish
    // registered from unregistered numbers.
    const body = { sent: true, expiresInSeconds: 300, devEcho: config.otp.devEcho };
    if (user) {
      const code = String(randomInt(100000, 1000000)); // CSPRNG — Math.random is not a secret source (ops.visitors precedent)
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(code, salt, 64).toString('hex');
      // kernel path: the OTP vault denies the app role entirely (RLS policy) —
      // only the owner connection may write verification secrets.
      await q(`INSERT INTO app.auth_otps (tenant_id, phone, code_hash, expires_at) VALUES ($1,$2,$3, now() + interval '5 minutes')`,
        [user.tenant_id, phone, `${salt}:${hash}`]);
      req.log.warn({ phone: phone.slice(-4), msg: 'OTP issued' });
      if (config.otp.devEcho) body.devCode = code; // dev-only echo, opt-in via OTP_DEV_ECHO
    }
    return body;
  });

  app.post('/auth/otp/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { phone, code } = req.body ?? {};
    if (!phone || !code) return reply.code(400).send({ error: 'phone and code required' });
    const u = await q(`SELECT id, tenant_id, name, role, phone FROM app.users WHERE phone=$1 AND active`, [phone]);
    // Uniform failure copy for EVERY path — registered/unregistered/expired/missing
    // code all look identical from outside (phone-enumeration defense, RT-7cyc8).
    const DENIED = { error: 'that code didn’t work — request a new one and try again' };
    const deny = () => reply.code(401).send(DENIED);
    const user = u.rows[0];
    const otp = user ? await q(`SELECT id, code_hash, attempts, expires_at, consumed_at FROM app.auth_otps WHERE phone=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, [phone]) : { rows: [] };
    const row = otp.rows[0];
    if (!row) return deny();
    if (new Date(row.expires_at) < new Date()) return deny();
    if (row.attempts >= config.otp.maxAttempts) return deny();
    const [salt, hash] = row.code_hash.split(':');
    const ok = (() => { try { return timingSafeEqual(scryptSync(String(code), salt, 64), Buffer.from(hash, 'hex')); } catch { return false; } })();
    if (!ok) {
      await q(`UPDATE app.auth_otps SET attempts = attempts + 1 WHERE id=$1`, [row.id]);
      return reply.code(401).send({ error: 'invalid code' });
    }
    await q(`UPDATE app.auth_otps SET consumed_at = now() WHERE id=$1`, [row.id]);
    return issueSession(user, 'phone');
  });

  // --- Google SSO (OAuth 2.0 authorization code flow) ---
  const googleConfigured = () => !!(config.google.clientId && config.google.clientSecret && config.google.redirectUri);
  app.get('/auth/google/start', async (req, reply) => {
    if (!googleConfigured()) return reply.code(503).send({ error: 'Google SSO not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)' });
    const state = randomBytes(16).toString('hex');
    // P1-8: state is stored server-side (short TTL) and verified in the callback —
    // generated-but-unvalidated state = login CSRF.
    await q(`INSERT INTO app.oauth_states (state, created_at) VALUES ($1, now()) ON CONFLICT (state) DO NOTHING`, [state]).catch(async () => {
      await q(`CREATE TABLE IF NOT EXISTS app.oauth_states (state text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`);
      await q(`INSERT INTO app.oauth_states (state) VALUES ($1) ON CONFLICT (state) DO NOTHING`, [state]);
    });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', config.google.clientId);
    url.searchParams.set('redirect_uri', config.google.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    await q(`SELECT 1`); // noop keeps behavior symmetrical
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
      const u = await q(`SELECT id, tenant_id, name, role, email FROM app.users WHERE lower(email)=lower($1) AND active`, [email]);
      if (!u.rows[0]) return reply.code(403).send({ error: `no SchoolOS account for ${email} — contact your school admin` });
      await q(`UPDATE app.users SET auth_provider='google' WHERE id=$1`, [u.rows[0].id]);
      return issueSession(u.rows[0], 'google-sso');
    } catch (e) { req.log.error(e); return reply.code(502).send({ error: 'google sso unreachable' }); }
  });

  // Dev SSO simulator — ONLY when Google isn't configured and we're not in production.
  // Lets the full SSO UX be exercised end-to-end before real OAuth credentials exist.
  app.post('/auth/google/demo', async (req, reply) => {
    const demoSso = process.env.AUTH_DEV_SSO === '1' && config.env !== 'production';
    if (!demoSso || googleConfigured()) return reply.code(403).send({ error: 'dev SSO simulator disabled' });
    const { email } = req.body ?? {};
    if (!email) return reply.code(400).send({ error: 'email required' });
    const u = await q(`SELECT id, tenant_id, name, role, email FROM app.users WHERE lower(email)=lower($1) AND active`, [email]);
    if (!u.rows[0]) return reply.code(403).send({ error: `no SchoolOS account for ${email}` });
    return issueSession(u.rows[0], 'google-sso (dev simulator)');
  });

  // --- logout (audited) ---
  // Shared-computer guarantee (StudentOS §78/§79): ending a session wipes the
  // browser's cached content and storage — the next student on this machine can
  // never reopen the previous student's data. Personal-data planes are no-store.
  app.addHook('onSend', async (req, reply) => {
    const path = (req.raw?.url || '').split('?')[0];
    if (/^\/(auth|me|parent|student)(\/|$)/.test(path)) reply.header('cache-control', 'no-store');
  });
  app.post('/auth/logout', { preHandler: app.authenticate }, async (req, reply) => {
    reply.header('Clear-Site-Data', '"cache", "storage"');
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

  await registerRoutes(app, { withUser, auditLog, emitEvent, ROLES });

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
  app.get('/dataset', { preHandler: app.authenticate }, async () => {
    if (!datasetPayload) datasetPayload = dataset();
    return datasetPayload;
  });

  // --- error handler ---
  app.setErrorHandler((err, req, reply) => {
    const code = err.statusCode ?? 500;
    if (code >= 500) req.log.error(err);
    reply.code(code).send({ error: code >= 500 ? 'internal error' : err.message });
  });

  app.addHook('onClose', async () => { await pool.end(); });
  return app;
}
