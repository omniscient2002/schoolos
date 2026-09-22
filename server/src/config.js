// Configuration — 12-factor, env-driven, fail-fast on missing values.
import 'dotenv/config';
const req = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) { console.error(`Missing required env: ${name}`); process.exit(1); }
  return v;
};
const int = (v, dflt) => (v ? parseInt(v, 10) : dflt);

// WORKER_ROLE=1 marks non-HTTP processes (outbox relay) that need only
// DATABASE_URL: HTTP-surface guards (CORS allowlist) and session secrets
// (JWT_SECRET) don't apply to them and must not crash-loop the event spine
// (re-scan cycle-2 P0: the compose outbox worker died on both guards).
const isWorker = process.env.WORKER_ROLE === '1';
const isProd = (process.env.NODE_ENV ?? 'development') === 'production';
if (isProd && !isWorker) {
  // ops audit P1-19: production must never run on dev defaults.
  if ((process.env.DATABASE_URL ?? '').includes('127.0.0.1:5432') || (process.env.DATABASE_URL ?? '').includes('localhost:5432'))
    throw new Error('NODE_ENV=production with a localhost DATABASE_URL — point DATABASE_URL at the real cluster');
  if ((process.env.CORS_ORIGINS ?? '*') === '*')
    throw new Error('NODE_ENV=production requires an explicit CORS_ORIGINS allowlist (got "*")');
  if (!process.env.PLUGIN_SETTINGS_KEY || process.env.PLUGIN_SETTINGS_KEY.length < 32)
    throw new Error('NODE_ENV=production requires PLUGIN_SETTINGS_KEY (32+ characters) for encrypted plugin secrets');
  if ((process.env.SEED_GUARD ?? '') !== 'strict' && process.env.SEED_GUARD !== undefined)
    throw new Error('SEED_GUARD must be "strict" in production');
}

export const config = {
  env: req('NODE_ENV', 'development'),
  port: int(process.env.PORT, 8080),
  host: req('HOST', '0.0.0.0'),
  databaseUrl: req('DATABASE_URL', 'postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos'),
  jwtSecret: req('JWT_SECRET', 'dev-only-secret-change-me'),
  jwtTtl: req('JWT_TTL', '12h'),
  // Shared-computer safety (StudentOS §62/§63/§78): student sessions are
  // intentionally short — a lab kiosk left logged in must self-expire.
  studentSessionTtl: req('STUDENT_SESSION_TTL', '30m'),
  logLevel: req('LOG_LEVEL', 'info'),
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(','),
  // Full authentication (008): phone OTP + Google SSO.
  otp: {
    ttlMs: int(process.env.OTP_TTL_MS, 5 * 60 * 1000),
    maxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
  },
  // L2-2.2: self-service password reset (056 reset-token vault).
  auth: {
    resetTtlMs: int(process.env.RESET_TTL_MS, 30 * 60 * 1000),
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? null,
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? null,
  },
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 300),
  staticDir: process.env.STATIC_DIR ?? null, // optional: serve built frontend
  // C2 · mandatory MFA for privileged roles. Comma-separated role names (e.g.
  // `owner,principal,itadmin,finance_head`). EMPTY BY DEFAULT — no behaviour change unless an operator
  // opts in. When set, a role in this list with no enrolled second factor is restricted to
  // `/me/mfa/enroll`, `/me` and `/auth/logout` until it enrols. The decision to enforce is a tenant/
  // deployment policy; the mechanism is here.
  requireMfaRoles: (process.env.REQUIRE_MFA_ROLES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};

// ── T101 (STILL NOT GOOD §7 P0-2): dev doors fail CLOSED ─────────────────────
// AUTH_DEV_SSO / OTP_DEV_ECHO arm ONLY when BOTH hold:
//   1. NODE_ENV is exactly 'development' (staging boxes that inherit a dev
//      posture via NODE_ENV=test/qa/staging never arm them), AND
//   2. the operator EXPLICITLY opted in (flag present and truthy).
// A production config cannot arm them through any code path — the flags are
// computed once here and the HTTP layer reads only these booleans.
const devFlagExplicitlyOn = (name) =>
  process.env[name] === '1' || process.env[name] === 'true';
const devSso = config.env === 'development' && devFlagExplicitlyOn('AUTH_DEV_SSO');
// Dev echo additionally requires that no real SMS provider is configured —
// arming an echo beside a live rail would leak codes into HTTP responses.
/* Deliberately NOT relaxed to `env !== 'production'` — tried and rejected in the same round.
   `tests/l1-security-sprint.test.js` T101 pins this guard ("dev doors fail closed") and is right to: the echo
   puts a live credential in an HTTP response, so "we are in a test environment" is not a reason to arm it —
   only an explicit flag on a developer machine is. A test that needs a code must configure a channel, or read
   it the way the app does. Loosening a security posture so a test passes is how postures erode. */
const devEcho = config.env === 'development'
  && devFlagExplicitlyOn('OTP_DEV_ECHO')
  && !process.env.SMS_PROVIDER;
if (devSso) {
  console.warn('⚠️  AUTH_DEV_SSO IS ACTIVE — POST /auth/google/demo issues a full session for any existing email with zero credentials. NEVER set this outside a local developer machine.');
}
if (devEcho) {
  console.warn('⚠️  OTP_DEV_ECHO IS ACTIVE — OTP codes are echoed in HTTP responses. NEVER set this outside a local developer machine.');
}

config.otp.devEcho = devEcho;
config.devSsoEnabled = devSso;

// ── SEC-0 (PERFECT-100 §5.1): a live reset token must never be PERSISTED ─────
// The reset mail body used to be written verbatim into app.communications
// whenever the send ran in "sandbox" mode — which is the permanent default for
// any tenant without SMTP credentials. That table is readable by six tenant
// roles, so a coordinator could mint the owner's reset token and read it back:
// account takeover with no cryptography broken.
//
// The ledger now records delivery evidence only (the code is always redacted),
// and the local-development affordance moves to stdout, gated exactly like the
// other dev doors (T101: development + explicit opt-in). No production config
// can arm it, and nothing tenant-readable is involved either way.
const devResetTokenLog = config.env === 'development' && devFlagExplicitlyOn('RESET_TOKEN_DEV_LOG');
if (devResetTokenLog) {
  console.warn('⚠️  RESET_TOKEN_DEV_LOG IS ACTIVE — password-reset codes are written to this process\'s stdout so a local developer can complete the flow. NEVER set this outside a local developer machine.');
}
config.devResetTokenLog = devResetTokenLog;

// RTR-001 RT-001: refuse to boot production on a default/known secret.
// (Workers hold no signing key — they only read the database.)
if (config.env === 'production' && !isWorker && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set (≥32 chars) outside development');
}
// OTP TTL misconfig guard (re-scan cycle-2 P2): 0/NaN would bind NULL into a
// NOT NULL expires_at → 500 on every /auth/otp/request.
if (!(config.otp.ttlMs > 0)) {
  throw new Error(`OTP_TTL_MS must be a positive integer (got "${process.env.OTP_TTL_MS ?? 'unset'}")`);
}
