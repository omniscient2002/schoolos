/* ============================================================
   Login — the front door. Email+password, phone+OTP, Google SSO.
   Shown whenever there is no valid session. All three methods run
   against the live API — the server is the only authentication brain.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LIVE_BASE, setToken } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { Icon } from '../components/Icon';
import { Badge } from '../components/ui';
import { t } from '../i18n';
import { listTenants, switchTenant, type PickSchool } from './account/tenantSwitch';

/* L5-2.1: the login 403 for force_change accounts carries the RESTRICTED
   session token in its body ({ mustChange, token, user }) — the shared
   call() wrapper throws non-2xx and drops the body, so the password path
   reads the response directly here. Only /auth/login needs this; OTP paths
   use the shared wrappers. */
async function loginFull(email: string, password: string, tenantId?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${LIVE_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tenantId ? { email, password, tenantId } : { email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

/* L5-4.1: the OTP doors answer 409 multiTenant with the schools list for a
   multi-membership phone — the shared call() wrapper drops that body, so
   both OTP doors are read directly here. Both accept a tenantId scope
   (server routes.js: the scoped query re-runs against the chosen school). */
async function otpRequestFull(phone: string, tenantId?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${LIVE_BASE}/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tenantId ? { phone, tenantId } : { phone }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}
async function otpVerifyFull(phone: string, code: string, tenantId?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${LIVE_BASE}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tenantId ? { phone, code, tenantId } : { phone, code }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

type Method = 'password' | 'phone' | 'google';

export interface SessionUser { name: string; role: string; email: string }
export default function Login({ onAuthed }: { onAuthed: (session: SessionUser) => Promise<void> | void }) {
  const navigate = useNavigate();
  /* P0 fix 4: the 401 handlers redirect to /login?return=<path>; after a
     successful sign-in the user lands where they were headed (default /today). */
  const [params] = useSearchParams();
  const returnTo = useMemo(() => {
    const raw = params.get('return');
    if (!raw) return '/today';
    /* only accept in-app absolute paths — never an off-site redirect */
    if (!raw.startsWith('/') || raw.startsWith('//')) return '/today';
    return raw;
  }, [params]);
  const [method, setMethod] = useState<Method>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* L5-3.1: MFA login challenge — set after a 307 from /auth/login. */
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  /* L5-4.1: multi-membership chooser. THREE sources, because the server
     409s multi-membership identities BEFORE issuing any session:
     'password' — /auth/login 409 body; pick re-logins with a tenantId
     (server param pending L2 — see blocks.md); interim: the attempt is
     real and a repeat 409 surfaces the server's own guidance.
     'otp' / 'otp-verify' — the OTP doors 409 the same way BUT already
     accept a tenantId scope, so a pick completes the request/verify for
     real. 'authed' — a bootstrap-session server contract (L2 alternative)
     would land here with a live token; pick uses POST /me/switch. */
  const [tenantPick, setTenantPick] = useState<PickSchool[] | null>(null);
  const [tenantPickSource, setTenantPickSource] = useState<'password' | 'otp' | 'otp-verify' | 'authed'>('password');
  /* S0 fix A4: /me/switch demands the current password for password-carrying
     accounts — the 'authed' picker path prompts for it inline. */
  const [pickPw, setPickPw] = useState('');
  const [pwNeeded, setPwNeeded] = useState(false);
  const [scopedTenantId, setScopedTenantId] = useState<string | null>(null);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);

  /* Seg tablist a11y (unit 3): roving tabindex + arrow/Home/End keys.
     Handling and attributes only — arrows perform the same selection a
     click performs (setMethod); no submit, no auth logic, no extra state. */
  const segTabs: { id: Method; label: string }[] = [
    { id: 'password', label: t('login.method.email', { fallback: 'Email' }) },
    { id: 'phone', label: t('login.method.phone', { fallback: 'Phone' }) },
    { id: 'google', label: t('login.method.google', { fallback: 'Google' }) },
  ];
  const segBtnRefs = useRef<Record<Method, HTMLButtonElement | null>>({ password: null, phone: null, google: null });
  const segKeyNav = useRef(false);
  const onSegKeyDown = (e: React.KeyboardEvent) => {
    const idx = segTabs.findIndex(tb => tb.id === method);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % segTabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + segTabs.length) % segTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = segTabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    segKeyNav.current = true;
    setMethod(segTabs[next].id);
  };
  /* Keyboard nav only: the newly mounted panel carries autoFocus inputs —
     return focus to the (roving) tab so focus follows the selection, per
     the WAI-ARIA tabs pattern. Mouse clicks keep the autoFocus behavior. */
  useEffect(() => {
    if (!segKeyNav.current) return;
    segKeyNav.current = false;
    segBtnRefs.current[method]?.focus();
  }, [method]);

  const fail = (m: string) => { setError(m); setBusy(false); };
  /* L5-4.1: called after the token is installed but BEFORE sign-in completes.
     >1 membership → open the chooser (control-flow throw, sentinel pattern).
     A listing failure never blocks sign-in — the server already issued a
     session for one school; the chooser is an upgrade, not a gate. */
  const guardTenants = async () => {
    try {
      const list = await listTenants();
      if (list.length > 1) {
        setTenantPick(list); setTenantPickSource('authed'); setBusy(false);
        throw new Error('__stage__');
      }
    } catch (e: unknown) {
      if ((e as Error).message === '__stage__') throw e;
      console.warn('[login] membership listing failed — proceeding with the issued session:', (e as Error)?.message);
    }
  };
  const run = async (fn: () => Promise<{ name: string; role: string; email: string }>) => {
    setBusy(true); setError(null);
    try {
      await onAuthed(await fn());
      /* session is set in AuthGate → land on the originally requested
         screen (or /today when there is no return parameter). */
      navigate(returnTo, { replace: true });
    } catch (e: unknown) { fail(friendly((e as Error).message || 'sign-in failed')); }
  };

  /* Shared by submitPassword AND a picker pick (L5-4.1): one place that
     understands every /auth/login answer. Throws '__stage__' for panel
     hand-offs (MFA / tenant picker); returns the session on 200. */
  const handleLoginResponse = async (status: number, body: Record<string, unknown>): Promise<{ name: string; role: string; email: string }> => {
    /* L5-4.1 multi-membership: 409 + multiTenant + the schools list — no
       session is issued. Open the picker; a pick re-logins with a tenantId. */
    if (status === 409 && body.multiTenant === true && Array.isArray(body.schools)) {
      setTenantPick(body.schools as PickSchool[]);
      setTenantPickSource('password');
      setBusy(false);
      throw new Error('__stage__');
    }
    /* L5-3.1 MFA challenge: mfaRequired + a 5-minute challenge token — no
       session exists yet. The server currently answers 307+Location, which
       fetch follows and loses (review BLOCKER 1 — L2 owns switching to a
       plain JSON contract); this branch accepts BOTH shapes (307 body or
       401 JSON) so it works the moment the contract lands. */
    if ((status === 307 || status === 401) && body.mfaRequired === true && typeof body.challengeToken === 'string') {
      setMfaChallenge(String(body.challengeToken));
      setBusy(false);
      throw new Error('__stage__');
    }
    /* L5-2.1 forced flow: 403 + mustChange + restricted token. Install the
       token (the authenticate hook limits it to /me/password) and send the
       user to the change screen; the throw is control-flow — run()'s catch
       keeps us mounted, same pattern as the OTP stage hand-off. */
    if (status === 403 && body.mustChange === true && typeof body.token === 'string') {
      setToken(body.token);
      /* forward the original destination so the change screen returns there
         (review MINOR); no state — ChangePassword never consumed it */
      navigate(`/account/password?reason=forced${returnTo !== '/today' ? `&return=${encodeURIComponent(returnTo)}` : ''}`, { replace: true });
      throw new Error('__stage__');
    }
    if (typeof body.token !== 'string') throw new Error(typeof body.error === 'string' && body.error ? body.error : 'sign-in failed');
    setToken(body.token);
    const u = body.user as { name: string; role: string; email: string; tenantId?: string };
    setActiveTenantId(typeof u.tenantId === 'string' ? u.tenantId : null);
    await guardTenants();
    return { name: u.name, role: u.role, email: u.email };
  };

  const submitPassword = () => {
    if (!email || !password) return fail('email and password required');
    run(async () => {
      const { status, body } = await loginFull(email.trim(), password, scopedTenantId ?? undefined);
      return handleLoginResponse(status, body);
    });
  };

  /* L5-3.1: the challenge answer. A direct fetch — the shared call() treats a
     401 (wrong code) as a dead session and would redirect mid-panel. The door
     accepts an authenticator code OR a single-use recovery code. */
  const submitMfa = async () => {
    if (!mfaChallenge || !mfaCode.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${LIVE_BASE}/me/mfa/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: mfaCode.trim(), challengeToken: mfaChallenge }),
        signal: AbortSignal.timeout(15000),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 200 && typeof body.token === 'string') {
        setToken(body.token);
        const u = body.user as { name: string; role: string; email: string; tenantId?: string };
        setMfaChallenge(null);
        setMfaCode('');
        setActiveTenantId(typeof u.tenantId === 'string' ? u.tenantId : null);
        try { await guardTenants(); } catch { return; /* picker opened (bootstrap contract) */ }
        await onAuthed({ name: u.name, role: u.role, email: u.email });
        navigate(returnTo, { replace: true });
        return;
      }
      const expired = body.mfaRequired === true;
      setMfaCode('');
      if (expired) {
        /* the 5-minute challenge token lapsed — start the sign-in over */
        setMfaChallenge(null);
        setError('The sign-in attempt expired — enter your password again.');
        return;
      }
      setError(typeof body.error === 'string' && body.error ? body.error : 'That code did not verify.');
    } catch (e: unknown) {
      /* network failure / abort: the challenge is still valid — stay on the panel */
      setMfaCode('');
      setError(friendly((e as Error)?.message ?? 'could not reach the server — try again'));
    } finally {
      setBusy(false);
    }
  };

  /* L5-4.1: the school was chosen. Behavior depends on where the picker came
     from (see tenantPickSource) — every path is a REAL attempt against a
     real door; failures surface, never silently swallowed. */
  const pickTenant = async (m: PickSchool) => {
    setBusy(true); setError(null);
    try {
      if (tenantPickSource === 'authed') {
        /* a bootstrap session exists (server alternative contract): the
           switch door re-issues (audited) and may answer mustChange — the
           AuthGate gate screen takes over, exactly like the login 403 path. */
        const r = await switchTenant(m.tenantId, pickPw || undefined);
        setToken(r.token);
        setTenantPick(null);
        if (r.mustChange) {
          navigate(`/account/password?reason=forced${returnTo !== '/today' ? `&return=${encodeURIComponent(returnTo)}` : ''}`, { replace: true });
          return;
        }
        await onAuthed({ name: r.user.name, role: r.user.role, email: r.user.email });
        navigate(returnTo, { replace: true });
        return;
      }
      if (tenantPickSource === 'password') {
        /* re-login against the chosen school. The tenantId param is pending
           on the server (blocks.md — the OTP doors already accept it); until
           it lands the attempt 409s again and the server's own guidance is
           shown — no fiction, no silent pick. */
        const { status, body } = await loginFull(email.trim(), password, m.tenantId);
        if (status === 409 && body.multiTenant === true) {
          setError(typeof body.error === 'string' && body.error ? body.error : 'sign-in failed');
          setBusy(false);
          return;
        }
        const session = await handleLoginResponse(status, body);
        setTenantPick(null);
        setScopedTenantId(null);
        await onAuthed(session);
        navigate(returnTo, { replace: true });
        return;
      }
      if (tenantPickSource === 'otp') {
        /* the request door already accepts a tenantId scope — re-request for
           the chosen school, then continue to the code entry step for real. */
        const { status, body } = await otpRequestFull(phone.trim(), m.tenantId);
        if (status !== 200) {
          throw new Error(typeof body.error === 'string' && body.error ? body.error : 'could not send the code');
        }
        setScopedTenantId(m.tenantId);
        setOtpSent(true);
        setDevCode(typeof body.devCode === 'string' ? body.devCode : null);
        setTenantPick(null);
        setBusy(false);
        throw new Error('__stage__'); // control-flow: show the code entry step
      }
      /* 'otp-verify': the verify door accepts the scope too — verify now. */
      if (!code || code.length !== 6) { throw new Error('enter the 6-digit code first'); }
      const { status, body } = await otpVerifyFull(phone.trim(), code, m.tenantId);
      if (status !== 200 || typeof body.token !== 'string') {
        throw new Error(typeof body.error === 'string' && body.error ? body.error : 'sign-in failed');
      }
      setToken(body.token);
      setTenantPick(null);
      setScopedTenantId(null);
      const u = body.user as { name: string; role: string; email: string };
      await onAuthed({ name: u.name, role: u.role, email: u.email });
      navigate(returnTo, { replace: true });
    } catch (e: unknown) {
      const err = e as Error & { passwordRequired?: boolean };
      if (err.message === '__stage__') { /* control flow — show the code step */ }
      else if (err.passwordRequired) { setPwNeeded(true); fail('Enter your current password to switch schools.'); }
      else fail(friendly(err?.message || 'could not switch school'));
    } finally {
      setBusy(false);
    }
  };

  const cancelTenantPick = () => {
    /* review MAJOR: when a session token was already issued for this browser
       (the 'authed' bootstrap path), cancelling must revoke it server-side —
       the HttpOnly cookie lives ~13h otherwise. Preauth 409 sources never
       got a session; clearing local state is the whole truth there. */
    if (tenantPickSource === 'authed') {
      void (async () => {
        try { const live = await import('../services/liveApi'); await live.apiLogoutAudit(); } catch { /* best-effort */ }
        setToken(null);
      })();
    } else {
      setToken(null);
    }
    setActiveTenantId(null);
    setTenantPick(null);
    setScopedTenantId(null);
    setError(null);
  };

  const requestOtp = () => {
    if (!phone) return fail('phone number required');
    run(async () => {
      const { status, body } = await otpRequestFull(phone.trim(), scopedTenantId ?? undefined);
      if (status === 409 && body.multiTenant === true && Array.isArray(body.schools)) {
        setTenantPick(body.schools as PickSchool[]);
        setTenantPickSource('otp');
        setBusy(false);
        throw new Error('__stage__');
      }
      if (status !== 200) throw new Error(typeof body.error === 'string' && body.error ? body.error : 'could not send the code');
      setOtpSent(true); setDevCode(typeof body.devCode === 'string' ? body.devCode : null); setBusy(false);
      throw new Error('__stage__'); // control-flow: stay on page, show code entry
    });
  };
  const verifyOtp = () => {
    if (!code || code.length !== 6) return fail('enter the 6-digit code');
    run(async () => {
      const { status, body } = await otpVerifyFull(phone.trim(), code, scopedTenantId ?? undefined);
      if (status === 409 && body.multiTenant === true && Array.isArray(body.schools)) {
        setTenantPick(body.schools as PickSchool[]);
        setTenantPickSource('otp-verify');
        setBusy(false);
        throw new Error('__stage__');
      }
      if (status !== 200 || typeof body.token !== 'string') {
        throw new Error(typeof body.error === 'string' && body.error ? body.error : 'sign-in failed');
      }
      setToken(body.token);
      const u = body.user as { name: string; role: string; email: string; tenantId?: string };
      setActiveTenantId(typeof u.tenantId === 'string' ? u.tenantId : null);
      await guardTenants();
      return { name: u.name, role: u.role, email: u.email };
    });
  };

  /* T303 (§A9/§9.13): the Google tab previously called apiGoogleDemo — a demo
     door that fabricates a session for any email (audit P0-2 family). The
     button now renders disabled with honest copy; no sign-in is simulated. */

  useEffect(() => { setError(null); setOtpSent(false); setCode(''); }, [method]);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div className="logo-mark">S</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>SchoolOS</div>
            <div style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{t('login.title', { fallback: "Sign in to your school's workspace" })}</div>
          </div>
        </div>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5, margin: '10px 0 18px' }}>
          {t('login.subtitle', { fallback: 'The intelligent operating system for schools. Sign in to continue.' })}
        </p>

        {/* shared error line — visible for BOTH the method panels and the
            second-factor panel (review MINOR: the aria-describedby target must
            exist in whichever branch shows an error) */}
        {error && error !== '__stage__' && (
          <div id="login-error" className="login-error" role="alert"><Icon.Alert size={13} /> {error}</div>
        )}

        {/* L5-3.1: second-factor panel — replaces the method tabs while an MFA
            challenge is open. Accepts an authenticator code or a single-use
            recovery code (the server tries TOTP first). */}
        {tenantPick ? (
          <div role="form" aria-label={t('login.tenant.title', { fallback: 'Choose a school' })} className="login-form">
            <div className="u-small" style={{ color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.55 }}>
              {t('login.tenant.hint', { fallback: 'This account belongs to {count} schools. Choose which one to open — your role can differ per school.', count: tenantPick.length })}
            </div>
            {pwNeeded && (
              <label>{t('login.tenant.password', { fallback: 'Your current password' })}
                <input type="password" autoComplete="current-password" value={pickPw} onChange={e => setPickPw(e.target.value)} placeholder="••••••••" autoFocus />
              </label>
            )}
            {tenantPick.map(m => (
              <button key={m.tenantId} type="button" className="btn btn-ghost" disabled={busy}
                style={{ width: '100%', justifyContent: 'space-between', border: '1px solid var(--border)' }}
                onClick={() => void pickTenant(m)}>
                <span style={{ fontWeight: 600 }}>{m.name}</span>
                <span className="u-small u-muted">{m.role}{m.tenantId === activeTenantId ? ` · ${t('login.tenant.here', { fallback: 'signed in here' })}` : ''}</span>
              </button>
            ))}
            <button type="button" className="btn btn-ghost" disabled={busy} style={{ width: '100%', justifyContent: 'center' }} onClick={cancelTenantPick}>
              {t('login.tenant.back', { fallback: 'Back to sign-in' })}
            </button>
          </div>
        ) : mfaChallenge ? (
          <form role="form" aria-label="Two-step verification" className="login-form" onSubmit={e => { e.preventDefault(); void submitMfa(); }}>
            <div className="u-small" style={{ color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.55 }}>
              Enter the 6-digit code from your authenticator app — or one of your single-use recovery codes.
            </div>
            <label>{t('login.mfa.title', { fallback: 'Verification code' })}
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/[^\w]/g, ''))} placeholder="••••••" required autoFocus aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} />
            </label>
            <button className="btn btn-primary" disabled={busy || !mfaCode.trim()} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Verifying…' : t('login.mfa.verify', { fallback: 'Verify & sign in' })}
            </button>
            <button type="button" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setMfaChallenge(null); setMfaCode(''); setError(null); }}>{t('login.mfa.back', { fallback: 'Back to sign-in' })}</button>
          </form>
        ) : (
        <>
        <div className="seg" role="tablist" aria-label="Sign-in method" id="login-seg">
          {segTabs.map(tb => (
            <button
              key={tb.id}
              ref={el => { segBtnRefs.current[tb.id] = el; }}
              role="tab"
              id={`seg-tab-${tb.id}`}
              aria-controls={`login-seg-panel-${tb.id}`}
              aria-selected={method === tb.id}
              tabIndex={method === tb.id ? 0 : -1}
              className={method === tb.id ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setMethod(tb.id)}
              onKeyDown={onSegKeyDown}
            >{tb.label}</button>
          ))}
        </div>

        {method === 'password' && (
          <form role="tabpanel" id="login-seg-panel-password" aria-labelledby="seg-tab-password" className="login-form" onSubmit={e => { e.preventDefault(); submitPassword(); }}>
            <label>{t('login.email', { fallback: 'Email' })}
              <input type="email" aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@school.edu" /* eslint-disable-line jsx-a11y/no-autofocus -- auth entry point: focus intentionally moves to the login form on mount */ autoFocus />
            </label>
            <label>{t('login.password', { fallback: 'Password' })}
              <input type="password" aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </label>
            <button className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Signing in…' : t('login.signIn', { fallback: 'Sign in' })}
            </button>
          </form>
        )}

        {method === 'phone' && (
          <form role="tabpanel" id="login-seg-panel-phone" aria-labelledby="seg-tab-phone" className="login-form" onSubmit={e => { e.preventDefault(); if (otpSent) verifyOtp(); else requestOtp(); }}>
            <label>{t('login.phone', { fallback: 'Phone number' })}
              <input type="tel" aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98450 00101" disabled={otpSent} /* eslint-disable-line jsx-a11y/no-autofocus -- phone step: focus intentionally moves to the phone field when the step mounts */ autoFocus={!otpSent} />
            </label>
            {otpSent && (
              <>
                <label>6-digit code <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· expires in 5 min</span>
                  <input inputMode="numeric" aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" /* eslint-disable-line jsx-a11y/no-autofocus -- otp step: focus intentionally moves to the 6-digit code field when the code is requested */ autoFocus />
                </label>
                {devCode && <div className="login-devcode"><Badge tone="warning">dev mode</Badge> SMS provider not wired — code: <b>{devCode}</b></div>}
                <button type="button" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setOtpSent(false); setCode(''); setDevCode(null); }}>
                  Change number / resend
                </button>
              </>
            )}
            <button className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Working…' : otpSent ? 'Verify & sign in' : 'Send code'}
            </button>
          </form>
        )}

        {method === 'google' && (
          <div role="tabpanel" id="login-seg-panel-google" aria-labelledby="seg-tab-google" className="login-form">
            <button className="btn google-btn" disabled aria-disabled="true" style={{ width: '100%', justifyContent: 'center' }}>
              <GoogleG /> Continue with Google
            </button>
            <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 10 }}>
              Google sign-in is not configured for this school yet — the button is disabled. Use email + password or phone + OTP.
            </p>
          </div>
        )}
        </>)
        }

        <div className="login-foot">
          <Icon.Shield size={12} /> Protected by tenancy-isolated sessions · every sign-in is written to the audit trail
        </div>
        {/* self-serve signup (Platform §1.1): owners start their school here */}
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 13 }}>
          Starting a new school? <Link to="/onboard" style={{ color: 'var(--accent-text)', fontWeight: 600 }}>Set it up here</Link>
        </div>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z"/>
    </svg>
  );
}
