// Fastify application factory — routes, auth hook, error handling.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { isSandboxResult, sandboxAllowed } from './plugins/_shared/delivery-honesty.js';
import { pool, q, sysq, tx, withUser } from './db.js';
import { hashPassword, verifyPassword, verifyPasswordDetailed, dummyVerify, ROLES } from './auth.js';
import { scryptSync, timingSafeEqual, randomBytes, randomUUID, randomInt, createHash, createHmac } from 'node:crypto';
import { auditLog, emitEvent, requestAudit } from './audit.js';
import { registerRoutes } from './routes.js';
import { registerOnboarding } from './onboarding.js';
import { loadPlugins } from './plugins/loader.js';
import { customRoles } from './custom-roles.js';
import { makeCoreLaneActions } from './core-lane-actions.js';
import { toE164 } from './plugins/_shared/phone.js';
import { assertPublicWebhookUrl } from './plugins/_shared/webhook-target.js';
import { buildInfo } from './build-info.js';
import { capabilityEnabled } from './plugin-capabilities.js';
import { installRawJsonParser } from './plugins/_shared/raw-body-parser.js';

// Wave C metrics (GET /metrics): in-memory process counters + a 60s flush into
// app.ops_counters (migration 050) so the monotonic totals survive a restart.
// Counters are advisory ops data — they ride the owner path and are never
// request-critical, so flush failures are swallowed.
const metrics = {
  requestsTotal: 0, errorsTotal: 0, startedAt: Date.now(), latencyTotalMs: 0,
  // OPSX-9: how much of the in-memory total this process has already PERSISTED. The 60s flush writes only
  // the unsynced delta (`value = value + delta`), so several replicas accumulate instead of overwriting one
  // row with their own smaller number — and a scrape can report the fleet total.
  flushedRequests: 0, flushedErrors: 0,
  // OPSX-13: the histogram's `_count` is incremented in the SAME onResponse hook as its buckets, so it can
  // never exceed the +Inf bucket (the old emission used requestsTotal, which is bumped in onSend and can
  // exceed the bucket sum when a response is aborted before onResponse).
  latencyCount: 0,
  latencyBuckets: new Map([[100, 0], [250, 0], [500, 0], [1000, 0], [2000, 0], [5000, 0], [Infinity, 0]]),
};

// AUTH-9: MFA recovery codes are 80-bit and stored as a KEYED hash (HMAC over the server secret), so a
// database leak cannot brute-force a short unsalted digest. Consumed with the same function.
const recoveryHash = (code) => createHmac('sha256', config.jwtSecret).update(`mfa-recovery:${String(code).trim()}`).digest('hex');

export async function buildApp(opts = {}) {
  // RTR-001 Track F: trustProxy is opt-in via env. Hardcoding true made req.ip
  // XFF-derived, so rotating a spoofed X-Forwarded-For defeated every limiter.
  const app = Fastify({
    logger: opts.logger ?? { level: config.logLevel },
    trustProxy: process.env.TRUST_PROXY === 'true',
    // Keep the default explicit and auditable. Upload routes opt into their
    // larger, validated limit; every other JSON door is bounded here.
    bodyLimit: 2 * 1024 * 1024,
    /* API-4 (PERFECT-100 §5.5): the instance set neither timeout. Against a single 20-connection pool, a hung
       handler pins a connection indefinitely — enough of them exhaust the pool and take down the whole API
       (webhook receivers included). requestTimeout bounds the handler; connectionTimeout bounds a client that
       opens a socket and never finishes the request. */
    requestTimeout: 30_000,
    connectionTimeout: 10_000,
  });
  // Readiness is also a routing signal: once shutdown starts, stop accepting
  // new work while existing requests drain.
  app.decorate('schoolosDraining', false);

  await app.register(cors, { origin: config.corsOrigins, credentials: false }); // auth is header-borne; no cookies yet
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.jwtTtl } });
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: '1 minute',
    // RTR-001 Track F: we deploy directly (no reverse proxy yet). Trusting
    // X-Forwarded-For let attackers rotate IPs past the limiter. When a real
    // proxy is added, set TRUST_PROXY=true in the environment.
    // AUTH-6: when trusted, use the RIGHTMOST hop, not the leftmost. A single reverse proxy APPENDS the
    // real client address, so the leftmost entry is attacker-supplied (`X-Forwarded-For: 1.2.3.4` from the
    // client lands before the appended one) and rotating it defeated the limiter. The rightmost hop is the
    // value the trusted proxy wrote. (Multi-proxy or non-appending setups should key on a trusted hop
    // count — tracked as a residual; this closes the single-proxy oracle.)
    keyGenerator: (req) => process.env.TRUST_PROXY === 'true'
      ? (req.headers['x-forwarded-for']?.split(',').map((s) => s.trim()).filter(Boolean).pop() || req.ip)
      : req.ip,
  });
  // Install multipart once at the kernel boundary. Plugins still enforce their
  // narrower route-specific limits in code, but parser ownership and the hard
  // process-wide ceiling no longer depend on alphabetical plugin load order.
  const MULTIPART_MOUNTED = Symbol.for('schoolos.multipart.mounted');
  if (!app[MULTIPART_MOUNTED]) {
    await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 }, attachFieldsToBody: false });
    app[MULTIPART_MOUNTED] = true;
  }
  // Money webhooks verify HMACs over the exact wire bytes. Install the parser at
  // the kernel boundary so parser ownership cannot depend on plugin load order.
  installRawJsonParser(app);

  // --- auth decoration ---
  // --- L2-3.1: cookie session (HttpOnly) + CSRF double-submit ---------------
  // Bearer stays the API-client path (unchanged). Browser sessions additionally
  // get HttpOnly cookies: schoolos_session (the JWT, unreadable to JS) and
  // schoolos_csrf (JS-readable) which cookie-authed MUTATIONS must echo in
  // X-CSRF-Token. Secure is production-only so plain-HTTP localhost stays usable.
  const SESSION_COOKIE = 'schoolos_session';
  const CSRF_COOKIE = 'schoolos_csrf';
  const COOKIE_SECURE = config.env === 'production';
  // Login CSRF is not needed by the bearer API, but browser sessions should
  // never ride a cross-site navigation. Strict is the safe default for this
  // same-origin app; mutations still use the double-submit token below.
  const cookieAttrs = (maxAge) => `; Path=/; SameSite=Strict${COOKIE_SECURE ? '; Secure' : ''}; Max-Age=${maxAge}`;
  const readCookie = (req, name) => {
    const raw = req.headers.cookie;
    if (!raw) return null;
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      // AUTH-9: `decodeURIComponent('%')` throws a URIError; a malformed cookie used to 500 the auth hook
      // (authentication is not the place for an unhandled parse error). A cookie we cannot decode is not
      // a session cookie.
      if (part.slice(0, idx).trim() === name) {
        try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch { return null; }
      }
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
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict${COOKIE_SECURE ? '; Secure' : ''}; Max-Age=0`,
      `${CSRF_COOKIE}=; Path=/; SameSite=Strict${COOKIE_SECURE ? '; Secure' : ''}; Max-Age=0`,
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
    'GET /students': 'students.read',
    'GET /students/:id': 'students.read',
    'GET /attendance': 'attendance.read',
    // OPSX-4: an operator's Prometheus has no human session. A key holding this scope may scrape the
    // platform metrics through the same door a human owner uses; requireRole admits an API-key principal
    // precisely because authenticate has already validated the door is in this map AND the key holds the
    // scope. Without it, alerting had no machine identity at all.
    'GET /metrics': 'metrics.read',
  };
  app.decorate('authenticate', async (req, reply) => {
    try {
      const apiKeyHeader = req.headers['x-api-key'];
      if (apiKeyHeader) {
        if (req.method !== 'GET') return reply.code(403).send({ error: 'API keys are read-only — mutations are refused.' });
        const keyHash = createHash('sha256').update(String(apiKeyHeader)).digest('hex');
        const k = await sysq(`SELECT id, tenant_id, name, scopes FROM app.api_keys WHERE key_hash=$1 AND revoked_at IS NULL`, [keyHash]);
        if (!k.rows[0]) return reply.code(401).send({ error: 'invalid or revoked API key' });
        const door = `${req.method} ${req.routeOptions?.url ?? req.url.split('?')[0]}`;
        if (!(door in API_DOOR_SCOPES)) return reply.code(403).send({ error: `API keys are limited to scoped read doors — '${door}' is not one.` });
        const needed = API_DOOR_SCOPES[door];
        if (needed && !(k.rows[0].scopes ?? []).includes(needed)) {
          return reply.code(403).send({ error: `API key lacks the '${needed}' scope for this door.` });
        }
        await sysq(`UPDATE app.api_keys SET last_used_at=now() WHERE id=$1`, [k.rows[0].id]);
        req.auth = { sub: k.rows[0].id, via: 'api-key', jti: `apikey:${k.rows[0].id}` };
        req.user = { id: k.rows[0].id, tenant_id: k.rows[0].tenant_id, role: 'api', name: `api:${k.rows[0].name}`, email: null, pg_role: 'schoolos_app' };
        req.apiScopes = k.rows[0].scopes ?? [];
        return; // synthetic principal resolved — JWT path skipped
      }
      const via = req.headers.authorization?.startsWith('Bearer ') ? 'bearer' : 'cookie';
      const sessionCookie = readCookie(req, SESSION_COOKIE);
      const token = via === 'bearer' ? req.headers.authorization.slice(7) : sessionCookie;
      // S0 fix A7b: CSRF protects COOKIE-carried auth — a request with no session
      // cookie isn't cookie-authed, so it must fall through to the 401 below
      // (previously an absent-session renew answered 403 CSRF instead of 401).
      if (via === 'cookie' && sessionCookie) {
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
      const rev = await sysq(`SELECT 1 FROM auth.revoked_token WHERE jti=$1`, [payload.jti]);
      if (rev.rows[0]) return reply.code(401).send({ error: 'session ended — sign in again' });
      const u = await sysq(`SELECT id, tenant_id, name, role, pg_role, email, session_epoch, force_change, mfa_enrolled_at FROM app.users WHERE id=$1 AND active`, [payload.sub]);
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
      // RBAC-1: a custom-role DENY is honoured on EVERY authenticated door, including plugin doors that
      // carry no role gate of their own (the self-service ones gated only by `authenticate`). Enforcement
      // used to live solely in the kernel `require`, so a deny was honoured on some doors and silently
      // ignored on others — worse than not offering the feature, because the owner is told it exists.
      // The ALLOW direction still belongs to the two role gates (a grant must lift a role refusal, which
      // only a gate can do); this call covers the restrictive half everywhere. Memoised per request, so a
      // gate running afterwards reuses this decision rather than re-reading the store.
      await customRoles.applyMask(req, reply, sysq);
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
    const r = await sysq('SELECT 1 AS ok').catch(() => null);
    // OPS-11: which build is live? Answered here because /health is the one endpoint every operator and
    // orchestrator already reaches for, and after a bad deploy it is the first thing anyone curls. The field is
    // ADDITIVE — nothing that consumed {status, db, time} breaks — and derived at startup rather than read from
    // a file a human updates, because a hand-maintained version is true once and then decays silently.
    const build = buildInfo();
    return {
      status: r ? 'ok' : 'degraded', db: !!r, time: new Date().toISOString(),
      build: {
        id: build.id, version: build.version, fingerprint: build.fingerprint,
        identitySource: build.identitySource, env: build.env, node: build.node, startedAt: build.startedAt,
      },
    };
  });
  // Readiness for orchestrators (ops audit P0-4): 503 unless the DB actually answers.
  // /health stays 200-degraded for humans; THIS is what HEALTHCHECK/LBs must poll.
  app.get('/ready', async (_req, reply) => {
    if (app.schoolosDraining) return reply.code(503).send({ ready: false, reason: 'server draining' });
    const r = await sysq('SELECT 1 AS ok').catch(() => null);
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
    // AUTH-4: identifier-keyed lock, checked BEFORE the lookup so a known and an unknown email answer the
    // same 429 (the old per-account lock could only fire for a real account → an enumeration oracle).
    const identLock = await requestThrottleLocked('login', email);
    if (identLock) return reply.code(429).send({ error: 'Too many unsuccessful sign-in attempts. Try again later.', retryAfter: identLock });
    const u = await sysq(`SELECT u.id, u.tenant_id, u.name, u.role, u.email, u.password_hash, u.session_epoch, u.force_change, (m.enabled = true) AS mfa_enabled, t.name AS tenant_name FROM app.users u LEFT JOIN auth.mfa_secrets m ON m.user_id = u.id JOIN app.tenants t ON t.id = u.tenant_id WHERE lower(u.email)=lower($1) AND u.active ${scope ? 'AND u.tenant_id=$2' : ''} ORDER BY u.created_at`, scope ? [email, scope] : [email]);
    // Self-serve onboarding (053) allows the same email in several schools.
    // One match signs in; several MUST NOT pick arbitrarily — the person
    // chooses their school (409 with guidance), never a wrong-tenant login.
    if (u.rows.length > 1) {
      // AUTH-9: the picker must not disclose which schools an email belongs to to someone who does not
      // hold a credential for it. Verify the password against the matching rows FIRST; no match is the
      // uniform invalid-credentials answer. (The picker still lists all memberships to a holder — the
      // person needs to choose their school. OTP's picker is the same shape; its code is verified after
      // this point and is tracked as the residual.)
      const anyMatch = u.rows.some((r) => verifyPasswordDetailed(password, r.password_hash).valid);
      if (!anyMatch) return reply.code(401).send({ error: 'invalid credentials' });
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
      // AUTH-4: an unknown email is counted exactly like a wrong password, so the fifth failure locks it
      // identically (the response above is now reachable only below the lock threshold).
      const t = await bumpLoginThrottle(email);
      if (t?.locked_until) return reply.code(429).send({ error: 'Too many unsuccessful sign-in attempts. Try again later.', retryAfter: t.locked_until });
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    // SEC-10: the HTTP limiter is per process/IP and cannot stop a distributed
    // password spray against one account.  Keep the account lock in the kernel
    // database so all API replicas share the same five-guess/15-minute guard.
    const throttle = await sysq(
      `SELECT failed_attempts, locked_until FROM auth.login_throttles WHERE user_id=$1`, [user.id]);
    if (throttle.rows[0]?.locked_until && new Date(throttle.rows[0].locked_until) > new Date()) {
      return reply.code(429).send({ error: 'Too many unsuccessful sign-in attempts. Try again later.', retryAfter: throttle.rows[0].locked_until });
    }
    const passwordCheck = verifyPasswordDetailed(password, user.password_hash);
    if (!passwordCheck.valid) {
      const failed = await sysq(
        `INSERT INTO auth.login_throttles (user_id, failed_attempts, locked_until, last_failed_at)
         VALUES ($1,1,NULL,now())
         ON CONFLICT (user_id) DO UPDATE SET
           failed_attempts = CASE WHEN auth.login_throttles.locked_until IS NOT NULL AND auth.login_throttles.locked_until <= now()
                                  THEN 1 ELSE auth.login_throttles.failed_attempts + 1 END,
           locked_until = CASE WHEN (CASE WHEN auth.login_throttles.locked_until IS NOT NULL AND auth.login_throttles.locked_until <= now()
                                          THEN 1 ELSE auth.login_throttles.failed_attempts + 1 END) >= 5
                               THEN now() + interval '15 minutes' ELSE NULL END,
           last_failed_at = now()
         RETURNING failed_attempts, locked_until`, [user.id]);
      const row = failed.rows[0];
      // AUTH-4: bump the identifier-keyed counter too; whichever locks first decides, uniformly.
      const t = await bumpLoginThrottle(email);
      const lockedUntil = row?.locked_until ?? t?.locked_until ?? null;
      return reply.code(lockedUntil ? 429 : 401).send({
        error: lockedUntil ? 'Too many unsuccessful sign-in attempts. Try again later.' : 'invalid credentials',
        ...(lockedUntil ? { retryAfter: lockedUntil } : {}),
      });
    }
    // A valid password clears the account's failure window before any session or
    // MFA challenge is issued.
    await sysq(`DELETE FROM auth.login_throttles WHERE user_id=$1`, [user.id]);
    await clearRequestThrottle('login', email);
    // SEC-13: legacy hashes are accepted for compatibility, then upgraded only
    // after a successful password proof. The old value in the WHERE clause
    // prevents a concurrent password change from being overwritten.
    if (passwordCheck.needsRehash) {
      await sysq(`UPDATE app.users SET password_hash=$1 WHERE id=$2 AND password_hash=$3`,
        [hashPassword(password), user.id, user.password_hash]);
    }
    // D-37(a): MFA challenge is a plain JSON 401 — no 307/Location. A staff
    // account with an enabled TOTP factor does NOT get a session yet; the body
    // carries a 5-minute challenge token (claim mfaPending) that the
    // authenticate hook limits to /me/mfa/verify.
    if (user.mfa_enabled) return mfaChallenge(user, reply, 'password verified');
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
  // that the door exists). S0 fix B12: authenticate rides the preHandler so
  // the permission matrix classifies this door auth-only (it previously ran
  // inside the handler and scanned as unguarded).
  app.post('/auth/renew', { preHandler: app.authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (req.auth?.via === 'api-key') return reply.code(403).send({ error: 'API keys do not renew sessions.' });
    const u = await sysq(`SELECT id, tenant_id, name, role, email, session_epoch, force_change FROM app.users WHERE id=$1 AND active`, [req.user.id]);
    if (!u.rows[0]) return reply.code(401).send({ error: 'account disabled' });
    const s = await issueSession(u.rows[0], 'renew', reply);
    // S0 fix A6: retire the token being renewed — without this the old jti
    // stayed valid until natural expiry alongside its replacement.
    if (req.auth?.jti) {
      const oldExp = req.auth.exp ? new Date(req.auth.exp * 1000) : new Date(Date.now() + 13 * 3600 * 1000);
      await sysq(`INSERT INTO auth.revoked_token (jti, tenant_id, exp) VALUES ($1,$2,$3)
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

  // AUTH-3: the second factor is demanded on EVERY issuance path. The challenge
  // used to be minted only on the password branch, so a staff account with an
  // enabled TOTP factor was downgraded to one factor by signing in with a phone
  // code or Google instead — the weaker alternative silently replaced the
  // stronger one. `proof` names the factor just verified, for the ledger.
  const mfaChallenge = async (user, reply, proof) => {
    const challengeJti = randomUUID();
    const challengeToken = app.jwt.sign({ sub: user.id, role: user.role, tenant: user.tenant_id, name: user.name, jti: challengeJti, mfaPending: true }, { expiresIn: '5m' });
    await sysq(
      `INSERT INTO auth.mfa_challenges (jti, user_id, tenant_id, expires_at)
       VALUES ($1,$2,$3,now() + interval '5 minutes')`,
      [challengeJti, user.id, user.tenant_id]);
    await withUser(user.tenant_id, user.role, (c) =>
      auditLog(c, user.tenant_id, { actor: user.name, actorRole: user.role, action: 'Signed in (MFA challenge)', recordType: 'Auth', recordRef: user.email ?? user.phone, policyRef: 'Platform §2.4 (identity & access)', outcome: `${proof} · second factor required before session issue` }));
    return reply.code(401).send({ error: 'Second factor required — verify your authenticator code to finish signing in.', mfaRequired: true, challengeToken, user: { id: user.id, name: user.name, email: user.email } });
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

  /* AUTH-4 / AUTH-8 (migration 103): identifier-keyed throttles. The key is a sha256 hash, so the table
     holds no PII and a KNOWN and an UNKNOWN identifier throttle identically — which is what closes the
     login enumeration oracle (a locked account used to answer 429 while a stranger answered 401). */
  const idKey = (scope, value) => createHash('sha256').update(`${scope}:${String(value).toLowerCase()}`).digest('hex');
  const requestThrottleLocked = async (scope, value) => {
    const r = await sysq(`SELECT locked_until FROM auth.request_throttles WHERE scope=$1 AND identifier=$2`, [scope, idKey(scope, value)]);
    const lu = r.rows[0]?.locked_until;
    return lu && new Date(lu) > new Date() ? lu : null;
  };
  const clearRequestThrottle = (scope, value) =>
    sysq(`DELETE FROM auth.request_throttles WHERE scope=$1 AND identifier=$2`, [scope, idKey(scope, value)]);
  const bumpLoginThrottle = async (email) => {
    const r = await sysq(
      `INSERT INTO auth.request_throttles (scope, identifier, attempts, window_started_at, last_attempt_at)
       VALUES ('login',$1,1,now(),now())
       ON CONFLICT (scope, identifier) DO UPDATE SET
         attempts = CASE WHEN auth.request_throttles.locked_until IS NOT NULL AND auth.request_throttles.locked_until <= now() THEN 1 ELSE auth.request_throttles.attempts + 1 END,
         locked_until = CASE WHEN (CASE WHEN auth.request_throttles.locked_until IS NOT NULL AND auth.request_throttles.locked_until <= now() THEN 1 ELSE auth.request_throttles.attempts + 1 END) >= 5
                             THEN now() + interval '15 minutes' ELSE NULL END,
         last_attempt_at = now()
       RETURNING attempts, locked_until`, [idKey('login', email)]);
    return r.rows[0];
  };
  // AUTH-9: a cumulative MFA-failure lockout. The per-challenge 5-guess ceiling is not enough — an attacker
  // can request a fresh challenge and get five more guesses, limited only by the login rate limiter. This
  // keys on the account, so repeated failures across challenges lock the second factor for 15 minutes.
  const bumpMfaThrottle = async (userId) => {
    const r = await sysq(
      `INSERT INTO auth.request_throttles (scope, identifier, attempts, window_started_at, last_attempt_at)
       VALUES ('mfa',$1,1,now(),now())
       ON CONFLICT (scope, identifier) DO UPDATE SET
         attempts = CASE WHEN auth.request_throttles.locked_until IS NOT NULL AND auth.request_throttles.locked_until <= now() THEN 1 ELSE auth.request_throttles.attempts + 1 END,
         locked_until = CASE WHEN (CASE WHEN auth.request_throttles.locked_until IS NOT NULL AND auth.request_throttles.locked_until <= now() THEN 1 ELSE auth.request_throttles.attempts + 1 END) >= 10
                             THEN now() + interval '15 minutes' ELSE NULL END,
         last_attempt_at = now()
       RETURNING attempts, locked_until`, [idKey('mfa', userId)]);
    return r.rows[0];
  };

  /* OTP request: a per-phone DAILY cap is always enforced; the 60s cooldown guards the real production
     send path (a carrier costs money, and rapid re-sends are the toll-fraud vector). Non-production runs
     keep the daily cap but skip the cooldown — the suite and the sandbox drive the same phone rapidly and
     no carrier is billed. */
  const otpRequestAllowed = async (phone) => {
    const key = idKey('otp.request', phone);
    const r = await sysq(`SELECT attempts, window_started_at, last_attempt_at FROM auth.request_throttles WHERE scope='otp.request' AND identifier=$1`, [key]);
    const row = r.rows[0];
    const now = Date.now();
    if (config.env === 'production' && row?.last_attempt_at && now - new Date(row.last_attempt_at).getTime() < 60_000) {
      return { allowed: false, retryAfter: new Date(new Date(row.last_attempt_at).getTime() + 60_000) };
    }
    const freshWindow = !row || now - new Date(row.window_started_at).getTime() >= 24 * 3600 * 1000;
    const attempts = freshWindow ? 0 : row.attempts;
    if (attempts >= 10) return { allowed: false, retryAfter: new Date(new Date(row.window_started_at).getTime() + 24 * 3600 * 1000) };
    await sysq(
      `INSERT INTO auth.request_throttles (scope, identifier, attempts, window_started_at, last_attempt_at)
       VALUES ('otp.request',$1,1,now(),now())
       ON CONFLICT (scope, identifier) DO UPDATE SET
         attempts = CASE WHEN auth.request_throttles.window_started_at < now() - interval '24 hours' THEN 1 ELSE auth.request_throttles.attempts + 1 END,
         window_started_at = CASE WHEN auth.request_throttles.window_started_at < now() - interval '24 hours' THEN now() ELSE auth.request_throttles.window_started_at END,
         last_attempt_at = now()`, [key]);
    return { allowed: true };
  };

  // OPS-5: the SMS rail reads its provider settings on the OWNER path (app.plugins.settings is denied to the
  // app role in some deployments), so it needs the kernel bound exactly as rails.email does below. Bound once
  // here, lazily: the API process must not require the rail to be loaded to serve its other doors.
  {
    const sms = await import('./plugins/rails.sms/index.js');
    sms.bindKernel(sysq);
  }

  app.post('/auth/otp/request', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { phone: rawPhone, tenantId } = req.body ?? {};
    // S1 (independent review): the rail refuses anything but strict E.164, so a `+`-less number the door
    // accepted could never receive a code — it was minted and then withdrawn on every attempt. Normalise
    // ONCE, through the project's single normaliser (_shared/phone.js — the file that exists precisely
    // because this rule had three private copies and they disagreed), so the account lookup, the vault row,
    // its verify-side twin, the carrier address and both ledgers all use the same string. It also accepts what
    // the previous regex refused: the seeded `+91 9720000243` (a space, typed the way an office types it).
    const phone = toE164(rawPhone);
    if (!phone) return reply.code(400).send({ error: 'valid phone required (+countrycode)' });
    // AUTH-8: durable per-phone throttle (10/24h, plus a 60s cooldown on real sends). Checked before the
    // account lookup so it is uniform for registered and unregistered numbers — no enumeration signal.
    const otpGate = await otpRequestAllowed(phone);
    if (!otpGate.allowed) return reply.code(429).send({ error: 'Too many sign-in codes requested for this number. Try again later.', retryAfter: otpGate.retryAfter });
    const scope = typeof tenantId === 'string' && UUID_RE.test(tenantId) ? tenantId : null;
    const u = await sysq(
      `SELECT users.id, users.tenant_id, users.name, users.role, users.phone, users.session_epoch, t.name AS tenant_name FROM app.users JOIN app.tenants t ON t.id = users.tenant_id WHERE users.phone=$1 AND users.active ${scope ? 'AND tenant_id=$2' : ''} ORDER BY users.created_at`,
      scope ? [phone, scope] : [phone]);
    // Uniform response shape — phone enumeration must not distinguish
    // registered from unregistered numbers (a multi-tenant 409 mirrors the
    // password-login contract; see T103 comment above).
    if (!scope && u.rows.length > 1) return multiTenantReply(reply, u.rows);
    const user = u.rows[0] ?? null;
    /* B2 (independent review of the OPS-5 fix): the channel gate used to be asked only AFTER a phone had
     * been matched to an account, so a school with no SMS channel answered 503 for a registered number and
     * 200 for a stranger's — a registration oracle built out of the honest refusal. When the caller names a
     * tenant, the channel question is a property of THAT TENANT and can be answered before the lookup, so
     * the refusal is now identical for every number. (Unscoped requests cannot do this: there is no tenant
     * to ask about until a phone matches one. That residual is the same documented tradeoff as the reset
     * door — see §8 — not something this door can close alone.)
     * The body also keeps a CONSTANT KEY SET (channel/provider/sandbox present and null when nothing was
     * sent) so its shape is not a second oracle. */
    const railEnabled = async (tenant) => capabilityEnabled(sysq, tenant, 'auth.otp');
    const echo = !!config.otp.devEcho;
    /* ONE body shape for every outcome, refusals included. The review proved the first version of this was
     * wrong: the refusals returned `{error}` alone, so "the key set is constant" was false — the shipped test
     * caught it in the CI posture (`NODE_ENV=test OTP_DEV_ECHO=`), where the refusing branch actually runs.
     * A refusal is `sent:false` with the same keys and nulls, which also means no client has to branch on the
     * shape to find out whether a code is on its way. */
    const ttlSeconds = Math.round(config.otp.ttlMs / 1000);
    const refuse = (msg) => ({
      sent: false, expiresInSeconds: ttlSeconds, devEcho: false,
      channel: null, provider: null, sandbox: null, devCode: undefined, error: msg,
    });
    const NO_CHANNEL = 'This school has no SMS channel switched on yet, so a sign-in code cannot reach you — ask the school office for a code, or sign in with your email and password.';
    const scopedChannelOff = scope ? !(await railEnabled(scope)) : false;
    if (!user && scopedChannelOff && !echo) {
      req.log.warn({ tenant: scope, msg: 'OTP refused — no SMS channel for this school' });
      return reply.code(503).send(refuse(NO_CHANNEL));
    }
    const body = { sent: true, expiresInSeconds: ttlSeconds, devEcho: false, channel: null, provider: null, sandbox: null };
    if (user) {
      // OPS-5 (PERFECT-100 §5): this door answered `{sent:true}` and minted a code while sending NOTHING
      // anywhere — the code left the process only through a log line or the opt-in dev echo, so an entire
      // auth channel was success-shaped. Two changes: the answer now describes what actually happened, and
      // the CHANNEL GATE runs BEFORE anything is minted — the ops.visitors lesson, where a refusal placed
      // after the vault write committed a one-time credential for a message that was never sent.
      const hasRail = await railEnabled(user.tenant_id);
      // The dev echo IS a delivery when it is armed: the code reaches the caller in this response rather
      // than a log file, and the response says so (`channel:'dev-echo'`, `sandbox:true`). It is opt-in via
      // OTP_DEV_ECHO and refuses to arm in production (config.otp.devEcho), so it can never be the reason a
      // real school believes a code was sent.
      if (!hasRail && !echo) {
        req.log.warn({ phone: phone.slice(-4), tenant: user.tenant_id, msg: 'OTP refused — no SMS channel for this school' });
        return reply.code(503).send(refuse(NO_CHANNEL));
      }
      const { sendSms } = await import('./plugins/rails.sms/index.js');
      const code = String(randomInt(100000, 1000000)); // CSPRNG — Math.random is not a secret source (ops.visitors precedent)
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(code, salt, 64).toString('hex');
      const codeHash = `${salt}:${hash}`;
      // kernel path: the OTP vault denies the app role entirely (RLS policy) —
      // only the owner connection may write verification secrets. The row is
      // bound to the issuing tenant (auth_otps.tenant_id) — T103.
      await sysq(`INSERT INTO app.auth_otps (tenant_id, phone, code_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4))`,
        [user.tenant_id, phone, codeHash, config.otp.ttlMs / 1000]);
      req.log.warn({ phone: phone.slice(-4), tenant: user.tenant_id, msg: 'OTP issued' });
      // DAT-6: the vault lifecycle was entirely unlogged — a credential was minted for an account and
      // nothing in the ledger said so. The CODE is never recorded (the ledger is readable by several
      // staff roles, and a recorded one-time code is a usable credential); only the fact and the last
      // four digits, matching the log line above.
      // Non-atomicity, stated rather than implied: the vault write runs on the owner path because the
      // app role is denied that table outright, so it cannot share this transaction. A crash between
      // them leaves an issued code unrecorded. The failure direction is deliberate — the audit write
      // is NOT swallowed, so a broken ledger fails the request loudly instead of issuing credentials
      // silently.
      const auditOtp = (outcome) => withUser(user.tenant_id, 'system', (c) => auditLog(c, user.tenant_id, {
        actor: user.name, actorRole: 'system', action: 'Phone OTP issued', recordType: 'Auth',
        recordRef: `phone ····${phone.slice(-4)}`, policyRef: 'Platform §2.4 (identity & access)', risk: 'medium',
        outcome: `${outcome} (code deliberately not recorded)`,
      }));
      let channel = 'dev-echo'; let provider = 'dev-echo'; let sandbox = true;
      if (hasRail) {
        const smsBody = `Your SchoolOS sign-in code is ${code}. It is valid for ${Math.round(config.otp.ttlMs / 60000)} minutes. If you did not ask for it, tell your school office.`;
        const r = await sendSms({
          to: phone,
          body: smsBody,
          dedupKey: `otp:${user.id}:${hash.slice(0, 8)}`,
          tenantId: user.tenant_id,
        });
        const sandboxed = isSandboxResult(r);
        // A sandbox carrier in production is not a delivery (comms honesty rule) — and neither is a refusal.
        const why = !r.ok ? (r.error ?? 'provider error') : `sandbox carrier "${r.provider}" in production — the code reached nobody`;
        if (!r.ok || (sandboxed && !sandboxAllowed(config.env))) {
          // NOTHING reached the phone, so the minted row is withdrawn: leaving a live credential for a
          // message that does not exist is exactly the dangling state the ops.visitors fix removed.
          await sysq(`DELETE FROM app.auth_otps WHERE tenant_id=$1 AND phone=$2 AND code_hash=$3 AND consumed_at IS NULL`,
            [user.tenant_id, phone, codeHash]);
          await auditOtp(`a one-time code was minted and then WITHDRAWN, not delivered: ${why}`);
          return reply.code(r.ok ? 503 : 502).send({ error: `A sign-in code could not be sent (${why}) — nothing was sent. Ask the school office for a code.` });
        }
        channel = 'sms'; provider = String(r.provider ?? 'unknown'); sandbox = sandboxed;
        // B6 (independent review): the SMS went out with NO row in app.communications, while the reset door
        // — the sibling this door was modelled on — writes one. That left an auth-channel send with no
        // receipt, no retry record and nothing a data-subject request could find. The body is REDACTED the
        // same way the reset door redacts its token: the ledger is readable by several staff roles, and a
        // recorded one-time code is a usable credential (SEC-0).
        // The review measured the first version of this: `code.slice(0, 2)` left the first two of six digits in
        // a staff-readable table, which is a 10^4 search space for a credential that is live for minutes. The
        // ledger records THAT a code was sent, never any part of it.
        const redacted = String(smsBody).replace(code, '(one-time code redacted — delivered by SMS)');
        await withUser(user.tenant_id, 'system', (c) => c.query(
          `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key, last_error, provider, sent_at, delivered_at)
           VALUES ($1,'phone',$2::jsonb,'sms','OTP_SIGNIN',$3,'sent',$4,NULL,$5,now(),$6)`,
          [user.tenant_id, JSON.stringify([phone]), redacted, `otp:${user.id}:${hash.slice(0, 8)}`,
            String(r.provider ?? 'unknown'), sandboxed ? null : new Date()]));
      } else {
        body.devCode = code; // dev-only echo, opt-in via OTP_DEV_ECHO — the delivery in this branch
      }
      body.channel = channel;
      body.provider = provider;
      body.sandbox = sandbox;
      // B7: `devEcho` used to report the CONFIG flag, so a body could say devEcho:true while the code was
      // carried by a rail and never echoed. It now reports whether the echo was the channel that was used.
      body.devEcho = echo && !hasRail;
      await auditOtp(`a one-time code was issued to the account holder's phone for the phone sign-in factor, delivered via ${channel}${sandbox ? ' (sandbox)' : ''}`);
    }
    return body;
  });

  app.post('/auth/otp/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { phone: rawPhone, code, tenantId } = req.body ?? {};
    if (!code) return reply.code(400).send({ error: 'phone and code required' });
    // the same normaliser as the request door (S1): the vault row is keyed by E.164 there, so a second
    // implementation here would be a door that cannot open what the other one locked
    const phone = toE164(rawPhone);
    if (!phone) return reply.code(400).send({ error: 'phone and code required' });
    const scope = typeof tenantId === 'string' && UUID_RE.test(tenantId) ? tenantId : null;
    const u = await sysq(
      `SELECT users.id, users.tenant_id, users.name, users.role, users.phone, users.session_epoch, users.force_change, (m.enabled = true) AS mfa_enabled, t.name AS tenant_name FROM app.users LEFT JOIN auth.mfa_secrets m ON m.user_id = users.id JOIN app.tenants t ON t.id = users.tenant_id WHERE users.phone=$1 AND users.active ${scope ? 'AND users.tenant_id=$2' : ''} ORDER BY users.created_at`,
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
    const otp = user ? await sysq(
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
      const attempted = await sysq(
        `UPDATE app.auth_otps SET attempts = attempts + 1
         WHERE id=$1 AND consumed_at IS NULL AND attempts < $2 RETURNING attempts`,
        [row.id, config.otp.maxAttempts]);
      if (!attempted.rows[0]) return deny();
      // DAT-6: a rejected vault attempt is a failed authentication, and it left no trace. Bounded by
      // design — this branch is unreachable once attempts >= maxAttempts (the check above returns
      // early), so a flood cannot grow the ledger without bound.
      await withUser(user.tenant_id, 'system', (c) => auditLog(c, user.tenant_id, {
        actor: user.name, actorRole: 'system', action: 'Phone OTP rejected', recordType: 'Auth',
        recordRef: `phone ····${phone.slice(-4)}`, policyRef: 'Platform §2.4 (identity & access)', risk: 'medium',
        outcome: `code did not match (attempt ${attempted.rows[0].attempts} of ${config.otp.maxAttempts}); the response is byte-identical to every other failure so the caller learns nothing`,
      }));
      return deny(); // same copy as every other failure — no oracle at all
    }
    const consumed = await sysq(`UPDATE app.auth_otps SET consumed_at = now() WHERE id=$1 AND consumed_at IS NULL RETURNING id`, [row.id]);
    if (!consumed.rows[0]) return deny();
    // DAT-6: a session issued on the phone factor is a login event, and it was absent from the ledger
    // while password logins were not — so the alternative factor was the one an investigator could not
    // see. Recorded BEFORE issueSession so a session that exists in the wild always has its evidence.
    const mfaPending = !!user.mfa_enabled;
    await withUser(user.tenant_id, 'system', (c) => auditLog(c, user.tenant_id, {
      actor: user.name, actorRole: 'system', action: 'Phone OTP accepted', recordType: 'Auth',
      recordRef: `phone ····${phone.slice(-4)}`, policyRef: 'Platform §2.4 (identity & access)', risk: 'high',
      outcome: mfaPending
        ? 'the one-time code matched and was consumed; the second factor is still required'
        : 'the one-time code matched and was consumed; a session was issued on the phone factor',
    }));
    // AUTH-3: a phone code is a weaker factor than the enrollee's TOTP — it must
    // not downgrade the account. Challenge before a session is issued.
    if (mfaPending) return mfaChallenge(user, reply, 'one-time code verified');
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
    await sysq(`INSERT INTO app.oauth_states (state, created_at) VALUES ($1, now()) ON CONFLICT (state) DO NOTHING`, [state]);
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
    const st = await sysq(`DELETE FROM app.oauth_states WHERE state=$1 AND created_at > now() - interval '10 minutes' RETURNING state`, [String(state)]);
    if (!st.rows[0]) return reply.code(401).send({ error: 'expired login attempt — start again' });
    try {
      // API-4: unlike every other outbound call in the tree, these had NO timeout — a hung Google response
      // pinned a pool connection with no bound. AbortSignal.timeout makes the fetch fail like any other error.
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: config.google.redirectUri, grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!tokenRes.ok) return reply.code(401).send({ error: 'google token exchange failed' });
      const { access_token } = await tokenRes.json();
      const profRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(8000) });
      if (!profRes.ok) return reply.code(401).send({ error: 'google profile fetch failed' });
      const profile = await profRes.json();
      const email = (profile.email ?? '').toLowerCase();
      if (!email || profile.email_verified === false) return reply.code(401).send({ error: 'google email not verified' });
      // T103 (P0-3): never rows[0] on a multi-tenant email — same 409 contract as
      // password login; X-Tenant-Hint lists the opaque tenant ids.
      const u = await sysq(`SELECT users.id, users.tenant_id, users.name, users.role, users.email, users.session_epoch, users.force_change, users.auth_provider, (m.enabled = true) AS mfa_enabled, t.name AS tenant_name FROM app.users LEFT JOIN auth.mfa_secrets m ON m.user_id = users.id JOIN app.tenants t ON t.id = users.tenant_id WHERE lower(users.email)=lower($1) AND users.active ORDER BY users.created_at`, [email]);
      if (u.rows.length > 1) return multiTenantReply(reply, u.rows);
      if (!u.rows[0]) return reply.code(403).send({ error: `no SchoolOS account for ${email} — contact your school admin` });
      // DAT-6: this silently re-points HOW an account authenticates — the highest-consequence change
      // an identity system can make — and it left no ledger row at all.
      //
      // Audited on the TRANSITION only, deliberately. The UPDATE is idempotent and this route runs on
      // every Google sign-in, so logging it unconditionally would bury a genuine provider switch under
      // one row per login and make the risk:'high' flag meaningless. The event worth recording is the
      // moment the account's factor changed, which is what an investigator looks for afterwards.
      const prevProvider = u.rows[0].auth_provider ?? null;
      if (prevProvider !== 'google') {
        await sysq(`UPDATE app.users SET auth_provider='google' WHERE id=$1`, [u.rows[0].id]);
        await withUser(u.rows[0].tenant_id, 'system', (c) => auditLog(c, u.rows[0].tenant_id, {
          actor: u.rows[0].name, actorRole: 'system', action: 'SSO identity linked', recordType: 'User',
          recordRef: email, policyRef: 'Platform §2.4 (identity & access)', risk: 'high',
          outcome: `how this account signs in changed from "${prevProvider ?? 'none recorded'}" to "google" after a Google-verified sign-in for ${email}`,
        }));
      }
      // AUTH-3: Google must not downgrade an MFA-enrolled staff account.
      if (u.rows[0].mfa_enabled) return mfaChallenge(u.rows[0], reply, 'google sign-in verified');
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
    const u = await sysq(`SELECT users.id, users.tenant_id, users.name, users.role, users.email, users.session_epoch, users.force_change, (m.enabled = true) AS mfa_enabled, t.name AS tenant_name FROM app.users LEFT JOIN auth.mfa_secrets m ON m.user_id = users.id JOIN app.tenants t ON t.id = users.tenant_id WHERE lower(users.email)=lower($1) AND users.active ORDER BY users.created_at`, [email]);
    if (u.rows.length > 1) return multiTenantReply(reply, u.rows);
    if (!u.rows[0]) return reply.code(403).send({ error: `no SchoolOS account for ${email}` });
    // AUTH-3: the dev simulator models the SSO path — same second-factor rule.
    if (u.rows[0].mfa_enabled) return mfaChallenge(u.rows[0], reply, 'dev SSO verified');
    return issueSession(u.rows[0], 'google-sso (dev simulator)', reply);
  });

  // --- logout (audited) ---
  // Shared-computer guarantee (StudentOS §78/§79): ending a session wipes the
  // browser's cached content and storage — the next student on this machine can
  // never reopen the previous student's data. Personal-data planes are no-store.
  app.addHook('onSend', async (req, reply) => {
    const path = (req.raw?.url || '').split('?')[0];
    // OPS-16: expose Fastify's stable per-request identifier so clients can
    // correlate a response with server logs and support investigations.
    reply.header('x-request-id', String(req.id));
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
  // OPS-9: expose a bounded latency histogram rather than only a request count;
  // this makes the documented p95 target measurable without unbounded route labels.
  app.addHook('onRequest', async (req) => { req.schoolosStartedAt = process.hrtime.bigint(); });
  app.addHook('onResponse', async (req) => {
    if (!req.schoolosStartedAt) return;
    const ms = Number(process.hrtime.bigint() - req.schoolosStartedAt) / 1e6;
    metrics.latencyTotalMs += ms;
    metrics.latencyCount += 1; // OPSX-13: count lives with the buckets, never with requestsTotal
    for (const bound of metrics.latencyBuckets.keys()) {
      if (ms <= bound) metrics.latencyBuckets.set(bound, metrics.latencyBuckets.get(bound) + 1);
    }
  });
  app.post('/auth/logout', { preHandler: app.authenticate }, async (req, reply) => {
    reply.header('Clear-Site-Data', '"cache", "storage"');
    clearSessionCookies(reply); // L2-3.1: the browser's cookies die with the session
    // A3: actually end the session — the jti is dead the moment this returns.
    if (req.auth?.jti) {
      const exp = req.auth.exp ? new Date(req.auth.exp * 1000) : new Date(Date.now() + 13 * 3600 * 1000);
      await sysq(`INSERT INTO auth.revoked_token (jti, tenant_id, exp) VALUES ($1,$2,$3)
               ON CONFLICT (jti) DO NOTHING`, [req.auth.jti, req.user.tenant_id, exp]);
      await sysq(`DELETE FROM auth.revoked_token WHERE exp < now()`); // opportunistic cleanup
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
    const rows = await sysq(
      `SELECT u.tenant_id, u.role, t.name AS tenant_name
       FROM app.users u JOIN app.tenants t ON t.id = u.tenant_id
       WHERE lower(u.email)=lower($1) AND u.active ORDER BY t.name`, [req.user.email]);
    return { tenants: rows.rows.map((r) => ({ tenantId: r.tenant_id, name: r.tenant_name, role: r.role })) };
  });

  app.post('/me/switch', { preHandler: app.authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { tenantId } = req.body ?? {};
    if (!tenantId || !UUID_RE.test(String(tenantId))) return reply.code(400).send({ error: 'valid tenantId required' });
    if (!req.user.email) return reply.code(403).send({ error: 'API keys cannot switch schools.' });
    /* S0 fix A4 framed this as "the caller's own password"; AUTH-1 showed why that
       is the wrong factor. The session being issued belongs to the TARGET
       account, and email is an unverified identity key — a self-signup can plant
       any email. Verifying the CALLER's password therefore let an attacker who
       shares the victim's email plant an account, prove their own password, and
       receive a session for the victim's row (including `owner`). The proof MUST
       be the target row's own factor. */
    const target = await sysq(
      `SELECT u.id, u.tenant_id, u.name, u.role, u.email, u.pg_role, u.session_epoch, u.force_change, u.password_hash,
              (m.enabled = true) AS mfa_enabled, t.name AS tenant_name
       FROM app.users u
       LEFT JOIN auth.mfa_secrets m ON m.user_id = u.id
       JOIN app.tenants t ON t.id = u.tenant_id
       WHERE lower(u.email)=lower($1) AND u.tenant_id=$2 AND u.active`, [req.user.email, tenantId]);
    if (!target.rows[0]) return reply.code(403).send({ error: 'No active account for you in that school.' });
    const user = target.rows[0];
    // The proof is the target row's own password. A target with no usable hash
    // (none exists today — app.users.password_hash is NOT NULL) simply fails the
    // check below and is never entered; there is no caller-supplied fact that
    // could stand in for it.
    const { currentPassword } = req.body ?? {};
    if (!currentPassword || !verifyPassword(String(currentPassword), user.password_hash)) {
      return reply.code(403).send({ error: 'Enter the password for that school to switch.', passwordRequired: true });
    }
    // AUTH-3: an MFA-enrolled target must present its second factor before a
    // session is issued for it, exactly as at login.
    if (user.mfa_enabled) return mfaChallenge(user, reply, 'school-switch password verified');
    const mustChange = !!user.force_change;
    const token = app.jwt.sign({ sub: user.id, role: user.role, tenant: user.tenant_id, name: user.name, jti: randomUUID(), ep: user.session_epoch ?? 1, ...(mustChange ? { mustChange: true } : {}) },
      user.role === 'student' ? { expiresIn: config.studentSessionTtl } : {});
    // AUTH-9: retire the token being replaced. `/auth/renew` already denylists its old jti; the switch
    // issued a fresh session while the previous one stayed valid until natural expiry — the same
    // forgotten-revocation gap, on the door that crosses tenants.
    if (req.auth?.jti) {
      const oldExp = req.auth.exp ? new Date(req.auth.exp * 1000) : new Date(Date.now() + 13 * 3600 * 1000);
      await sysq(`INSERT INTO auth.revoked_token (jti, tenant_id, exp) VALUES ($1,$2,$3)
               ON CONFLICT (jti) DO NOTHING`, [req.auth.jti, req.user.tenant_id, oldExp]);
    }
    await withUser(user.tenant_id, user.role, (c) =>
      auditLog(c, user.tenant_id, { actor: user.name, actorRole: user.role, action: 'Switched school', recordType: 'Auth', recordRef: user.email, policyRef: 'Platform §2.4 (identity & access)', outcome: `session re-issued against ${user.tenant_name}${mustChange ? ' (force_change pending — restricted)' : ''}${req.auth?.jti ? ' · previous session retired' : ''}` }));
    issueSessionCookies(reply, token);
    return { ok: true, token, mustChange, tenant: { tenantId: user.tenant_id, name: user.tenant_name }, user: { id: user.id, name: user.name, role: user.role, email: user.email, tenantId: user.tenant_id } };
  });

  // --- L2-2.1: password change (self-service; force_change exit) ---------------
  app.post('/me/password', { preHandler: app.authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) return reply.code(400).send({ error: 'current and new password are required' });
    if (typeof newPassword !== 'string' || newPassword.length < 8) return reply.code(400).send({ error: 'New password must be at least 8 characters' });
    if (newPassword === currentPassword) return reply.code(400).send({ error: 'The new password must be different from the current one' });
    const u = await sysq(`SELECT id, tenant_id, name, role, email, password_hash, session_epoch FROM app.users WHERE id=$1 AND active`, [req.user.id]);
    if (!u.rows[0]) return reply.code(401).send({ error: 'account disabled' });
    if (!verifyPassword(currentPassword, u.rows[0].password_hash)) return reply.code(401).send({ error: 'The current password is not right' });
    // epoch bump revokes every OTHER session; this caller is re-issued below.
    const epoch = Number(u.rows[0].session_epoch ?? 1) + 1;
    // Credential state and its audit evidence commit together.  A crash between
    // the old UPDATE and audit write used to create an unaudited password change.
    await withUser(u.rows[0].tenant_id, u.rows[0].role, async (c) => {
      await c.query(`UPDATE app.users SET password_hash=$1, session_epoch=$2, force_change=false WHERE id=$3`,
        [hashPassword(newPassword), epoch, u.rows[0].id]);
      await auditLog(c, u.rows[0].tenant_id, { actor: u.rows[0].name, actorRole: u.rows[0].role, action: 'Password changed', recordType: 'Auth', recordRef: u.rows[0].email, policyRef: 'Platform §2.4 (identity & access)', outcome: `password set by the account owner · session_epoch → ${epoch} (older sessions revoked)` });
    });
    const token = app.jwt.sign({ sub: u.rows[0].id, role: u.rows[0].role, tenant: u.rows[0].tenant_id, name: u.rows[0].name, jti: randomUUID(), ep: epoch },
      u.rows[0].role === 'student' ? { expiresIn: config.studentSessionTtl } : {});
    issueSessionCookies(reply, token);
    return { ok: true, token, mustChange: false, user: { id: u.rows[0].id, name: u.rows[0].name, role: u.rows[0].role, email: u.rows[0].email, tenantId: u.rows[0].tenant_id } };
  });

  // --- L2-2.2: self-service password reset (email rail, sandbox-verified) -----
  {
    const { bindKernel: bindEmailKernel, sendEmail } = await import('./plugins/rails.email/index.js');
    bindEmailKernel(sysq);
    const sha256 = (s) => createHash('sha256').update(s).digest('hex');
    const TTL_MS = config.auth?.resetTtlMs ?? 30 * 60 * 1000;

    app.post('/me/reset-request', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { email, tenantId } = req.body ?? {};
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return reply.code(400).send({ error: 'valid email required' });
      const scope = typeof tenantId === 'string' && UUID_RE.test(tenantId) ? tenantId : null;
      // T103 contract parity: identity resolution is tenant-bound; several rows
      // must never let the kernel pick silently. Anti-enumeration posture: an
      // unknown email answers the SAME 200 "sent" copy as a known one.
      const u = await sysq(
        `SELECT id, tenant_id, email FROM app.users WHERE lower(email)=lower($1) AND active ${scope ? 'AND tenant_id=$2' : ''} ORDER BY users.created_at`,
        scope ? [email, scope] : [email]);
      if (u.rows.length === 0) {
        // AUTH-9 timing equalisation: run the same token INSERT the known path performs, for a throwaway
        // identity, so an unknown email is not answered visibly faster. The row is inert (no account,
        // random hash) and retention sweeps it after its 1-minute expiry. The email-send latency is the
        // documented residual — it cannot be equalised without sending a message.
        await sysq(`INSERT INTO auth.reset_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + interval '1 minute')`,
          [scope ?? randomUUID(), randomUUID(), sha256(randomBytes(32).toString('hex'))]).catch(() => {});
        return { sent: true };
      }
      if (u.rows.length > 1) return multiTenantReply(reply, u.rows);
      const user = u.rows[0];
      // Channel gate (comms honesty rule): no email rail configured for the
      // school → 503, never a fake "sent". (Existence tradeoff: the alternative
      // — uniform 200 — would silently strand the user; the login door already
      // answers 409 multiTenant for this identity, so this does not widen the
      // enumeration surface materially.)
      // PRD-4: the row must also be ENABLED. The tenant registry now ships a rails.email row for every
      // school (migration 078 + plugin-catalog), so "a row exists" became true even for a school that never
      // configured the channel — which would have turned this gate into a no-op the moment the rows landed.
      // Switching the rail on is the owner's audited act of configuring a credential, and it is what the
      // plugin manager shows them.
      if (!await capabilityEnabled(sysq, user.tenant_id, 'auth.password_reset')) {
        return reply.code(503).send({ error: 'This school has no email channel switched on yet — ask the school office to reset your password in person (it is one switch under Plugins).' });
      }
      // one open token per account: a fresh request invalidates the previous one
      await sysq(`DELETE FROM auth.reset_tokens WHERE user_id=$1 AND consumed_at IS NULL`, [user.id]);
      const raw = randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + TTL_MS);
      const rt = await sysq(
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
      // SEC-0 (PERFECT-100 §5.1): the raw code is stripped on EVERY path.
      // This was `r.sandbox ? body : body.replace(...)`, which persisted a live,
      // single-use owner credential into app.communications — a table that
      // GET /communications serves with SELECT * to owner/principal/coordinator/
      // finance/itadmin/transport. `sandbox` is the permanent default for any
      // tenant without SMTP credentials (the logger provider returns sandbox:true,
      // including on failure), so this was never a developer-only state. The
      // ledger is delivery EVIDENCE, never a delivery CHANNEL.
      const ledgerBody = body.replace(raw, `${raw.slice(0, 6)}…(redacted — delivered by email)`);
      // Local-development affordance that replaces the ledger as the dev
      // artifact. Arms only in development behind an explicit opt-in flag, so a
      // production box cannot leak the code this way either.
      if (config.devResetTokenLog) {
        console.warn(`[dev-only] password-reset code for ${user.email}: ${raw} — armed by RESET_TOKEN_DEV_LOG`);
      }
      // PRD-13 · the reset door sends DIRECTLY (it needs the raw code in the message, which must never
      // reach the ledger — SEC-0), so it writes its own row and bypasses the dispatcher's honesty gate.
      // That made it the strongest instance of the same lie: `delivered_at=now()` was stamped
      // UNCONDITIONALLY, and `delivered` is a stronger claim than `sent` — the schema keeps them apart,
      // the dispatcher only ever sets `sent_at`, and the whatsapp inbox renders delivered_at to users.
      // A logger-provider send (the default for every tenant with no SMTP credentials) recorded a
      // carrier receipt for a message that was written to stdout and nowhere else.
      // Now: sent_at still means "handed to the named provider" (sandbox included), delivered_at means
      // "a carrier confirmed it", and in production a sandbox carrier is not a delivery at all.
      const sandboxed = isSandboxResult(r);
      const sandboxBlocked = sandboxed && !sandboxAllowed(config.env);
      const rowStatus = !r.ok || sandboxBlocked ? 'failed' : 'sent';
      const why = sandboxBlocked
        ? `undeliverable — sandbox carrier "${r.provider}" in production: the code reached nobody`
        : (r.error ?? null);
      await sysq(
        `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key, last_error, provider, sent_at, delivered_at)
         VALUES ($1,'email',$2::jsonb,'email','PASSWORD_RESET',$3,$4,$5,$6,$7,$8,$9)`,
        [user.tenant_id, JSON.stringify([user.email]), ledgerBody,
          rowStatus,
          r.ok ? dedupKey : `${dedupKey}:failed`,
          why,
          String(r.provider ?? 'unknown'),
          r.ok && !sandboxBlocked ? new Date() : null,
          // only a REAL carrier can confirm delivery; a sandbox one never does
          r.ok && !sandboxed ? new Date() : null]);
      if (sandboxBlocked) {
        return reply.code(503).send({ error: 'This school has no email provider configured, so a reset code cannot reach you — ask the school office to reset your password in person.' });
      }
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
      const rt = await sysq(
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
      const consumed = await sysq(`UPDATE auth.reset_tokens SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL RETURNING id`, [row.id]);
      if (!consumed.rows[0]) return reply.code(400).send({ error: INVALID });
      const epoch = await sysq(
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
    const { generateSecret, verifyTotpStep, otpauthUri } = await import('./totp.js');
    const sha256 = (s) => createHash('sha256').update(s).digest('hex');
    const MFA_COPY = 'Enter the 6-digit code from your authenticator app (or a recovery code).';

    app.post('/me/mfa/enroll', { preHandler: app.authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (['parent', 'student'].includes(req.user.role)) return reply.code(403).send({ error: 'MFA enrollment is available to staff accounts only.' });
      // AUTH-7: minting a factor from the session alone meant a stolen session could bind the
      // ATTACKER's authenticator and lock the real owner out of every future sign-in. Require the
      // account password, exactly as /me/mfa/disable already does.
      const { password } = req.body ?? {};
      const acct = await sysq(`SELECT password_hash FROM app.users WHERE id=$1 AND active`, [req.user.id]);
      if (!password || !verifyPassword(String(password), acct.rows[0]?.password_hash)) {
        return reply.code(401).send({ error: 'Enter your current password to set up two-step verification.' });
      }
      // D-37(d): re-enrollment while the factor is live would silently rotate
      // secrets — turning two-step OFF has its own re-authenticated door.
      const existing = await sysq(`SELECT enabled FROM auth.mfa_secrets WHERE user_id=$1`, [req.user.id]);
      if (existing.rows[0]?.enabled || req.user.mfa_enrolled_at) {
        return reply.code(409).send({ error: 'Two-step verification is already on for this account. Turn it off (with your password) before enrolling again.' });
      }
      const secret = generateSecret();
      await sysq(
        `INSERT INTO auth.mfa_secrets (user_id, tenant_id, secret, enabled) VALUES ($1,$2,$3,false)
         ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, enabled = false`, [req.user.id, req.user.tenant_id, secret]);
      // DAT-6: this was the ONLY MFA state transition with no ledger row — disable, enable and
      // recovery-code consumption were all audited, while the one that MINTS AND REVEALS a fresh TOTP
      // secret was not. A factor issued invisibly is precisely the "silent rotation" a security
      // ledger exists to catch. The secret itself is NEVER recorded: GET /audit is readable by
      // principal/itadmin/finance, so writing it here would convert evidence into a credential.
      await withUser(req.user.tenant_id, req.user.role, (c) =>
        auditLog(c, req.user.tenant_id, {
          actor: req.user.name, actorRole: req.user.role, action: 'MFA enrolment started', recordType: 'Auth',
          recordRef: req.user.email, policyRef: 'Platform §2.4 (identity & access)', risk: 'high',
          outcome: 'a new TOTP secret was issued and returned to the account holder; the factor stays INACTIVE until a code is verified (secret deliberately not recorded)',
        }));
      return { secret, otpauth: otpauthUri({ secret, account: req.user.email }) };
    });

    // D-37(d): turning two-step OFF requires password re-auth (a stolen
    // session — or a challenge token — must never be able to disarm MFA).
    app.post('/me/mfa/disable', { preHandler: app.authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (!req.user.email) return reply.code(403).send({ error: 'API keys have no MFA to disable.' });
      const { password } = req.body ?? {};
      if (!password) return reply.code(400).send({ error: 'your password is required to turn off two-step verification' });
      const u = await sysq(`SELECT password_hash FROM app.users WHERE id=$1 AND active`, [req.user.id]);
      if (!u.rows[0] || !verifyPassword(password, u.rows[0].password_hash)) return reply.code(401).send({ error: 'that password didn’t match — two-step stays on' });
      // Factor removal and the high-risk audit row are one transaction.  The
      // previous three owner queries could leave MFA disabled with no ledger row.
      //
      // `tx` (the named owner path), NOT `withUser`: the constrained app role has no DELETE on
      // `auth.mfa_secrets`/`auth.mfa_recovery_codes` (D-35 / migration 057 make the vault kernel-only —
      // that is the security property, not an oversight), so the `withUser` form 500'd with
      // `permission denied for table mfa_secrets` on every disable. The queries are keyed by the caller's
      // own `user_id`, so the tenant GUC adds nothing here; the audit row rides the same transaction.
      await tx(async (c) => {
        await c.query(`DELETE FROM auth.mfa_secrets WHERE user_id=$1`, [req.user.id]);
        await c.query(`DELETE FROM auth.mfa_recovery_codes WHERE user_id=$1`, [req.user.id]);
        await c.query(`UPDATE app.users SET mfa_enrolled_at=NULL WHERE id=$1`, [req.user.id]);
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'MFA disabled', recordType: 'Auth', recordRef: req.user.email, policyRef: 'Platform §2.4 (identity & access)', outcome: 'two-step verification turned off after password re-authentication — factor, recovery codes and enrollment state removed' });
      });
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
      // AUTH-9: cumulative MFA-failure lockout, checked before any guess is evaluated.
      const mfaLock = await requestThrottleLocked('mfa', userId);
      if (mfaLock) return reply.code(429).send({ error: 'Too many verification attempts. Try again later.', retryAfter: mfaLock });
      // A challenge token is bearer material. Count every verification attempt
      // atomically before checking the code so a caller cannot race two requests
      // past the five-guess ceiling.
      if (challenger) {
        const attempt = await sysq(
          `UPDATE auth.mfa_challenges SET attempts=attempts+1
           WHERE jti=$1 AND user_id=$2 AND consumed_at IS NULL
             AND expires_at > now() AND attempts < 5
           RETURNING attempts`, [challenger.jti, userId]);
        if (!attempt.rows[0]) { await bumpMfaThrottle(userId); return reply.code(401).send({ error: MFA_COPY }); }
      }
      const m = await sysq(`SELECT secret, enabled FROM auth.mfa_secrets WHERE user_id=$1`, [userId]);
      if (!m.rows[0]?.secret) return reply.code(400).send({ error: 'No MFA enrollment in progress — enroll first.' });

      // TOTP first; recovery code second (single-use, sha256-stored).
      let usedRecovery = false;
      const totpStep = verifyTotpStep(m.rows[0].secret, code);
      if (totpStep === null) {
        // API-3 (PERFECT-100 §5.5): single-use must be enforced by ONE atomic statement, not a
        // SELECT-then-UPDATE. The old shape read `consumed_at IS NULL`, then ran an UPDATE whose result it
        // discarded and set `usedRecovery = true` unconditionally — so two requests with the same code both
        // passed the read and BOTH were issued a session. The guarded `UPDATE … RETURNING` consumes exactly
        // one row; the loser gets zero rows and is refused with the uniform copy.
        const rc = await sysq(
          `UPDATE auth.mfa_recovery_codes SET consumed_at=now()
            WHERE user_id=$1 AND code_hash=$2 AND consumed_at IS NULL RETURNING id`,
          [userId, recoveryHash(code)]);
        if (!rc.rows[0]) { await bumpMfaThrottle(userId); return reply.code(401).send({ error: MFA_COPY }); }
        usedRecovery = true;
      } else {
        const accepted = await sysq(
          `UPDATE auth.mfa_secrets SET last_totp_step=$2
           WHERE user_id=$1 AND (last_totp_step IS NULL OR last_totp_step < $2)
           RETURNING user_id`, [userId, totpStep]);
        if (!accepted.rows[0]) { await bumpMfaThrottle(userId); return reply.code(401).send({ error: MFA_COPY }); }
      }

      if (challenger) {
        const consumedChallenge = await sysq(
          `UPDATE auth.mfa_challenges SET consumed_at=now()
           WHERE jti=$1 AND user_id=$2 AND consumed_at IS NULL RETURNING jti`,
          [challenger.jti, userId]);
        if (!consumedChallenge.rows[0]) { await bumpMfaThrottle(userId); return reply.code(401).send({ error: MFA_COPY }); }
      }
      // A verified factor clears the cumulative failure counter.
      await clearRequestThrottle('mfa', userId);

      if (!m.rows[0].enabled) {
        // confirmation of an in-progress enrollment: enable + mint recovery codes.
        // API-3: mint, enable and stamp enrollment in ONE owner transaction. The old loop ran 8 inserts with
        // each result unchecked and returned all 8 codes regardless of how many landed, so a mid-loop failure
        // showed the user codes that were never stored. All-or-nothing means the 8 codes are always real.
        // 80-bit codes (randomBytes(10)), stored keyed — see `recoveryHash`.
        const codes = Array.from({ length: 8 }, () => randomBytes(10).toString('hex'));
        await tx(async (c) => {
          for (const code of codes) {
            await c.query(`INSERT INTO auth.mfa_recovery_codes (user_id, tenant_id, code_hash) VALUES ($1,$2,$3)`, [userId, tenantId, recoveryHash(code)]);
          }
          await c.query(`UPDATE auth.mfa_secrets SET enabled=true WHERE user_id=$1`, [userId]);
          await c.query(`UPDATE app.users SET mfa_enrolled_at=now() WHERE id=$1`, [userId]);
        });
        await withUser(tenantId, 'system', (c) =>
          auditLog(c, tenantId, { actor: req.user?.name ?? challenger?.name ?? '(challenge)', actorRole: req.user?.role ?? challenger?.role ?? 'system', action: 'MFA enabled', recordType: 'Auth', recordRef: req.user?.email ?? challenger?.name, policyRef: 'Platform §2.4 (identity & access)', outcome: 'TOTP verified at enrollment · 8 single-use recovery codes issued (shown once)' }));
        return { enabled: true, recoveryCodes: codes };
      }

      if (!challenger) return { enabled: true };
      // login challenge satisfied → D-37(c): the shared issue path (stamps
      // force_change on the MFA-issued session too); the audit adds the
      // second-factor detail on top of the shared 'Signed in (…)' row.
      const u = await sysq(`SELECT id, tenant_id, name, role, email, session_epoch, force_change FROM app.users WHERE id=$1 AND active`, [userId]);
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
      // OPSX-4: 'metrics.read' is what lets an operator's scraper reach GET /metrics (API_DOOR_SCOPES).
      const SCOPES = ['core.read', 'students.read', 'fees.read', 'attendance.read', 'events.read', 'metrics.read'];
      const list = Array.isArray(scopes) ? scopes.filter((s) => SCOPES.includes(s)) : [];
      const raw = `sk_${randomBytes(24).toString('hex')}`;
      const row = await sysq(
        `INSERT INTO app.api_keys (tenant_id, key_hash, name, scopes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [req.user.tenant_id, sha256(raw), name.slice(0, 80), list, req.user.id]);
      await withUser(req.user.tenant_id, req.user.role, (c) =>
        auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'API key created', recordType: 'ApiKey', recordRef: row.rows[0].id, policyRef: 'Platform §2.4 (identity & access)', outcome: `key '${name.slice(0, 80)}' · scopes [${list.join(', ')}] · raw key shown once` }));
      return { id: row.rows[0].id, name, scopes: list, key: raw, note: 'This key is shown once — only its hash is stored. Use it as the X-API-Key header on read doors.' };
    });

    app.get('/api-keys', { preHandler: adminOnly() }, async (req) => {
      const rows = await sysq(`SELECT id, name, scopes, revoked_at, last_used_at, created_at FROM app.api_keys WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user.tenant_id]);
      return { keys: rows.rows };
    });

    app.delete('/api-keys/:id', { preHandler: adminOnly() }, async (req, reply) => {
      if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'valid id required' });
      const r = await sysq(`UPDATE app.api_keys SET revoked_at=now() WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL RETURNING id`, [req.params.id, req.user.tenant_id]);
      if (!r.rows[0]) return reply.code(404).send({ error: 'no such active API key' });
      await withUser(req.user.tenant_id, req.user.role, (c) =>
        auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'API key revoked', recordType: 'ApiKey', recordRef: r.rows[0].id, policyRef: 'Platform §2.4 (identity & access)', outcome: 'key revoked — requests die at next use' }));
      return { ok: true };
    });

    app.post('/webhooks', { preHandler: adminOnly(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { url, events } = req.body ?? {};
      // AUTH-5: scheme + literal-loopback was not enough — `https://169.254.169.254/…` (cloud metadata),
      // `https://10.0.0.5/` and `https://[fd00::1]/` all passed and the worker POSTed to them. Resolve the
      // host and refuse private/loopback/link-local/CGNAT. Plain http remains allowed for loopback only
      // (the sandbox affordance the tests use).
      const target = await assertPublicWebhookUrl(url, { allowLoopback: true });
      if (!target.ok) {
        return reply.code(400).send({ error: `webhook url refused: ${target.reason}. An absolute https url is required (http is allowed for loopback hosts only).` });
      }
      const list = Array.isArray(events) ? events.map(String).slice(0, 50) : [];
      const secret = `whsec_${randomBytes(24).toString('hex')}`;
      const row = await sysq(
        `INSERT INTO app.webhook_subscriptions (tenant_id, url, events, sign_secret, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [req.user.tenant_id, String(url).slice(0, 500), list, secret, req.user.id]);
      await withUser(req.user.tenant_id, req.user.role, (c) =>
        auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Webhook subscription created', recordType: 'Webhook', recordRef: row.rows[0].id, policyRef: 'Platform §2.4 (identity & access)', outcome: `url ${String(url).slice(0, 80)} · topics [${list.join(', ') || '*'}] · signing secret shown once` }));
      return { id: row.rows[0].id, url, events: list, signSecret: secret, note: 'Deliveries are signed: X-SchoolOS-Signature: t=<unix>,v1=hex(hmac_sha256(secret, t + "." + body)) — verify before trusting. The secret is shown once.' };
    });

    app.get('/webhooks', { preHandler: adminOnly() }, async (req) => {
      const rows = await sysq(`SELECT id, url, events, active, created_at FROM app.webhook_subscriptions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user.tenant_id]);
      return { subscriptions: rows.rows };
    });

    app.delete('/webhooks/:id', { preHandler: adminOnly() }, async (req, reply) => {
      if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'valid id required' });
      const r = await sysq(`UPDATE app.webhook_subscriptions SET active=false WHERE id=$1 AND tenant_id=$2 AND active RETURNING id`, [req.params.id, req.user.tenant_id]);
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
  // Custom-role masks are enforced HERE as well as in the kernel `require` — the same shared
  // implementation (src/custom-roles.js), never a second one. Before this, the plugin gate checked the
  // built-in role and nothing else, so a mask's DENY was silently ignored on every plugin door (a
  // librarian told not to reach the safeguarding queue still could) and a mask's ALLOW could not lift a
  // plugin door's role refusal (so a custom role could not be GIVEN a plugin door its base role lacks —
  // the librarian preset's whole purpose, D-43). Resolution order matches the kernel exactly: a matched
  // deny refuses even when the base role allowed; a matched allow lifts the refusal.
  const requireRole = (...roles) => {
    const gate = async (req, reply) => {
      await app.authenticate(req, reply);
      if (reply.sent) return;
      // OPSX-4: an API key has already passed authenticate's door-scope allowlist (API_DOOR_SCOPES) and
      // the scope check, so a machine principal that reaches a gated door holds the role-equivalent grant
      // for that door. Demanding a human role here would make scoped machine access unreachable.
      if (req.auth?.via === 'api-key') return req.user;
      let allowed = roles.includes(req.user?.role);
      if (allowed) {
        await customRoles.applyMask(req, reply, sysq);
        if (reply.sent) return; // a matched DENY already answered 403
      } else {
        allowed = await customRoles.applyMask(req, reply, sysq);
        if (reply.sent) return;
      }
      if (!allowed) {
        return reply.code(403).send({ error: `role ${req.user?.role} not permitted` });
      }
      return req.user;
    };
    // RBAC-1 (PERFECT-100 §5.1): stamped so the routes onRoute hook can record this
    // plugin door's real role gate. Without it, plugin doors would be invisible to the
    // custom-role amplification ceiling and an itadmin could grant library access it
    // cannot reach itself.
    gate.__gateRoles = roles;
    return gate;
  };
   // PERFECT-100 §5.1: plugin kernel paths receive the EXPLICITLY privileged helper.
  // The codebase always intended this ("the ledger write is kernel-path (q) — the doors
  // themselves run as the app role"); the name now says so instead of looking harmless.
  // `requestCoreLaneAction` (src/core-lane-actions.js) is the ONE plugin-reachable path to an office-lane
  // (`app.students`) write: the plugin requests a NAMED action, the kernel holds the SQL and executes it on the
  // caller's tenant-scoped client, auditing it in the same transaction. It exists because DPDP erasure must now
  // reach the office lane while `pack.dpdp` keeps the recorded invariant that it never writes core student rows.
  await loadPlugins(app, { withUser, auditLog, emitEvent, requestAudit, q, sysq, require: requireRole,
    requestCoreLaneAction: makeCoreLaneActions({ auditLog }) });

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
    const t = await sysq(`SELECT name, slug, config FROM app.tenants WHERE id=$1`, [req.user.tenant_id]).catch(() => ({ rows: [] }));
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
  // enabled = app.plugins registry status (owner-path sysq() is fine: registry rows
  // only, and the caller's own tenant scopes the read).
  app.get('/capabilities', { preHandler: app.authenticate }, async (req) => {
    const reg = await sysq(`SELECT plugin_id, status, settings, manifest FROM app.plugins WHERE tenant_id=$1`, [req.user.tenant_id]).catch(() => ({ rows: [] }));
    const providers = (capability) => reg.rows.filter((r) => ['enabled', 'active', 'degraded'].includes(r.status) && Array.isArray(r.manifest?.capabilities) && r.manifest.capabilities.includes(capability));
    const first = (capability) => providers(capability)[0];
    const on = (capability) => Boolean(first(capability));
    const s = (capability) => first(capability)?.settings ?? {};
    return {
      rails: {
        // rails.sms is settings-driven (provider 'logger' default, 'http-generic'
        // over env) — configured = operator env OR the rail enabled with settings.
        sms: {
          configured: !!process.env.SMS_PROVIDER || on('auth.otp'),
          provider: process.env.SMS_PROVIDER ?? s('auth.otp').provider ?? null,
        },
        whatsapp: {
          configured: !!process.env.WHATSAPP_BSP_PROVIDER || on('comms.whatsapp.delivery'),
          provider: process.env.WHATSAPP_BSP_PROVIDER ?? s('comms.whatsapp.delivery').provider ?? null,
        },
        razorpay: { configured: !!(process.env.RAZORPAY_KEY_ID ?? s('fees.razorpay.gateway').key_id) },
        files: { configured: true }, // artifact store is kernel-native (docs/12 §3)
        // S0 fix A2: the registry/catalog id is 'library' — 'library.core' never
        // existed, so capabilities always reported the module off.
        library: { enabled: on('library') },
        transport: { enabled: on('transport.gps.ingest') },
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
    const gateway = createAiGateway({ sysq, kernelQ: sysq });
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

  app.get('/metrics', { preHandler: requireRole('owner', 'itadmin') }, async (req, reply) => {
    const d = await sysq(`SELECT
        (SELECT count(*)::int FROM app.outbox WHERE tenant_id=$1 AND processed_at IS NULL AND parked_at IS NULL) AS outbox_pending,
        (SELECT count(*)::int FROM app.communications WHERE tenant_id=$1 AND status='queued') AS comms_queued,
        (SELECT count(*)::int FROM app.events WHERE tenant_id=$1 AND created_at > now() - interval '1 hour') AS events_last_hour
      `, [req.user.tenant_id]).catch(() => null);
    // §4 H5 / 073: parked rows get their OWN counter, so relay FAILURE is a positive
    // signal instead of a hole in the pending gauge. Kept as a separate read (same idiom
    // as `persisted` above) so a database migrated before 073 still serves every other
    // metric instead of losing the whole payload to one missing column.
    const parked = await sysq(`SELECT count(*)::int AS n FROM app.outbox WHERE tenant_id=$1 AND parked_at IS NOT NULL`, [req.user.tenant_id])
      .catch(() => ({ rows: [{ n: null }] }));
    // PRD-13 · the comms counterpart, and the reason it is two separate gauges rather than one.
    // A row whose status is 'sent' but whose CARRIER was a sandbox ('logger'/'log-only') was delivered
    // to nobody. That population existed in every environment and was invisible: `comms_queued` falls
    // as those rows drain, so a school with no SMS provider saw a clean, emptying queue. Counting it
    // separately is what turns "the ledger is honest" into "the lie is measurable".
    const comms = await sysq(`SELECT
        (SELECT count(*)::int FROM app.communications WHERE tenant_id=$1 AND status='failed') AS failed,
        (SELECT count(*)::int FROM app.communications
          WHERE tenant_id=$1 AND status='sent' AND lower(COALESCE(provider,'')) IN ('logger','log-only','')) AS sandbox_sent
      `, [req.user.tenant_id]).catch(() => ({ rows: [{ failed: null, sandbox_sent: null }] }));
    /* DAT-3 · the DELIVERY gauge, and why `outbox_pending` alone was not enough.
     *
     * `outbox_pending` counts `processed_at IS NULL`, and the relay sets `processed_at` once it has finished
     * its OWN deliverable — which for the log relay is emitting the event to the log sink (stdout, collected
     * by the operator's log pipeline). That is a real delivery to a real sink, so the column is not lying.
     * What was missing is everything AFTER it: the webhook fan-out and its per-receiver retries live in
     * `app.webhook_deliveries`, and **no gauge measured them at all**. So an operator watching the only queue
     * signal saw `outbox_pending 0` — a clean, drained, healthy-looking queue — while every subscriber
     * delivery was failing. That is the same success-shaped silence 073 had to undo for parked rows, in the
     * one place nobody had looked yet.
     *
     * Three gauges rather than one, because they answer different questions and collapsing them is what
     * created the blind spot:
     *   queued  — deliveries still to attempt          (not falling = the fan-out is stuck)
     *   failed  — deliveries that gave up              (non-zero = somebody never got their webhook)
     *   stalled — queued, due, and not being retried   (the genuinely alarming one: the worker is wedged or
     *             not running, which a school would otherwise learn from a customer complaint)
     */
    const webhooks = await sysq(`SELECT
        (SELECT count(*)::int FROM app.webhook_deliveries WHERE tenant_id=$1 AND status='queued') AS queued,
        (SELECT count(*)::int FROM app.webhook_deliveries WHERE tenant_id=$1 AND status='failed') AS failed,
        (SELECT count(*)::int FROM app.webhook_deliveries
          WHERE tenant_id=$1 AND status='queued' AND created_at < now() - interval '10 minutes'
            AND (next_attempt_at IS NULL OR next_attempt_at < now() - interval '10 minutes')) AS stalled
      `, [req.user.tenant_id]).catch(() => ({ rows: [{ queued: null, failed: null, stalled: null }] }));
    // OPSX-3: the gauges above are scoped to the SCRAPER's tenant. An operator's Prometheus scraping this
    // endpoint therefore saw one school's queue, so a backlog anywhere else was invisible to the fleet —
    // while the health-probe (which reads the database directly) is cross-tenant. These `fleet_` series are
    // the platform-wide totals an operator alert must use; the tenant-scoped ones remain for the school's
    // own ItAdmin screen. No tenant identities are exposed — only aggregate counts on an operator surface.
    // OPSX-8: one owner-path read carries every fleet gauge the alert rules name, so the rules' `metric:`
    // linkage is machine-checked rather than a hardcoded map in the test. The two column-presence probes
    // (076's discovered_at / workflow_scanned_at) answer NULL on a database that predates them, and their
    // gauges are then omitted rather than reported as a fabricated zero.
    const fleet = await sysq(`SELECT
        (SELECT count(*)::int FROM app.outbox WHERE processed_at IS NULL AND parked_at IS NULL) AS outbox_pending,
        (SELECT count(*)::int FROM app.communications WHERE status='queued') AS comms_queued,
        (SELECT count(*)::int FROM app.outbox WHERE parked_at IS NOT NULL) AS outbox_parked,
        (SELECT count(*)::int FROM app.communications WHERE status='failed') AS comms_failed,
        (SELECT count(*)::int FROM app.communications
          WHERE status='sent' AND lower(COALESCE(provider,'')) IN ('logger','log-only','')) AS comms_sandbox_sent,
        (SELECT count(*)::int FROM app.webhook_deliveries WHERE status='queued') AS wh_queued,
        (SELECT count(*)::int FROM app.webhook_deliveries WHERE status='failed') AS wh_failed,
        (SELECT count(*)::int FROM app.webhook_deliveries
          WHERE status='queued' AND created_at < now() - interval '10 minutes'
            AND (next_attempt_at IS NULL OR next_attempt_at < now() - interval '10 minutes')) AS wh_stalled,
        (SELECT EXTRACT(EPOCH FROM (now() - max(updated_at)))::int FROM app.ops_counters
           WHERE name IN ('requests_total','errors_total')) AS api_heartbeat_age,
        (SELECT EXTRACT(EPOCH FROM (now() - to_timestamp(value)))::int FROM app.ops_counters
           WHERE name='backup_last_success_epoch') AS backup_age,
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='app' AND table_name='outbox' AND column_name='discovered_at')
          THEN (SELECT count(*)::int FROM app.outbox WHERE discovered_at IS NULL AND created_at < now() - interval '15 minutes') END AS undiscovered,
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='app' AND table_name='outbox' AND column_name='workflow_scanned_at')
          THEN (SELECT count(*)::int FROM app.outbox WHERE workflow_scanned_at IS NULL AND created_at < now() - interval '15 minutes') END AS workflow_unscanned
      `).catch(() => null);
    // The migrations comparison needs filesystem + a schema_migrations read; kept separate and LAST so it
    // is the only other owner-path site this batch adds.
    const migPending = await (async () => {
      try {
        const { readdirSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, join } = await import('node:path');
        const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
        const onDisk = readdirSync(dir).filter((f) => f.endsWith('.sql'));
        const applied = new Set((await sysq('SELECT name FROM app.schema_migrations')).rows.map((r) => r.name));
        return onDisk.filter((f) => !applied.has(f)).length;
      } catch { return null; }
    })();
    const row = d?.rows[0];
    // OPSX-9: the persisted `requests_total`/`errors_total` rows are the FLEET totals (each replica's
    // flush adds its own delta). A scrape reports them plus this process's unsynced delta, so a counter no
    // longer regresses or under-reports with more than one replica. Reused by the worker-counter export
    // below, so this is still ONE owner-path read.
    const persisted = await sysq(`SELECT name, value FROM app.ops_counters`).catch(() => ({ rows: [] }));
    const persistedNum = (name) => Number(persisted.rows.find((r) => r.name === name)?.value ?? 0);
    const fleetRequests = persistedNum('requests_total') + Math.max(0, metrics.requestsTotal - metrics.flushedRequests);
    const fleetErrors = persistedNum('errors_total') + Math.max(0, metrics.errorsTotal - metrics.flushedErrors);
    const lines = [
      '# TYPE schoolos_uptime_seconds gauge',
      `schoolos_uptime_seconds ${Math.floor((Date.now() - metrics.startedAt) / 1000)}`,
      /* OPS-11: the build identity as a labelled series so a dashboard or alert can join metrics to a specific
         deployed build without polling /health. `info`-style gauges are the Prometheus convention for "expose
         a string as labels with value 1". The fingerprint is derived at startup from the deployed sources, so
         two different builds cannot report the same series, and the label set is bounded (seven fixed keys) —
         which matters, since an unbounded label value is how a metrics endpoint becomes a memory leak. */
      (() => {
        const b = buildInfo();
        const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        return [
          '# TYPE schoolos_build_info gauge',
          `schoolos_build_info{id="${esc(b.id)}",version="${esc(b.version)}",fingerprint="${esc(b.fingerprint)}",env="${esc(b.env)}",node="${esc(b.node)}"} 1`,
          '# HELP schoolos_build_info The running build. `id` is BUILD_ID/GIT_SHA when a build system set one, '
          + 'otherwise a fingerprint computed from the deployed sources. Alert on `changes(schoolos_build_info[5m])` '
          + 'to catch an unexpected deploy, or pin a dashboard to it to end "which build was that?"',
        ].join('\n');
      })(),
      '# TYPE schoolos_requests_total counter',
      `schoolos_requests_total ${fleetRequests}`,
      '# TYPE schoolos_errors_total counter',
      `schoolos_errors_total ${fleetErrors}`,
      '# TYPE schoolos_request_duration_ms histogram',
      ...[...metrics.latencyBuckets.entries()].map(([bound, count]) => `schoolos_request_duration_ms_bucket{le="${bound === Infinity ? '+Inf' : bound}"} ${count}`),
      `schoolos_request_duration_ms_count ${metrics.latencyCount}`,
      `schoolos_request_duration_ms_sum ${metrics.latencyTotalMs.toFixed(3)}`,
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
        // DAT-3: the HELP text states what this gauge MEASURES, because misreading it as "undelivered
        // events" is what hid the webhook stage for so long. It counts rows the relay has not yet emitted to
        // its sink; it says nothing about subscriber deliveries, which are the gauges added below.
        '# HELP schoolos_outbox_pending Events the relay has not yet emitted to its sink. This is NOT a '
        + 'count of undelivered events and NOT a delivery measure: a 0 here is consistent with every '
        + 'subscriber webhook failing. See schoolos_webhook_deliveries_*.',
        '# TYPE schoolos_comms_queued gauge', `schoolos_comms_queued ${row.comms_queued}`,
        '# TYPE schoolos_events_last_hour gauge', `schoolos_events_last_hour ${row.events_last_hour}`);
      // omitted entirely when the column is absent (pre-073) rather than reported as 0,
      // which would be a fabricated "no failures" reading — the exact defect class here.
      if (parked.rows[0]?.n !== null && parked.rows[0]?.n !== undefined) {
        lines.push(
          '# TYPE schoolos_outbox_parked gauge', `schoolos_outbox_parked ${parked.rows[0].n}`,
          '# HELP schoolos_outbox_parked Events the relay GAVE UP on after max attempts. '
          + 'Non-zero means undelivered events; they are terminal for the relay, not for a human.');
      }
      const cr = comms.rows[0];
      if (cr?.sandbox_sent !== null && cr?.sandbox_sent !== undefined) {
        lines.push(
          '# TYPE schoolos_comms_sandbox_sent gauge', `schoolos_comms_sandbox_sent ${cr.sandbox_sent}`,
          '# HELP schoolos_comms_sandbox_sent Messages recorded sent by a SANDBOX carrier '
          + '(logger/log-only). They reached nobody. In production this must stay 0 — a non-zero '
          + 'reading means the install has no real provider for that channel.');
      }
      if (cr?.failed !== null && cr?.failed !== undefined) {
        lines.push(
          '# TYPE schoolos_comms_failed gauge', `schoolos_comms_failed ${cr.failed}`,
          '# HELP schoolos_comms_failed Messages the dispatcher gave up on (retry cap, or '
          + 'undeliverable because the carrier was a sandbox in production).');
      }
      // DAT-3 · webhook fan-out, the stage that had NO gauge. Emitted only when the read answered, so a
      // database that predates the table serves every other metric instead of losing the whole payload.
      const wr = webhooks.rows[0];
      if (wr?.queued !== null && wr?.queued !== undefined) {
        lines.push(
          '# TYPE schoolos_webhook_deliveries_queued gauge', `schoolos_webhook_deliveries_queued ${wr.queued}`,
          '# HELP schoolos_webhook_deliveries_queued Subscriber deliveries still awaiting an attempt. This is '
          + 'the stage AFTER outbox_pending: an outbox row is settled once the relay has emitted it, so a '
          + 'drained outbox with a rising queued count means the fan-out is stuck, not that all is well.',
          '# TYPE schoolos_webhook_deliveries_failed gauge', `schoolos_webhook_deliveries_failed ${wr.failed}`,
          '# HELP schoolos_webhook_deliveries_failed Deliveries the worker gave up on. Non-zero means a '
          + 'subscriber never received an event it was entitled to.',
          '# TYPE schoolos_webhook_deliveries_stalled gauge', `schoolos_webhook_deliveries_stalled ${wr.stalled}`,
          '# HELP schoolos_webhook_deliveries_stalled Queued deliveries that are due and have not been '
          + 'retried for over ten minutes — the worker is wedged or not running.');
      }
    }
    // OPSX-3: platform-wide counterparts of the queue gauges, emitted when the read answered. An operator
    // alert must target these, not the tenant-scoped series, or a backlog in any other school is invisible.
    // OPSX-8: these are exactly the series the alert rules declare under `metric:`.
    const fr = fleet?.rows[0];
    if (fr) {
      lines.push(
        '# TYPE schoolos_fleet_outbox_pending gauge', `schoolos_fleet_outbox_pending ${fr.outbox_pending}`,
        '# HELP schoolos_fleet_outbox_pending Platform-wide events not yet emitted by the relay (ALL tenants). '
        + 'Use this for fleet alerting; schoolos_outbox_pending is the caller-tenant view.',
        '# TYPE schoolos_fleet_comms_queued gauge', `schoolos_fleet_comms_queued ${fr.comms_queued}`,
        '# TYPE schoolos_fleet_outbox_parked gauge', `schoolos_fleet_outbox_parked ${fr.outbox_parked}`,
        '# TYPE schoolos_fleet_comms_failed gauge', `schoolos_fleet_comms_failed ${fr.comms_failed}`,
        '# TYPE schoolos_fleet_comms_sandbox_sent gauge', `schoolos_fleet_comms_sandbox_sent ${fr.comms_sandbox_sent}`,
        '# TYPE schoolos_fleet_webhook_deliveries_queued gauge', `schoolos_fleet_webhook_deliveries_queued ${fr.wh_queued}`,
        '# TYPE schoolos_fleet_webhook_deliveries_failed gauge', `schoolos_fleet_webhook_deliveries_failed ${fr.wh_failed}`,
        '# TYPE schoolos_fleet_webhook_deliveries_stalled gauge', `schoolos_fleet_webhook_deliveries_stalled ${fr.wh_stalled}`);
      if (fr.api_heartbeat_age !== null && fr.api_heartbeat_age !== undefined) {
        lines.push('# TYPE schoolos_fleet_api_heartbeat_age_seconds gauge', `schoolos_fleet_api_heartbeat_age_seconds ${fr.api_heartbeat_age}`);
      }
      if (fr.backup_age !== null && fr.backup_age !== undefined) {
        lines.push('# TYPE schoolos_fleet_backup_age_seconds gauge', `schoolos_fleet_backup_age_seconds ${fr.backup_age}`);
      }
      if (fr.undiscovered !== null && fr.undiscovered !== undefined) {
        lines.push('# TYPE schoolos_fleet_webhook_undiscovered gauge', `schoolos_fleet_webhook_undiscovered ${fr.undiscovered}`);
      }
      if (fr.workflow_unscanned !== null && fr.workflow_unscanned !== undefined) {
        lines.push('# TYPE schoolos_fleet_workflow_unscanned gauge', `schoolos_fleet_workflow_unscanned ${fr.workflow_unscanned}`);
      }
    }
    if (migPending !== null && migPending !== undefined) {
      lines.push('# TYPE schoolos_fleet_migrations_pending gauge', `schoolos_fleet_migrations_pending ${migPending}`);
    }
    /* Worker heartbeats and other one-off counters ride app.ops_counters (migration 050). The
     * duplicate-series defect lived here: `requests_total`/`errors_total` were exported BOTH from the
     * in-memory counters above AND from this table, so a scrape carried two samples for one series and
     * Prometheus rejected the whole thing. The first fix removed the export entirely — which restored a
     * clean scrape but silently dropped every worker signal (`webhook_last_tick_epoch`, workflow
     * heartbeats), the exact success-shaped silence this endpoint exists to prevent. The rule now is
     * narrow: export every ops_counter row EXCEPT the names already emitted above, so a heartbeat stays
     * observable and no series appears twice. */
    const RESERVED_COUNTERS = new Set([
      'requests_total', 'errors_total', 'uptime_seconds', 'build_info',
      'outbox_pending', 'comms_queued', 'events_last_hour', 'outbox_parked',
      'comms_sandbox_sent', 'comms_failed',
      'webhook_deliveries_queued', 'webhook_deliveries_failed', 'webhook_deliveries_stalled',
      'pg_pool_total', 'pg_pool_idle', 'pg_pool_waiting', 'schema_migrations',
    ]);
    for (const { name, value } of persisted.rows) {
      if (RESERVED_COUNTERS.has(name)) continue;          // already emitted above — never twice
      const metric = `schoolos_${name}`;
      if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(metric)) continue; // never emit a malformed sample
      if (lines.includes(`# TYPE ${metric} counter`)) continue;  // belt-and-braces against a future collision
      lines.push(`# TYPE ${metric} counter`, `${metric} ${Number(value) || 0}`);
    }
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(lines.join('\n') + '\n');
  });

  // Persist the hot counters every 60s (best-effort; cleared in onClose so the
  // process — and every test run — can actually exit). Boot-seed merges the
  // persisted totals so restarts continue the monotonic series, never regress it.
  // OPSX-9: the flush writes only the UNSYNCED DELTA and ADDS it to the stored row, so two replicas no
  // longer overwrite each other with their own partial totals (the old `value = EXCLUDED.value` made the
  // counter regress). A failed flush advances nothing, so the delta is retried next tick. We deliberately
  // do NOT seed `metrics.requestsTotal` from the persisted (fleet-wide) value — that would make this
  // process's first delta include other replicas' counts and double-count them.
  const flushTimer = setInterval(() => {
    const dReq = metrics.requestsTotal - metrics.flushedRequests;
    const dErr = metrics.errorsTotal - metrics.flushedErrors;
    if (dReq === 0 && dErr === 0) return;
    sysq(`INSERT INTO app.ops_counters (name, value) VALUES ('requests_total', $1), ('errors_total', $2)
       ON CONFLICT (name) DO UPDATE SET value = app.ops_counters.value + EXCLUDED.value, updated_at = now()`,
      [dReq, dErr]).then(() => {
        metrics.flushedRequests = metrics.requestsTotal;
        metrics.flushedErrors = metrics.errorsTotal;
      }).catch(() => { /* retry the same delta next tick */ });
  }, 60_000);
  flushTimer.unref?.();

  // --- error handler ---
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: 'route not found', code: 'NOT_FOUND', requestId: String(req.id) });
  });
  app.setErrorHandler((err, req, reply) => {
    const code = err.statusCode ?? 500;
    if (code >= 500) { req.log.error(err); metrics.errorsTotal += 1; } // wave-c: 5xx only
    const errorCode = code === 413 ? 'PAYLOAD_TOO_LARGE'
      : code === 400 ? 'BAD_REQUEST'
        : code === 401 ? 'UNAUTHORIZED'
          : code === 403 ? 'FORBIDDEN'
            : code === 404 ? 'NOT_FOUND'
              : code === 409 ? 'CONFLICT'
                : code === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR';
    reply.code(code).send({
      error: code >= 500 ? 'internal error' : err.message,
      code: errorCode,
      requestId: String(req.id),
    });
  });

  app.addHook('onClose', async () => { clearInterval(flushTimer); await pool.end(); });
  return app;
}
