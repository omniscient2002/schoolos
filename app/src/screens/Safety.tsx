/* ============================================================
   Safety audit — the NCPCR-mapped checklist wall plus the police
   verification ledger for every account-holding staff member.

   Two honesties this screen holds:
     · The checklist is MAPPED to the NCPCR/MoE safety-manual headings —
       it is not a lawyer's certificate. Coverage for a specific board still
       needs the school's lawyer to confirm, and the screen says so.
     · Verification EXPIRY blocks the duty roster (the HR desk shows who is
       blocked and why); a MISSING record warns but never blocks, so a school
       that never recorded anything is nagged, not locked out day one.
   Contract drivers without accounts stay on the transport attendant roster
   (police_verified_on there); this ledger is the account-holding staff.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, DataTable, Empty, ErrorState, PageHead, Section, SkeletonCard, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useRoleOrGrant } from '../lib/access';
import { friendly } from '../lib/friendlyErrors';
import { roleLabel } from '../lib/labels';
import {
  safetyChecklist, safetyAttest, verificationsList, verificationsRecord,
  type SafetyCheck, type SafetyScore, type StaffVerification,
} from '../services/complianceApi';

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: unknown }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: e }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

const STATE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'outline'> = {
  valid: 'success', expiring: 'warning', expired: 'danger', missing: 'outline', done: 'success', open: 'warning',
};
const STATE_LABEL: Record<string, string> = {
  valid: 'Verified', expiring: 'Expiring ≤60d', expired: 'Expired — off the roster', missing: 'Not on file', done: 'Attested', open: 'Open',
};

export default function Safety() {
  const toast = useToast();
  const canRead = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator', 'counselor'], ['GET /safety/checklist']);
  const canAttest = useRoleOrGrant(['owner', 'principal', 'itadmin'], ['POST /safety/checks/:id/attest']);
  const canReadLedger = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator'], ['GET /staff-verifications']);
  const canRecord = useRoleOrGrant(['owner', 'principal', 'itadmin'], ['POST /staff-verifications']);

  const wall = useAsync(() => (canRead ? safetyChecklist() : Promise.resolve({ checks: [] as SafetyCheck[], score: { total: 0, done: 0, pct: null } as SafetyScore })), [canRead]);
  const ledger = useAsync(() => (canReadLedger ? verificationsList() : Promise.resolve({ day: '', staff: [] as StaffVerification[] })), [canReadLedger]);
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ userId: '', verifiedOn: '', validYears: '3', note: '' });

  if (!canRead && !canReadLedger) {
    return (
      <div>
        <PageHead title="Safety audit" sub="The school's protection wall and who is verified to stand behind it." />
        <Card pad><Empty icon={<Icon.Lock size={22} />} title="Not for your role" sub="The safety audit is the principal's office and the coordination desk." /></Card>
      </div>
    );
  }

  const score = wall.data?.score;
  const attest = async (c: SafetyCheck, done: boolean) => {
    setBusy(true);
    try {
      const ev = (evidence[c.id] ?? '').trim();
      await safetyAttest(c.id, done, ev || undefined);
      toast({ title: done ? `Attested — ${c.title}` : `Reopened — ${c.title}`, sub: done ? 'Attestations are history; reopening stays possible.' : undefined, tone: 'success' });
      setEvidence(e => ({ ...e, [c.id]: '' }));
      wall.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const record = async () => {
    if (!form.userId) { toast({ title: 'Pick a staff member first', tone: 'info' }); return; }
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(form.verifiedOn)) { toast({ title: 'Verified-on must be YYYY-MM-DD', tone: 'info' }); return; }
    const years = Number(form.validYears);
    if (!Number.isInteger(years) || years < 1 || years > 10) { toast({ title: 'Validity must be 1–10 years', tone: 'info' }); return; }
    setBusy(true);
    try {
      const r = await verificationsRecord({ userId: form.userId, verifiedOn: form.verifiedOn, validYears: years,
        ...(form.note.trim() ? { note: form.note.trim() } : {}) });
      toast({ title: 'Verification recorded', sub: `Valid till ${r.verification.expires_on}. Expiry keeps them off the duty roster.`, tone: 'success' });
      setForm({ userId: '', verifiedOn: '', validYears: '3', note: '' });
      ledger.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const blocked = (ledger.data?.staff ?? []).filter(s => s.state === 'expired');
  const missing = (ledger.data?.staff ?? []).filter(s => s.state === 'missing');

  return (
    <div>
      <PageHead
        title="Safety audit"
        sub="The protection wall (mapped to the NCPCR/MoE safety-manual headings) and the police-verification ledger behind it. The wall is a working checklist — coverage for your board still needs your lawyer's confirm."
      />

      {canRead ? (
        <Section title="Protection wall" sub="Twelve items. Attesting is history — reopening stays possible, deleting does not exist.">
          {wall.loading ? <SkeletonCard lines={5} />
            : wall.error ? <ErrorState title="Could not read the wall" sub={friendly(wall.error)} onRetry={wall.retry} />
              : (
                <>
                  <div className="grid grid-3" style={{ marginBottom: 16 }}>
                    <Stat label="Attested" value={`${score?.done ?? 0}/${score?.total ?? 0}`} sub="Items with evidence on record" />
                    <Stat label="Score" value={score?.pct == null ? '—' : `${score.pct}%`} sub="Attested share of the wall" />
                    <Stat label="Blocked from duty" value={blocked.length} sub="Verification expired — see the ledger" />
                  </div>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {(wall.data?.checks ?? []).map(c => (
                      <Card key={c.id} pad headAs="h3" head={<span>{c.title} <Badge tone={STATE_TONE[c.status]} dot>{STATE_LABEL[c.status]}</Badge></span>}
                        sub={c.detail}
                        actions={canAttest ? (
                          <Button variant={c.status === 'done' ? 'ghost' : 'secondary'} size="sm" disabled={busy}
                            onClick={() => attest(c, c.status !== 'done')}>{busy ? '…' : c.status === 'done' ? 'Reopen' : 'Attest'}</Button>
                        ) : undefined}>
                        {c.status === 'done' && c.evidence ? <div className="u-xs u-muted" style={{ marginBottom: 8 }}>Evidence: {c.evidence}</div> : null}
                        {c.status === 'done' && c.checked_on ? <div className="u-xs u-faint">Attested {c.checked_on}</div> : null}
                        {canAttest && c.status !== 'done' ? (
                          <input className="input" value={evidence[c.id] ?? ''} onChange={e => setEvidence(v => ({ ...v, [c.id]: e.target.value }))}
                            placeholder="Evidence (optional) — e.g. committee list displayed at the gate" aria-label={`Evidence for ${c.title}`}
                            style={{ marginTop: 8 }} maxLength={500} />
                        ) : null}
                      </Card>
                    ))}
                  </div>
                </>
              )}
        </Section>
      ) : null}

      {canReadLedger ? (
        <Section title="Police-verification ledger" sub="Every account-holding staff member, one row each. Expiry keeps them off the duty roster; a missing record warns but never blocks.">
          {ledger.loading ? <SkeletonCard lines={4} />
            : ledger.error ? <ErrorState title="Could not read the ledger" sub={friendly(ledger.error)} onRetry={ledger.retry} />
              : (
                <>
                  {blocked.length > 0 && (
                    <Card pad style={{ marginBottom: 12, borderColor: 'var(--status-critical)' }}>
                      <div style={{ fontWeight: 620, marginBottom: 6 }}>{blocked.length} staff off the duty roster</div>
                      <div className="u-small u-muted">{blocked.map(b => `${b.name} (${roleLabel(b.role)})`).join(' · ')} — re-verify below to bring them back.</div>
                    </Card>
                  )}
                  <Card pad={false}>
                    <DataTable<StaffVerification>
                      columns={[
                        { key: 'name', label: 'Staff', render: s => <span style={{ fontWeight: 570 }}>{s.name}</span> },
                        { key: 'role', label: 'Role', render: s => <span className="u-small u-muted">{roleLabel(s.role)}</span> },
                        { key: 'state', label: 'Verification', render: s => <Badge tone={STATE_TONE[s.state]} dot>{STATE_LABEL[s.state]}</Badge> },
                        { key: 'expiresOn', label: 'Valid till', render: s => <span className="u-small tnum">{s.expiresOn ?? '—'}</span> },
                      ]}
                      rows={ledger.data?.staff ?? []}
                      rowKey={s => s.userId}
                      empty={<Empty title="Nobody on the roster" sub="Staff accounts appear here once the school provisions them." />}
                    />
                  </Card>
                  {missing.length > 0 && <div className="u-xs u-faint" style={{ marginTop: 8 }}>{missing.length} without a record — warned, not blocked. Record them below.</div>}
                  {canRecord ? (
                    <Card pad style={{ marginTop: 12 }} headAs="h3" head="Record a verification" sub="Police clearance date + validity. The door computes the expiry; re-recording supersedes.">
                      <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
                        <label className="u-small">Staff member
                          <select className="input" value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))} aria-label="Staff member" style={{ minWidth: 200, display: 'block', marginTop: 4 }}>
                            <option value="">Choose…</option>
                            {(ledger.data?.staff ?? []).map(s => <option key={s.userId} value={s.userId}>{s.name} · {roleLabel(s.role)}</option>)}
                          </select>
                        </label>
                        <label className="u-small">Verified on
                          <input className="input" type="date" value={form.verifiedOn} onChange={e => setForm(f => ({ ...f, verifiedOn: e.target.value }))} aria-label="Verified on" style={{ display: 'block', marginTop: 4 }} />
                        </label>
                        <label className="u-small">Valid (years)
                          <input className="input" inputMode="numeric" value={form.validYears} onChange={e => setForm(f => ({ ...f, validYears: e.target.value }))} aria-label="Validity in years" style={{ display: 'block', marginTop: 4, maxWidth: 90 }} />
                        </label>
                        <label className="u-small">Note (optional)
                          <input className="input" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="e.g. District police clearance" aria-label="Note" style={{ display: 'block', marginTop: 4, minWidth: 220 }} maxLength={500} />
                        </label>
                        <Button variant="primary" disabled={busy || !form.userId} onClick={record}>{busy ? 'Recording…' : 'Record verification'}</Button>
                      </div>
                    </Card>
                  ) : null}
                </>
              )}
        </Section>
      ) : null}
    </div>
  );
}
