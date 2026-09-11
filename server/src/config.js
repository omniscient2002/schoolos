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
