/* ============================================================
   ChangePassword — L5-2.1. Self-service password change at
   /account/password, with two modes:

   · mode="gate" — the forced flow. A provisioned-with-temp-password
     account (force_change, migration 046) signs in with a RESTRICTED
     session: the server answers the login with 403 + mustChange + a
     token whose `mustChange` claim the authenticate hook limits to
     /me/password, /me and /auth/logout (app.js:60-66). This screen is
     the only surface that session can reach; completing the change
     re-issues a full token in the same response (epoch bump revokes
     every OTHER session) and completes sign-in via onAuthed.

   · mode="page" — voluntary self-service for a signed-in user from
     Settings → Account security.

   Honest copy per D-6: 2xx → success toast; non-2xx → friendly(e);
   strength hints are local heuristics, never presented as server rules
   beyond the server-enforced minimum (≥ 8 chars, must differ).

   Review fixes (L5 self-review round): /me/password is called through a
   local full-response fetch — the shared call() treats the door's 401
   ("current password is not right") as a DEAD SESSION and would wipe the
   login + hard-redirect mid-form. Post-success steps (onAuthed/dataset/
   navigate) run OUTSIDE the api try so a hydration failure can never be
   reported as "password not changed" after the epoch bump already fired.
   ============================================================ */
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LIVE_BASE, setToken } from '../../services/liveApi';
import { friendly } from '../../lib/friendlyErrors';
import { t } from '../../i18n';
import { Card, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';

export interface GateSessionUser { name: string; role: string; email: string }

interface PasswordResponse {
  ok: boolean;
  token: string;
  mustChange: boolean;
  user: { id: string; name: string; role: string; email: string; tenantId: string };
}

/* Reads (without verifying — it is our own just-issued token) whether the
   stored session carries the server's `mustChange` restriction. Drives the
   AuthGate forced-flow redirect so a page reload on any route lands here
   instead of meeting 403s on every other door. */
export function sessionMustChange(): boolean {
  try {
    const t = localStorage.getItem('schoolos_token');
    if (!t) return false;
    const part = t.split('.')[1];
    if (!part) return false;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    /* UTF-8-safe base64 decode (review NIT: replaces deprecated escape()) */
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    const payload = JSON.parse(json) as { mustChange?: boolean };
    return payload.mustChange === true;
  } catch {
    return false;
  }
}

function strengthOf(pw: string): { label: string; tone: 'danger' | 'warning' | 'success'; note: string } {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (pw.length < 8) return { label: 'Too short', tone: 'danger', note: 'The server requires at least 8 characters.' };
  if (pw.length >= 12 && classes >= 3) return { label: 'Strong', tone: 'success', note: 'Long and mixed — good.' };
  if (pw.length >= 8 && classes >= 2) return { label: 'Acceptable', tone: 'warning', note: 'Longer or more character variety makes it stronger.' };
  return { label: 'Weak', tone: 'warning', note: 'Use at least two of: letters, numbers, symbols — or go longer.' };
}

export default function ChangePassword({ mode = 'page', onAuthed, onCancel }: {
  mode?: 'gate' | 'page';
  onAuthed?: (s: GateSessionUser) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const forced = mode === 'gate' || sessionMustChange();
  const returnTo = useMemo(() => {
    const raw = params.get('return');
    /* reject protocol-relative AND backslash forms (browsers normalize \ to /
       in authority parsing — review MINOR) */
    if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return mode === 'gate' ? '/today' : '/settings';
    return raw;
  }, [params, mode]);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* review MINOR: "Use a different account" during an in-flight change must
     not have its response install a fresh token afterwards. */
  const cancelledRef = useRef(false);

  const strength = strengthOf(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const same = next.length > 0 && next === current;
  const canSubmit = current.length > 0 && next.length >= 8 && !mismatch && !same && !busy;

  /* Local full-response fetch (review MAJOR): /me/password answers 401 for a
     wrong CURRENT password — an expected form error, not a dead session.
     The shared call() sweeps every non-/auth 401 (wipes token + redirects),
     which would log the user out for a typo. */
  const changePassword = async (): Promise<{ status: number; body: Partial<PasswordResponse> & { error?: string } }> => {
    const token = localStorage.getItem('schoolos_token');
    const res = await fetch(`${LIVE_BASE}/me/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<PasswordResponse> & { error?: string };
    return { status: res.status, body };
  };

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    /* --- api call only: its outcome is the only thing this try reports --- */
    let r: PasswordResponse;
    try {
      const { status, body } = await changePassword();
      if (status !== 200 || typeof body.token !== 'string' || !body.user) {
        const msg = friendly(body.error ?? `could not change password (HTTP ${status})`);
        setError(msg);
        toast({ title: t('pw.toast.notchanged.title'), sub: msg, tone: 'error' });
        setBusy(false);
        return;
      }
      r = body as PasswordResponse;
    } catch (e: unknown) {
      const msg = friendly((e as Error)?.message ?? 'could not reach the server');
      setError(msg);
      toast({ title: t('pw.toast.notchanged.title'), sub: msg, tone: 'error' });
      setBusy(false);
      return;
    }
    if (cancelledRef.current) { setBusy(false); return; }
    /* --- success is REAL from here: the epoch bump already signed out every
       other device; post-success steps report their own failures --- */
    setToken(r.token);
    setBusy(false);
    if (mode === 'gate') {
      try {
        await onAuthed?.({ name: r.user.name, role: r.user.role, email: r.user.email });
      } catch {
        /* workspace hydration failed after a real password change — say so
           instead of claiming the change failed (review MAJOR, D-6) */
        toast({ title: t('pw.toast.workspace.title'), sub: t('pw.toast.workspace.sub'), tone: 'info' });
      }
      navigate(returnTo, { replace: true });
    } else {
      toast({ title: t('pw.toast.changed.title'), sub: t('pw.toast.changed.sub'), tone: 'success' });
      navigate('/settings');
    }
  };

  return (
    <div className="login-wrap">
      <Card style={{ maxWidth: 460, margin: '0 auto', width: '100%' }}>
        <div className="u-col" style={{ padding: 'var(--s-5)', gap: 14 }}>
          <div className="u-col" style={{ gap: 4 }}>
            <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
              <Icon.Shield size={16} style={{ color: 'var(--accent-text)' }} />
              <span style={{ fontWeight: 700, fontSize: 18 }}>{t('pw.title')}</span>
            </div>
            <span className="u-small u-muted">
              {mode === 'gate'
                ? t('pw.gate.sub', { fallback: 'Your account was created with a temporary password.' })
                : t('pw.page.sub', { fallback: 'Change the password you use to sign in.' })}
            </span>
          </div>

          {forced && (
            <div role="status" className="u-small" style={{ background: 'var(--warning-weak)', border: '1px solid var(--warning-weak-2, var(--warning))', borderRadius: 'var(--r-md)', padding: '9px 12px', lineHeight: 1.55 }}>
              {t('pw.banner', { fallback: 'This session is limited to this page until the password is changed. Every other device signed in with the old credentials is signed out the moment you save.' })}
            </div>
          )}

          {error && (
            <div role="alert" className="u-small" style={{ background: 'var(--danger-weak, var(--warning-weak))', borderRadius: 'var(--r-md)', padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Icon.Alert size={13} /> {error}
            </div>
          )}

          <form className="u-col" style={{ gap: 12 }} onSubmit={e => { e.preventDefault(); void submit(); }}>
            <label>{t('pw.current')}
              <input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required autoFocus />
            </label>
            <label>{t('pw.next')}
              <input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" minLength={8} required aria-describedby="pw-strength" />
            </label>
            <div id="pw-strength" className="u-xs" style={{ color: `var(--${strength.tone === 'danger' ? 'danger' : strength.tone === 'warning' ? 'warning' : 'success'})` }} aria-live="polite">
              Strength: {next ? t('pw.strength.label', { label: strength.label, note: strength.note }) : t('pw.strength.empty')}
            </div>
            <label>{t('pw.confirm')}
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required aria-invalid={mismatch} aria-describedby={mismatch ? 'pw-mismatch' : undefined} />
            </label>
            {mismatch && <div id="pw-mismatch" className="u-xs" style={{ color: 'var(--danger)' }}>{t('pw.mismatch')}</div>}
            {same && <div className="u-xs" style={{ color: 'var(--danger)' }}>{t('pw.same')}</div>}
            <button className="btn btn-primary" disabled={!canSubmit} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? t('pw.saving') : t('pw.save')}
            </button>
          </form>

          {mode === 'gate' && (
            <div className="u-between u-small" style={{ gap: 10 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { cancelledRef.current = true; setToken(null); localStorage.removeItem('schoolos.session'); onCancel?.(); }}>{t('pw.otherAccount')}</button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
