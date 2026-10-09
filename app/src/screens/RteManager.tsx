/* ============================================================
   RTE manager — the Right to Education quota desk.

   What this proves: the 25% quota is filled by lottery import,
   and every rupee claimed from the state is tracked to receipt.

   Doors: GET /rte/overview (all), POST /rte/lottery/import and
   POST /rte/reimbursements (admissions/owner/principal/
   coordinator; IT admin reads).
   ============================================================ */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, DataTable, Empty, ErrorState, PageHead, Section, SkeletonCard, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useRoleOrGrant } from '../lib/access';
import { friendly } from '../lib/friendlyErrors';
import { fmtMoney } from '../lib/format';
import { rteImportLottery, rteOverview, rteRecordReimbursement, type RteImportReport, type RteLotteryRow } from '../services/complianceApi';

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

const rupees = (cents: number) => fmtMoney((cents ?? 0) / 100);

/* One pupil per line: name, dob (YYYY-MM-DD), gender, guardian name,
   guardian phone, category, grade — e.g.
   Aarav Sharma, 2020-04-11, boy, Ramesh Sharma, 9811000000, EWS, Nursery */
function parseLottery(text: string): { rows: RteLotteryRow[]; errors: string[] } {
  const rows: RteLotteryRow[] = [];
  const errors: string[] = [];
  text.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const parts = t.split(',').map(p => p.trim());
    if (parts.length !== 7) { errors.push(`Line ${i + 1}: expected 7 comma-separated values, found ${parts.length}.`); return; }
    const [name, dob, gender, guardianName, guardianPhone, category, grade] = parts as [string, string, string, string, string, string, string];
    if (!name) { errors.push(`Line ${i + 1}: name is empty.`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) { errors.push(`Line ${i + 1}: date of birth must be YYYY-MM-DD.`); return; }
    rows.push({ name, dob, gender, guardianName, guardianPhone, category, grade });
  });
  return { rows, errors };
}

export default function RteManager() {
  const toast = useToast();
  const canRead = useRoleOrGrant(['admissions', 'owner', 'principal', 'coordinator', 'itadmin'], ['GET /rte/overview']);
  const canWrite = useRoleOrGrant(['admissions', 'owner', 'principal', 'coordinator', 'itadmin'], ['POST /rte/lottery/import']);

  const rte = useAsync(() => rteOverview(), []);
  const [year, setYear] = useState('2026-27');
  const [lottery, setLottery] = useState('');
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const [report, setReport] = useState<RteImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState({ academicYear: '2026-27', amount: '', claimRef: '', status: 'claimed' });

  if (!canRead) {
    return (
      <Card>
        <Empty icon={<Icon.Users size={24} />} title="RTE records are not for your role"
          sub="The quota desk is the admissions office, owner, principal, coordinator and IT admin lane." />
      </Card>
    );
  }

  const seats = rte.data?.seats;
  const money = rte.data?.reimbursements;
  const recent = rte.data?.recent ?? [];

  const doImport = async () => {
    const { rows, errors } = parseLottery(lottery);
    setLocalErrors(errors);
    if (errors.length) { toast({ title: `${errors.length} line${errors.length === 1 ? '' : 's'} need fixing`, sub: errors[0], tone: 'info' }); return; }
    if (!rows.length) { toast({ title: 'Nothing to import', sub: 'Paste one pupil per line first.', tone: 'info' }); return; }
    if (!year.trim()) { toast({ title: 'Name the academic year', sub: 'e.g. 2026-27.', tone: 'info' }); return; }
    setBusy(true);
    try {
      const r = await rteImportLottery(year.trim(), rows);
      setReport(r);
      setLottery('');
      toast({
        title: r.imported.length ? `${r.imported.length} admission${r.imported.length === 1 ? '' : 's'} recorded by lottery` : 'Nothing was admitted',
        sub: r.failed.length ? `${r.failed.length} row${r.failed.length === 1 ? '' : 's'} refused — listed below, nothing half-written.` : 'Every row passed.',
        tone: r.failed.length && !r.imported.length ? 'info' : 'success',
      });
      rte.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const doClaim = async () => {
    const amt = Number(claim.amount);
    if (!claim.academicYear.trim()) { toast({ title: 'Name the academic year', tone: 'info' }); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toast({ title: 'Enter the claim amount in rupees', tone: 'info' }); return; }
    if (!claim.claimRef.trim()) { toast({ title: 'Enter the claim reference', sub: 'The reference on the form sent to the state.', tone: 'info' }); return; }
    setBusy(true);
    try {
      await rteRecordReimbursement({
        academicYear: claim.academicYear.trim(),
        amountCents: Math.round(amt * 100),
        claimRef: claim.claimRef.trim(),
        status: claim.status === 'received' ? 'received' : 'claimed',
      });
      toast({ title: claim.status === 'received' ? 'Receipt recorded' : 'Claim recorded', sub: `${rupees(Math.round(amt * 100))} · ${claim.claimRef.trim()}.`, tone: 'success' });
      setClaim(c => ({ ...c, amount: '', claimRef: '' }));
      rte.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <PageHead
        title="RTE admissions"
        sub="What this proves: the 25% quota is filled by lottery, and every rupee claimed from the state is tracked to receipt."
      />

      {rte.loading ? (
        <div className="grid grid-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : rte.error ? (
        <ErrorState title="Could not read the quota desk" sub={friendly(rte.error)} onRetry={rte.retry} />
      ) : (
        <>
          <div className="grid grid-4" style={{ marginBottom: 20 }}>
            <Stat label="Quota" value={`${rte.data?.quotaPct ?? 25}%`} sub={`Entry grades: ${(rte.data?.entryGrades ?? []).join(', ') || '—'}`} />
            <Stat label="Seats filled" value={seats ? `${seats.filled}/${seats.reserved}` : '—'} sub={seats ? `${seats.total} seats in entry grades` : 'No seat count yet'} />
            <Stat label="Claimed" value={money ? rupees(money.claimed_cents) : '—'} sub="Asked from the state" />
            <Stat label="Received" value={money ? rupees(money.received_cents) : '—'} sub={money ? `${rupees(money.pending_cents)} still pending` : 'Nothing recorded'} />
          </div>

          {canWrite && (
            <Section title="Lottery import" sub="Paste the draw result — one pupil per line. Nothing is written until every line parses; refused rows come back named.">
              <Card pad>
                <div className="u-col" style={{ gap: 10 }}>
                  <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
                    <label className="u-small">Academic year
                      <input className="input" value={year} onChange={e => setYear(e.target.value)} placeholder="2026-27" style={{ display: 'block', marginTop: 4, minWidth: 120 }} />
                    </label>
                    <Button variant="primary" icon={<Icon.Plus size={14} />} disabled={busy} onClick={doImport}>
                      {busy ? 'Importing…' : 'Import the draw'}
                    </Button>
                  </div>
                  <label className="u-small u-muted" htmlFor="rte-paste">name, dob (YYYY-MM-DD), gender, guardian name, guardian phone, category, grade</label>
                  <textarea id="rte-paste" className="input" rows={5} style={{ width: '100%' }} value={lottery}
                    onChange={e => setLottery(e.target.value)}
                    placeholder="Aarav Sharma, 2020-04-11, boy, Ramesh Sharma, 9811000000, EWS, Nursery" />
                  {localErrors.length > 0 && (
                    <div role="alert" className="u-small" style={{ color: 'var(--danger-text)' }}>
                      {localErrors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                      {localErrors.length > 5 && <div>…and {localErrors.length - 5} more.</div>}
                    </div>
                  )}
                  {report && (
                    <div className="u-small" role="status">
                      {report.imported.length > 0 && (
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ fontWeight: 620 }}>Admitted: </span>
                          {report.imported.map(p => `${p.name} (${p.admissionNo})`).join(', ')}
                        </div>
                      )}
                      {report.failed.length > 0 && (
                        <div role="alert" style={{ color: 'var(--danger-text)' }}>
                          <span style={{ fontWeight: 620 }}>Refused: </span>
                          {report.failed.map(f => `row ${f.row} — ${f.error}`).join(' · ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </Section>
          )}

          <Section title="Reimbursements" sub="Claims sent to the state, and what actually arrived. A claim and its receipt are two separate records.">
            <div className="grid grid-2" style={{ alignItems: 'start' }}>
              <Card pad={false}>
                <DataTable<Record<string, unknown>>
                  columns={[
                    { key: 'who', label: 'Pupil', render: r => <span style={{ fontWeight: 570 }}>{String(r.name ?? r.admission_no ?? r.admissionNo ?? r.id ?? '—')}</span> },
                    { key: 'grade', label: 'Grade', render: r => <span className="u-small u-muted">{String(r.grade ?? '—')}</span> },
                    { key: 'status', label: 'State', render: r => r.status ? <Badge tone={String(r.status) === 'admitted' ? 'success' : 'outline'}>{String(r.status)}</Badge> : <span className="u-faint">—</span> },
                  ]}
                  rows={recent}
                  rowKey={r => String(r.id ?? r.admission_no ?? r.admissionNo ?? JSON.stringify(r))}
                  empty={<Empty title="No RTE admissions yet" sub="Admitted pupils appear here once the first lottery draw is imported." />}
                />
              </Card>
              {canWrite ? (
                <Card head="Record a claim or receipt" sub="The amount moves in rupees; the door stores paise.">
                  <div className="u-col" style={{ gap: 10 }}>
                    <div className="grid grid-2" style={{ gap: 10 }}>
                      <label className="u-xs">Academic year
                        <input className="input" value={claim.academicYear} onChange={e => setClaim(c => ({ ...c, academicYear: e.target.value }))} style={{ width: '100%', marginTop: 4 }} />
                      </label>
                      <label className="u-xs">Amount (₹)
                        <input className="input" type="number" min={1} value={claim.amount} onChange={e => setClaim(c => ({ ...c, amount: e.target.value }))} style={{ width: '100%', marginTop: 4 }} placeholder="e.g. 85000" />
                      </label>
                    </div>
                    <div className="grid grid-2" style={{ gap: 10 }}>
                      <label className="u-xs">Claim reference
                        <input className="input" value={claim.claimRef} onChange={e => setClaim(c => ({ ...c, claimRef: e.target.value }))} style={{ width: '100%', marginTop: 4 }} placeholder="As filed with the state" />
                      </label>
                      <label className="u-xs">This is a…
                        <select className="input" value={claim.status} onChange={e => setClaim(c => ({ ...c, status: e.target.value }))} style={{ width: '100%', marginTop: 4 }}>
                          <option value="claimed">Claim sent</option>
                          <option value="received">Money received</option>
                        </select>
                      </label>
                    </div>
                    <div><Button variant="primary" disabled={busy} onClick={doClaim}>{busy ? 'Recording…' : 'Record it'}</Button></div>
                  </div>
                </Card>
              ) : (
                <Card pad><Empty title="Claims are recorded by the office" sub="You can read the quota position; the admissions desk records claims and receipts." size="sm" /></Card>
              )}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
