/* ============================================================
   Login — the front door. Email+password, phone+OTP, Google SSO.
   Shown whenever there is no valid session. All three methods run
   against the live API — the server is the only authentication brain.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { apiLogin, apiRequestOtp, apiVerifyOtp, apiGoogleDemo } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { Icon } from '../components/Icon';
import { Badge } from '../components/ui';

type Method = 'password' | 'phone' | 'google';
/* Display-only credential cheat-sheet. Authentication always hits the server. */
const ROLES = [
  { email: 'principal@meridian.edu', role: 'Principal', name: 'Dr. Meera Krishnan' },
  { email: 'owner@meridian.edu', role: 'Owner', name: 'Vikram Mehta' },
  { email: 'itadmin@meridian.edu', role: 'IT Admin', name: 'Sam Dsouza' },
  { email: 'teacher@meridian.edu', role: 'Teacher', name: 'Priya Iyer' },
  { email: 'coordinator@meridian.edu', role: 'Coordinator', name: 'Rahul Verma' },
  { email: 'finance@meridian.edu', role: 'Finance', name: 'Ms. Rao' },
  { email: 'admissions@meridian.edu', role: 'Admissions', name: 'Sneha Kulkarni' },
  { email: 'transport@meridian.edu', role: 'Transport', name: 'Rajeev Nair' },
  { email: 'facilities@meridian.edu', role: 'Facilities', name: 'Vikram Joshi' },
  { email: 'technician@meridian.edu', role: 'Technician', name: 'Arif Shaikh' },
  { email: 'parent@meridian.edu', role: 'Parent', name: 'Kavita Sharma' },
  { email: 'student@meridian.edu', role: 'Student', name: 'Aarav Sharma' },
];

export interface SessionUser { name: string; role: string; email: string }
export default function Login({ onAuthed }: { onAuthed: (session: SessionUser) => Promise<void> | void }) {
  const [method, setMethod] = useState<Method>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Seg tablist a11y (unit 3): roving tabindex + arrow/Home/End keys.
     Handling and attributes only — arrows perform the same selection a
     click performs (setMethod); no submit, no auth logic, no extra state. */
  const segTabs: { id: Method; label: string }[] = [
    { id: 'password', label: 'Email' },
    { id: 'phone', label: 'Phone' },
    { id: 'google', label: 'Google' },
  ];
  const segBtnRefs = useRef<Record<Method, HTMLButtonElement | null>>({ password: null, phone: null, google: null });
  const segKeyNav = useRef(false);
  const onSegKeyDown = (e: React.KeyboardEvent) => {
    const idx = segTabs.findIndex(t => t.id === method);
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
  const run = async (fn: () => Promise<{ name: string; role: string; email: string }>) => {
    setBusy(true); setError(null);
    try { await onAuthed(await fn()); } catch (e: unknown) { fail(friendly((e as Error).message || 'sign-in failed')); }
  };

  const submitPassword = () => {
    if (!email || !password) return fail('email and password required');
    run(async () => {
      const r = await apiLogin(email.trim(), password);
      return { name: r.user.name, role: r.user.role, email: r.user.email };
    });
  };

  const requestOtp = () => {
    if (!phone) return fail('phone number required');
    run(async () => {
      const r = await apiRequestOtp(phone.trim());
      setOtpSent(true); setDevCode(r.devCode ?? null); setBusy(false);
      throw new Error('__stage__'); // control-flow: stay on page, show code entry
    });
  };
  const verifyOtp = () => {
    if (!code || code.length !== 6) return fail('enter the 6-digit code');
    run(async () => {
      const r = await apiVerifyOtp(phone.trim(), code);
      return { name: r.user.name, role: r.user.role, email: r.user.email };
    });
  };
  const googleSignIn = () => {
    run(async () => {
      const r = await apiGoogleDemo(email.trim() || 'principal@meridian.edu');
      return { name: r.user.name, role: r.user.role, email: r.user.email };
    });
  };

  useEffect(() => { setError(null); setOtpSent(false); setCode(''); }, [method]);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div className="logo-mark">S</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>SchoolOS</div>
            <div style={{ color: 'var(--text-2)', fontSize: 12.5 }}>Meridian International Academy</div>
          </div>
        </div>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5, margin: '10px 0 18px' }}>
          The intelligent operating system for schools. Sign in to continue.
        </p>

        <div className="seg" role="tablist" aria-label="Sign-in method" id="login-seg">
          {segTabs.map(t => (
            <button
              key={t.id}
              ref={el => { segBtnRefs.current[t.id] = el; }}
              role="tab"
              id={`seg-tab-${t.id}`}
              aria-controls={`login-seg-panel-${t.id}`}
              aria-selected={method === t.id}
              tabIndex={method === t.id ? 0 : -1}
              className={method === t.id ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setMethod(t.id)}
              onKeyDown={onSegKeyDown}
            >{t.label}</button>
          ))}
        </div>

        {error && error !== '__stage__' && (
          <div id="login-error" className="login-error" role="alert"><Icon.Alert size={13} /> {error}</div>
        )}

        {method === 'password' && (
          <form role="tabpanel" id="login-seg-panel-password" aria-labelledby="seg-tab-password" className="login-form" onSubmit={e => { e.preventDefault(); submitPassword(); }}>
            <label>Email
              <input type="email" aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@school.edu" /* eslint-disable-line jsx-a11y/no-autofocus -- auth entry point: focus intentionally moves to the login form on mount */ autoFocus />
            </label>
            <label>Password
              <input type="password" aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </label>
            <button className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {method === 'phone' && (
          <form role="tabpanel" id="login-seg-panel-phone" aria-labelledby="seg-tab-phone" className="login-form" onSubmit={e => { e.preventDefault(); if (otpSent) verifyOtp(); else requestOtp(); }}>
            <label>Phone number
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
            <button className="btn google-btn" disabled={busy} onClick={googleSignIn} style={{ width: '100%', justifyContent: 'center' }}>
              <GoogleG /> Continue with Google
            </button>
            <label style={{ marginTop: 10 }}>School email <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· must match your SchoolOS account</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="principal@meridian.edu" />
            </label>
            <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 10 }}>
              Google OAuth runs server-side (/auth/google/start · /callback). Sign in with your school Google account.
            </p>
          </div>
        )}

        <div className="login-roles">
          <div className="login-roles-title">Try SchoolOS: pick a role</div>
          <div className="login-roles-grid">
            {ROLES.map(r => (
              <button key={r.email} className="login-role" onClick={() => { setMethod('password'); setEmail(r.email); setPassword('schoolos-demo'); }}>
                <b>{r.role}</b><span>{r.name}</span>
                <code>{r.email}</code>
              </button>
            ))}
          </div>
          <div className="login-hint">Password for all: <code>schoolos-demo</code> · phone logins use the numbers below</div>
          <details className="login-phones">
            <summary>Phone numbers (OTP method)</summary>
            <div className="login-phones-grid">
              {[['Principal', '+919845000101'], ['Coordinator', '+919845000102'], ['Finance', '+919845000103'], ['Admissions', '+919845000104'], ['Transport', '+919845000105'], ['Facilities', '+919845000106'], ['Technician', '+919845000107'], ['Teacher', '+919845000108'], ['IT Admin', '+919845000109'], ['Parent', '+919845000201'], ['Student', '+919845000202'], ['Owner', '+919845000301']].map(([r, p]) => (
                <button key={p} className="login-role" onClick={() => { setMethod('phone'); setPhone(p); }}>
                  <b>{r}</b><code>{p}</code>
                </button>
              ))}
            </div>
          </details>
        </div>

        <div className="login-foot">
          <Icon.Shield size={12} /> Protected by tenancy-isolated sessions · every sign-in is written to the audit trail
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
