/* Settings — the librarian owns the desk policy: loan periods, borrowing limits, holds, fines and every
   notification setting. The identifier/catalog scheme stays with the owner/principal (shown as a note). */
import { useEffect, useState } from 'react';
import { Card, Button, ErrorState, SkeletonCard, Section, useToast } from '../../../components/ui';
import { friendly } from '../../../lib/friendlyErrors';
import { libraryDeskSettingsGet, libraryDeskSettingsSave, type LibraryDeskSettings } from '../../../services/adminApi';

type Form = Record<string, string | boolean>;

const NUM = [
  ['default_loan_days', 'Default loan period (days)'],
  ['loan_days_student', 'Students — loan period (days)'],
  ['loan_days_teacher', 'Teachers — loan period (days)'],
  ['loan_days_staff', 'Staff — loan period (days)'],
  ['max_loans_student', 'Students — max books out'],
  ['max_loans_teacher', 'Teachers — max books out'],
  ['max_loans_staff', 'Staff — max books out'],
  ['renewal_limit', 'Renewals allowed per loan'],
  ['renewal_days', 'Renewal extension (days)'],
  ['max_reservations', 'Max open reservations per borrower'],
  ['reservation_hold_days', 'Hold collection window (days)'],
  ['max_open_acquisition_requests', 'Max open book requests per borrower'],
  ['grace_days', 'Grace days before a fine starts'],
  ['fine_per_day_cents', 'Fine per day (₹)'],
  ['fine_cap_cents', 'Fine cap (₹)'],
  ['lost_charge_percent', 'Lost book charge (% of price)'],
  ['damage_charge_cents', 'Damage charge (₹)'],
  ['overdue_repeat_days', 'Overdue reminder every (days)'],
] as const;
const BOOL = [
  ['allow_self_reserve', 'Borrowers may reserve titles themselves'],
  ['allow_acquisition_requests', 'Borrowers may request books to buy'],
  ['acquisition_votes', 'Requests collect votes'],
  ['allow_fine_waiver', 'Fines may be waived'],
  ['notify_parent', 'Notify parents for student borrowers'],
] as const;
const MONEY = new Set(['fine_per_day_cents', 'fine_cap_cents', 'damage_charge_cents']);

const toForm = (s: LibraryDeskSettings): Form => {
  const f: Form = {};
  for (const [k] of NUM) {
    const v = (s as Record<string, unknown>)[k];
    if (typeof v === 'number') f[k] = MONEY.has(k) ? String(v / 100) : String(v);
  }
  for (const [k] of BOOL) if (typeof (s as Record<string, unknown>)[k] === 'boolean') f[k] = (s as Record<string, unknown>)[k] as boolean;
  f.due_reminder_days_before = (s.due_reminder_days_before ?? []).join(', ');
  f.notify_channels = (s.notify_channels ?? []).join(', ');
  f.quiet_hours_ist = (s.quiet_hours_ist ?? []).join(', ');
  return f;
};

export default function Settings() {
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false; setError(null);
    libraryDeskSettingsGet().then((r) => { if (!dead) setForm(toForm(r.settings ?? {})); }).catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, []);

  const set = (k: string, v: string | boolean) => setForm((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      for (const [k] of NUM) {
        const raw = form[k];
        if (raw === '' || raw == null) continue;
        body[k] = MONEY.has(k) ? Math.round(Number(raw) * 100) : Math.round(Number(raw));
      }
      for (const [k] of BOOL) if (typeof form[k] === 'boolean') body[k] = form[k];
      const nums = (v: unknown) => String(v ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n));
      body.due_reminder_days_before = nums(form.due_reminder_days_before);
      body.notify_channels = String(form.notify_channels ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      /* QUIET-1: quiet_hours_ist must be exactly [startHour, endHour]. An EMPTY box used
         to become `[0]` (Number('') === 0) — a one-element array — so simply not touching
         the optional "Quiet hours" field failed the whole save with
         "quiet_hours_ist must be [startHour, endHour] (0–23)" and NONE of the other 20
         settings on this screen were persisted. Only send a pair, and only when there is one. */
      const quiet = nums(form.quiet_hours_ist).slice(0, 2);
      if (quiet.length === 2) body.quiet_hours_ist = quiet;
      else delete body.quiet_hours_ist;
      await libraryDeskSettingsSave(body as Partial<LibraryDeskSettings>);
      toast({ title: 'Library settings saved', sub: 'New loans and fines follow this policy from now on.', tone: 'success' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  if (error) return <ErrorState title="Could not load settings" sub={error.replace('Error: ', '')} />;
  if (!form) return <SkeletonCard />;

  const num = (k: string, label: string) => (
    <label key={k} style={{ fontSize: 13 }}>{label}
      <input type="number" min={0} value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value)} aria-label={label} />
    </label>
  );
  const bool = (k: string, label: string) => (
    <label key={k} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="checkbox" checked={!!form[k]} onChange={(e) => set(k, e.target.checked)} /> {label}
    </label>
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <Card headAs="h2" head="Loan policy" sub="How long books stay out, and how many a borrower may hold">
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          {NUM.slice(0, 12).map(([k, l]) => num(k, l))}
        </div>
      </Card>

      <Card headAs="h2" head="Fines">
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          {NUM.slice(12).map(([k, l]) => num(k, l))}
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {BOOL.filter(([k]) => k === 'allow_fine_waiver').map(([k, l]) => bool(k, l))}
        </div>
      </Card>

      <Card headAs="h2" head="Holds and requests">
        <div style={{ display: 'grid', gap: 8 }}>
          {BOOL.filter(([k]) => k !== 'allow_fine_waiver' && k !== 'notify_parent').map(([k, l]) => bool(k, l))}
        </div>
      </Card>

      <Card headAs="h2" head="Notifications">
        <Section title="Reminders" sub="Applies to every borrower; parents are notified for students.">
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label style={{ fontSize: 13 }}>Days before due (comma-separated)
              <input value={String(form.due_reminder_days_before ?? '')} onChange={(e) => set('due_reminder_days_before', e.target.value)} placeholder="2, 1" aria-label="Days before due" />
            </label>
            <label style={{ fontSize: 13 }}>Channels (in_app, sms, whatsapp, email)
              <input value={String(form.notify_channels ?? '')} onChange={(e) => set('notify_channels', e.target.value)} placeholder="in_app" aria-label="Channels" />
            </label>
            <label style={{ fontSize: 13 }}>Quiet hours (start, end — 24h)
              <input value={String(form.quiet_hours_ist ?? '')} onChange={(e) => set('quiet_hours_ist', e.target.value)} placeholder="21, 8" aria-label="Quiet hours" />
            </label>
          </div>
          <div style={{ marginTop: 8 }}>{BOOL.filter(([k]) => k === 'notify_parent').map(([k, l]) => bool(k, l))}</div>
        </Section>
      </Card>

      <Card headAs="h2" head="Identifier scheme">
        <div className="u-muted" style={{ fontSize: 13.5 }}>
          How books are labelled (accession / barcode / ISBN / QR, prefix, padding) is the school's catalog
          standard — the owner or principal sets it in <b>Add-ons → Library</b>. Ask them to change it.
        </div>
      </Card>

      <div><Button variant="primary" loading={busy} onClick={save}>Save library settings</Button></div>
    </div>
  );
}
