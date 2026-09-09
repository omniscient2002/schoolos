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
    const u = await q(`SELECT id, tenant_id, name, role, email, password_hash FROM app.users WHERE lower(email)=lower($1) AND active ORDER BY created_at`, [email]);
    // Self-serve onboarding (053) allows the same email in several schools.
    // One match signs in; several MUST NOT pick arbitrarily — the person
    // chooses their school (409 with guidance), never a wrong-tenant login.
    if (u.rows.length > 1) {
      return reply.code(409).send({
        error: 'This email is used in more than one school on this platform. Sign in from your school\'s own sign-in page, or ask the school office which school your account belongs to.',
        multiTenant: true, schools: u.rows.length,
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
    const body = { sent: true, expiresInSeconds: Math.round(config.otp.ttlMs / 1000), devEcho: config.otp.devEcho };
    if (user) {
      const code = String(randomInt(100000, 1000000)); // CSPRNG — Math.random is not a secret source (ops.visitors precedent)
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(code, salt, 64).toString('hex');
      // kernel path: the OTP vault denies the app role entirely (RLS policy) —
      // only the owner connection may write verification secrets.
      await q(`INSERT INTO app.auth_otps (tenant_id, phone, code_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4))`,
        [user.tenant_id, phone, `${salt}:${hash}`, config.otp.ttlMs / 1000]);
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
    if (new Date(row.expires_at) < new Date()) return deny(); // expiry uses config.otp.ttlMs
    if (row.attempts >= config.otp.maxAttempts) return deny();
    const [salt, hash] = row.code_hash.split(':');
    const ok = (() => { try { return timingSafeEqual(scryptSync(String(code), salt, 64), Buffer.from(hash, 'hex')); } catch { return false; } })();
    if (!ok) {
      await q(`UPDATE app.auth_otps SET attempts = attempts + 1 WHERE id=$1`, [row.id]);
      return deny(); // same copy as every other failure — no oracle at all
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
  app.get('/dataset', { preHandler: app.authenticate }, async (req) => {
    if (!datasetPayload) datasetPayload = dataset();
    // Tenant identity override: the school block MUST be the caller's own
    // school (self-signup schools saw the demo brand). The rest of the blob
    // is the demo domain — replacing that world per-tenant is a product
    // decision, not an isolation bug (each tenant's LIVE data is fully RLS-
    // separated; only this demo backdrop is shared).
    const t = await q(`SELECT name, slug, config FROM app.tenants WHERE id=$1`, [req.user.tenant_id]).catch(() => ({ rows: [] }));
    const tn = t.rows[0];
    if (tn && tn.slug !== 'meridian') {
      // NON-DEMO TENANTS GET AN EMPTY WORLD: a self-signup school must see
      // blank screens with only ITS OWN live records — never the demo school's
      // students/timetable/fees. Shape stays identical so every screen's
      // empty-state renders naturally; /onboard/status powers what's next.
      const cfg = tn.config ?? {};
      const ownCampus = (cfg.campuses?.length ? cfg.campuses : [{ id: 'main', name: `${tn.name} — Main`, shortName: 'Main' }]).map((c, i) => ({
        id: c.id ?? `campus-${i + 1}`, name: c.name ?? c, shortName: c.shortName ?? String(c.name ?? c).split(' ')[0],
        students: 0, capacity: null, hue: 'var(--campus-a)',
      }));
      const empty = {
        ...datasetPayload,
        SCHOOL: { name: tn.name, short: tn.name.split(' ')[0], established: null, board: cfg.board ?? null },
        campuses: ownCampus,
        TERM_DAYS: [],
        students: [], teachers: [], staff: [], guardians: [], guardianLinks: [],
        sections: [], timetable: [], busRoutes: [], attendance: [],
        feeObligations: [], payments: [], leads: [], documents: [], incidents: [],
        cases: [], actionItems: [], decisions: [], meetings: [], memoryDocs: [],
        policies: [], workflows: [], workflowRuns: [], obligations: [], calendarEvents: [],
        healthIssues: [], notifications: [], auditEntries: [], insights: [],
        assets: [], vendors: [], maintPlans: [], inspections: [], inventory: [],
        technicians: [], calls: [], gatePasses: [], visitors: [], deskIntents: [],
        guardianIdByStudent: {}, SCENARIOS: [],
        aiUsage: { totalCalls: 0, tokens: 0, byFeature: [] }, models: [], guardianChat: [],
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
        // no library plugin is registered yet (Waves A/B own it) → false until it lands
        library: { enabled: on('library.core') },
        transport: { enabled: on('transport.gps') },
      },
    };
  });

  // --- /metrics door (Wave C): Prometheus text format, owner/itadmin only.
  // Reads the in-memory counters + live DB depths; app.ops_counters rows are the
  // persisted flush state (migration 050). Counters were deliberately kept in
  // memory — an UPDATE per response would be far too hot.
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
