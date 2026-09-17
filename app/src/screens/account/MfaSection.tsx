/* ============================================================
   MfaSection — L5-3.1. Staff two-factor enrollment UI inside
   Settings → Account security. Pairs the server doors from
   L2-3.2 (app.js): POST /me/mfa/enroll → { secret, otpauth };
   POST /me/mfa/verify { code } (bearer session) → { enabled,
   recoveryCodes } — codes are shown ONCE here.

   Honest-status notes (D-6, updated after D-37 landed):
   · GET /me now exposes mfa_enrolled_at (D-37(d)) — the section
     reads the REAL state on mount and shows the on/off truth;
     if /me fails, the state is shown as unknown, never guessed;
   · POST /me/mfa/disable {password} (D-37(d)) powers the Turn-off
     flow — password re-authentication, wrong password keeps MFA on;
   · all calls go through a local full-response post — the shared
     call() treats a 401 (wrong code/password) as a dead session and
     would bounce the user to /login, which is wrong for a form
     error inside a settings panel.
   ============================================================ */
import { useEffect, useState } from 'react';
import { LIVE_BASE, getToken } from '../../services/liveApi';
import { Icon } from '../../components/Icon';
import { Badge, Button, useToast } from '../../components/ui';
import { friendly } from '../../lib/friendlyErrors';
import { t } from '../../i18n';

/* Full-response POST with the same transport behavior as liveApi's call()
   (review MINOR): same-origin requests carry cookies + the CSRF header so
   this keeps working when the cookie-only session flow lands (L2-3.1);
   bearer-authed requests are CSRF-exempt server-side today. */
const SAME_ORIGIN = (() => {
  try { return new URL(LIVE_BASE, window.location.origin).origin === window.location.origin; } catch { return false; }
})();

function readCsrf(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === 'schoolos_csrf') return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

async function mfaPost(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const t = getToken();
  const csrf = readCsrf();
  const res = await fetch(`${LIVE_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    ...(SAME_ORIGIN ? { credentials: 'same-origin' as RequestCredentials } : {}),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'enrolling'; otpauth: string; secret: string }
  | { kind: 'recovery'; codes: string[] }
  | { kind: 'disabling' };

export type MfaEnrolled = boolean | null; // null = unknown (state fetch failed)

export default function MfaSection() {
  const toast = useToast();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState<MfaEnrolled>(null);
  const [disablePassword, setDisablePassword] = useState('');

  /* D-37(d): /me carries mfa_enrolled_at — the only MFA fact the server
     exposes. A failed fetch leaves the state unknown (null): the UI then
     claims neither "on" nor "off" — it offers setup with the replace
     warning, which is truthful in both states. */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const token = getToken();
        const csrf = readCsrf();
        const res = await fetch(`${LIVE_BASE}/me`, {
          headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
          ...(SAME_ORIGIN ? { credentials: 'same-origin' as RequestCredentials } : {}),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok && live) {
          const data = (await res.json()) as { mfa_enrolled_at?: string | null };
          setEnrolled(data.mfa_enrolled_at ? true : false);
        } else if (live) setEnrolled(null);
      } catch { if (live) setEnrolled(null); }
    })();
    return () => { live = false; };
  }, [stage.kind === 'idle']);

  const confirmDisable = async () => {
    if (!disablePassword) return;
    setBusy(true); setError(null);
    try {
      const { status, data } = await mfaPost('/me/mfa/disable', { password: disablePassword });
      if (status === 200) {
        setDisablePassword('');
        setStage({ kind: 'idle' });
        setEnrolled(false);
        toast({ title: t('mfa.turnOff') + ' — done', sub: 'Two-step verification is off: the authenticator factor, recovery codes and the enrollment record were removed. The change is in the audit log.', tone: 'info' });
        return;
      }
      const msg = friendly((data.error as string) ?? 'could not turn off two-step');
      setError(msg);
      toast({ title: 'Two-step stays on', sub: msg, tone: 'error' });
    } catch (e: unknown) {
      const msg = friendly((e as Error)?.message ?? 'could not reach the server');
      setError(msg);
      toast({ title: 'Two-step stays on', sub: msg, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const startEnroll = async () => {
    setBusy(true); setError(null);
    try {
      const { status, data } = await mfaPost('/me/mfa/enroll', {});
      if (status !== 200) {
        const msg = friendly((data.error as string) ?? 'could not start enrollment');
        setError(msg);
        toast({ title: 'Enrollment not started', sub: msg, tone: 'error' });
        return;
      }
      setStage({ kind: 'enrolling', otpauth: String(data.otpauth ?? ''), secret: String(data.secret ?? '') });
    } catch (e: unknown) {
      const msg = friendly((e as Error)?.message ?? 'could not reach the server');
      setError(msg);
      toast({ title: 'Enrollment not started', sub: msg, tone: 'error' });
    } finally {
      setBusy(false); /* review MINOR: never leave the button stuck on a network error */
    }
  };

  const confirmCode = async () => {
    if (!code.trim()) return;
    setBusy(true); setError(null);
    try {
      const { status, data } = await mfaPost('/me/mfa/verify', { code: code.trim() });
      if (status !== 200) {
        const msg = friendly((data.error as string) ?? 'that code did not verify');
        setError(msg);
        toast({ title: 'Code not accepted', sub: msg, tone: 'error' });
        return;
      }
      const codes = Array.isArray(data.recoveryCodes) ? (data.recoveryCodes as string[]) : [];
      setCode('');
      setStage({ kind: 'recovery', codes });
    } catch (e: unknown) {
      const msg = friendly((e as Error)?.message ?? 'could not reach the server');
      setError(msg);
      toast({ title: 'Code not accepted', sub: msg, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${what} copied`, tone: 'success' });
    } catch {
      toast({ title: 'Copy failed', sub: 'Select the text and copy it manually.', tone: 'error' });
    }
  };

  /* pretty-print the secret in 4-char groups for manual entry */
  const grouped = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

  return (
    <div className="u-col" style={{ gap: 10 }}>
      {stage.kind === 'idle' && (
        <>
          {enrolled === true && (
            <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
              <Badge tone="success" dot>{t('mfa.onBadge')}</Badge>
              <span className="u-small u-muted">{t('mfa.onSub')}</span>
            </div>
          )}
          <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>
            {enrolled === true ? t('mfa.replace.copy') : t('mfa.idle.copy', { replace: t('mfa.idle.replace') })}
          </div>
          {error && <div role="alert" className="u-small" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div className="u-flex" style={{ gap: 8 }}>
            <Button size="sm" variant="secondary" icon={<Icon.Shield size={13} />} disabled={busy} onClick={() => void startEnroll()}>
              {busy ? t('mfa.starting') : t('mfa.setup')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || enrolled !== true}
              title={enrolled === false ? 'Two-step is not on for this account.' : undefined}
              onClick={() => { setDisablePassword(''); setStage({ kind: 'disabling' }); }}>
              {t('mfa.turnOff')}
            </Button>
          </div>
        </>
      )}

      {stage.kind === 'disabling' && (
        <div className="u-col" style={{ gap: 8 }}>
          <div className="u-small" style={{ background: 'var(--warning-weak)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 12px', lineHeight: 1.55 }}>
            {t('mfa.disable.warn')}
          </div>
          <form className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); void confirmDisable(); }}>
            <input className="input" type="password" autoComplete="current-password" style={{ maxWidth: 280 }}
              placeholder={t('mfa.disable.placeholder')} aria-label={t('mfa.disable.placeholder')}
              value={disablePassword} onChange={e => setDisablePassword(e.target.value)} />
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !disablePassword}>
              {busy ? t('mfa.turningOff') : t('mfa.turnOff')}
            </button>
            <Button size="sm" variant="ghost" onClick={() => { setStage({ kind: 'idle' }); setError(null); }}>{t('mfa.cancel')}</Button>
          </form>
        </div>
      )}

      {stage.kind === 'enrolling' && (
        <div className="u-col" style={{ gap: 10 }}>
          <div className="u-small" style={{ lineHeight: 1.6 }}>
            {t('mfa.enroll.copy')}
          </div>
          <div className="u-col" style={{ gap: 6 }}>
            <span className="u-xs u-faint">{t('mfa.uriLabel')}</span>
            <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
              <code className="u-mono u-xs" style={{ wordBreak: 'break-all', flex: 1, background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 'var(--r-md)' }}>{stage.otpauth}</code>
              <Button size="sm" variant="ghost" icon={<Icon.File size={12} />} onClick={() => void copy(stage.otpauth, 'URI')}>Copy</Button>
            </div>
          </div>
          <div className="u-col" style={{ gap: 6 }}>
            <span className="u-xs u-faint">{t('mfa.secretLabel')}</span>
            <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
              <code className="u-mono u-small" style={{ flex: 1, background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 'var(--r-md)', letterSpacing: '0.08em' }}>{grouped(stage.secret)}</code>
              <Button size="sm" variant="ghost" icon={<Icon.File size={12} />} onClick={() => void copy(stage.secret, 'Secret')}>Copy</Button>
            </div>
          </div>
          {error && <div role="alert" className="u-small" style={{ color: 'var(--danger)' }}>{error}</div>}
          <form className="u-flex" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); void confirmCode(); }}>
            <input
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              placeholder={t('mfa.codePlaceholder', { fallback: '6-digit code (or a recovery code)' })}
              aria-label="Authenticator code"
              value={code}
              onChange={e => setCode(e.target.value)}
              style={{ maxWidth: 280 }}
            />
            <button className="btn btn-primary btn-sm" disabled={busy || !code.trim()} type="submit">
              {busy ? 'Verifying…' : t('mfa.confirm')}
            </button>
            <Button size="sm" variant="ghost" onClick={() => { setStage({ kind: 'idle' }); setCode(''); setError(null); }}>{t('mfa.cancel')}</Button>
          </form>
        </div>
      )}

      {stage.kind === 'recovery' && (
        <div className="u-col" style={{ gap: 10 }}>
          <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
            <Badge tone="success" dot>{t('mfa.onBadge')}</Badge>
            <span className="u-small u-muted">{t('mfa.onSub')}</span>
          </div>
          <div className="u-small" style={{ background: 'var(--warning-weak)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 12px', lineHeight: 1.55 }}>
            {t('mfa.recoveryWarn', { count: stage.codes.length })}
          </div>
          <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {stage.codes.map(c => <code key={c} className="u-mono u-small" style={{ background: 'var(--surface-2)', padding: '6px 9px', borderRadius: 'var(--r-md)' }}>{grouped(c)}</code>)}
          </div>
          <div>
            <Button size="sm" variant="secondary" icon={<Icon.File size={12} />} onClick={() => void copy(stage.codes.join('\n'), 'Recovery codes')}>{t('mfa.copyAll')}</Button>
          </div>
          <div>
            <Button size="sm" variant="primary" onClick={() => { setEnrolled(true); setStage({ kind: 'idle' }); }}>{t('mfa.done')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
