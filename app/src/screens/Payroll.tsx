/* ============================================================
   Payroll-lite — the month's salaries, without a payroll vendor.

   What this proves: every salary for the month is computed from
   the staff member's stored structure, and paying out is a
   separate, auditable step — never part of computing.

   Doors: GET /payroll/overview (all), PUT /payroll/staff/:id and
   POST /payroll/runs (owner/finance_head), POST /payroll/runs/:id/
   disburse (owner/finance_head). Finance clerks read.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, DataTable, Empty, ErrorState, Modal, PageHead, Section, SkeletonCard, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useRoleOrGrant } from '../lib/access';
import { friendly } from '../lib/friendlyErrors';
import { fmtMoney } from '../lib/format';
import { payrollDisburse, payrollOverview, payrollSaveStructure, payrollStartRun, type PayrollRun, type PayrollStaff } from '../services/complianceApi';

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
const runTone = (s: string): 'success' | 'info' | 'warning' | 'outline' =>
  s === 'disbursed' || s === 'paid' ? 'success' : s === 'ready' || s === 'computed' ? 'info' : s === 'draft' ? 'warning' : 'outline';

export default function Payroll() {
  const toast = useToast();
  const canRead = useRoleOrGrant(['owner', 'finance_head', 'finance_clerk'], ['GET /payroll/overview']);
  const canWrite = useRoleOrGrant(['owner', 'finance_head'], ['POST /payroll/runs']);

  const pay = useAsync(() => payrollOverview(), []);
  const [month, setMonth] = useState('2026-10');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PayrollStaff | null>(null);
  const [struct, setStruct] = useState({ monthly: '', bankAcct: '', pan: '' });
  const [disbursing, setDisbursing] = useState<PayrollRun | null>(null);
  const [disburse, setDisburse] = useState({ mode: '', ref: '' });
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);

  if (!canRead) {
    return (
      <Card>
        <Empty icon={<Icon.Wallet size={24} />} title="Payroll is not for your role"
          sub="Salaries are the owner and finance lane — the head runs them, clerks read them." />
      </Card>
    );
  }

  const staff = pay.data?.staff ?? [];
  const runs = pay.data?.runs ?? [];
  const monthlyTotal = staff.reduce((a, s) => a + (s.monthlyCents ?? 0), 0);
  const latest = runs[0];

  const openEdit = (s: PayrollStaff) => {
    setEditing(s);
    setStruct({ monthly: String((s.monthlyCents ?? 0) / 100), bankAcct: '', pan: '' });
  };

  const saveStructure = async () => {
    if (!editing) return;
    const monthly = Number(struct.monthly);
    if (!Number.isFinite(monthly) || monthly <= 0) { toast({ title: 'Enter the monthly salary in rupees', tone: 'info' }); return; }
    setBusy(true);
    try {
      await payrollSaveStructure(editing.id, {
        monthlyCents: Math.round(monthly * 100),
        ...(struct.bankAcct.trim() ? { bankAcct: struct.bankAcct.trim() } : {}),
        ...(struct.pan.trim() ? { pan: struct.pan.trim() } : {}),
      });
      toast({ title: 'Salary structure saved', sub: `${editing.name} · ${fmtMoney(monthly)} a month.`, tone: 'success' });
      setEditing(null);
      pay.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const startRun = async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) { toast({ title: 'Pick the month', sub: 'Year and month, e.g. 2026-10.', tone: 'info' }); return; }
    setBusy(true);
    try {
      const r = await payrollStartRun(month);
      setSkipped(r.skipped ?? []);
      toast({
        title: `Pay run ready — ${month}`,
        sub: `${(r.payslips ?? []).length} payslip${(r.payslips ?? []).length === 1 ? '' : 's'} computed${(r.skipped ?? []).length ? `, ${(r.skipped ?? []).length} skipped (listed below).` : ', nobody skipped.'} Nothing has been paid yet.`,
        tone: 'success',
      });
      pay.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

    /* ECS proof file: office-only download, audited server-side on every fetch. Full bank
     accounts ride this file — handle it like cash, upload it to the bank, then delete it. */
  const downloadEcs = async (r: PayrollRun) => {
    setBusy(true);
    try {
      const { LIVE_BASE, authHeaders } = await import('../services/liveApi');
      const res = await fetch(`${LIVE_BASE}/payroll/runs/${encodeURIComponent(r.id)}/ecs-file`, { headers: { ...authHeaders() } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error ?? `Download failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ecs-${r.month}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast({ title: `ECS file — ${r.month}`, sub: 'Audited download. Upload to the bank, then delete the file.', tone: 'success' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const disburseRun = async () => {
    if (!disbursing) return;    if (!disburse.mode.trim()) { toast({ title: 'Say how it was paid', sub: 'e.g. bank transfer, with the reference below.', tone: 'info' }); return; }
    if (!disburse.ref.trim()) { toast({ title: 'Enter the payment reference', tone: 'info' }); return; }
    setBusy(true);
    try {
      const r = await payrollDisburse(disbursing.id, { mode: disburse.mode.trim(), ref: disburse.ref.trim() });
      toast({ title: `Paid out — ${r.run.month}`, sub: `${rupees(r.run.totalCents)} disbursed · ${disburse.ref.trim()}.`, tone: 'success' });
      setDisbursing(null);
      setDisburse({ mode: '', ref: '' });
      pay.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <PageHead
        title="Payroll"
        sub="What this proves: every salary for the month is computed from the staff member's stored structure, and paying out is a separate, auditable step."
      />

      {pay.loading ? (
        <div className="grid grid-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : pay.error ? (
        <ErrorState title="Could not read payroll" sub={friendly(pay.error)} onRetry={pay.retry} />
      ) : (
        <>
          <div className="grid grid-4" style={{ marginBottom: 20 }}>
            <Stat label="Pay month" value={pay.data?.month ?? month} sub="The month on the desk" />
            <Stat label="Staff on payroll" value={staff.length} sub="With a stored structure" />
            <Stat label="Monthly total" value={rupees(monthlyTotal)} sub="Sum of stored structures" />
            <Stat label="Latest run" value={latest ? latest.status : 'None yet'} sub={latest ? `${latest.month} · ${rupees(latest.totalCents)}` : 'No pay run computed'} />
          </div>

          <Section title="Staff & structures" sub="The salary each person is computed from. Bank details show as last-four only — the full account is write-only.">
            <Card pad={false}>
              <DataTable<PayrollStaff>
                columns={[
                  { key: 'name', label: 'Staff', render: s => <span style={{ fontWeight: 570 }}>{s.name}</span> },
                  { key: 'role', label: 'Role', render: s => <span className="u-small u-muted">{s.role}</span> },
                  { key: 'monthly', label: 'Monthly', align: 'right', render: s => <span className="tnum">{rupees(s.monthlyCents)}</span> },
                  { key: 'bank', label: 'Bank', render: s => <span className="u-small mono">{s.bankLast4 ? `···· ${s.bankLast4}` : <span className="u-faint">—</span>}</span> },
                  ...(canWrite ? [{
                    key: 'act', label: '', width: 90, render: (s: PayrollStaff) => (
                      <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>Edit</Button>
                    ),
                  }] : []),
                ]}
                rows={staff}
                rowKey={s => s.id}
                empty={<Empty title="Nobody is on the payroll yet" sub="Staff appear here once the owner records their salary structures." />}
              />
            </Card>
          </Section>

          <Section title="Pay runs" sub="Computing is step one; paying out is step two, with its own reference.">
            {canWrite && (
              <Card pad>
                <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
                  <label className="u-small">Month
                    <input className="input" type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ display: 'block', marginTop: 4 }} />
                  </label>
                  <Button variant="primary" disabled={busy} onClick={startRun}>{busy ? 'Computing…' : 'Compute this month'}</Button>
                  <span className="u-xs u-faint">Staff without a stored structure are skipped by name, never silently.</span>
                </div>
              </Card>
            )}
            <div style={{ height: 12 }} />
            <Card pad={false}>
              <DataTable<PayrollRun>
                columns={[
                  { key: 'month', label: 'Month', render: r => <span className="mono u-small">{r.month}</span> },
                  { key: 'status', label: 'State', render: r => <Badge tone={runTone(r.status)}>{r.status}</Badge> },
                  { key: 'total', label: 'Total', align: 'right', render: r => <span className="tnum">{rupees(r.totalCents)}</span> },
                  { key: 'slips', label: 'Payslips', align: 'right', render: r => <span className="tnum">{r.payslips ?? '—'}</span> },
                  ...(canWrite ? [{
                    key: 'act', label: '', width: 110, render: (r: PayrollRun) => (
                      r.status === 'disbursed' || r.status === 'paid' ? (
                        <span className="u-flex" style={{ gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <span className="u-xs u-faint">paid out</span>
                          <Button size="sm" variant="ghost" onClick={() => downloadEcs(r)}>ECS file</Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => { setDisbursing(r); setDisburse({ mode: '', ref: '' }); }}>Disburse</Button>
                      )
                    ),
                  }] : []),
                ]}
                rows={runs}
                rowKey={r => r.id}
                empty={<Empty title={`No pay run for ${month} yet`} sub="Compute the month and every staff member with a stored structure gets a payslip." />}
              />
            </Card>
            {skipped.length > 0 && (
              <div className="u-small" role="status" style={{ marginTop: 10 }}>
                <span style={{ fontWeight: 620 }}>Skipped in the last computation: </span>
                {skipped.map(s => `${s.name} — ${s.reason}`).join(' · ')}
              </div>
            )}
          </Section>
        </>
      )}

      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title={editing ? `Salary structure — ${editing.name}` : 'Salary structure'}
        sub="Monthly pay drives the computation. Bank account and PAN replace what is stored; they are never read back."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={saveStructure}>{busy ? 'Saving…' : 'Save structure'}</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <label className="u-xs">Monthly salary (₹)
            <input className="input" type="number" min={1} value={struct.monthly} onChange={e => setStruct(s => ({ ...s, monthly: e.target.value }))} style={{ width: '100%', marginTop: 4 }} />
          </label>
          <label className="u-xs">Bank account (replaces stored)
            <input className="input" value={struct.bankAcct} onChange={e => setStruct(s => ({ ...s, bankAcct: e.target.value }))} style={{ width: '100%', marginTop: 4 }} placeholder="Left blank, the stored account stands" autoComplete="off" />
          </label>
          <label className="u-xs">PAN (replaces stored)
            <input className="input" value={struct.pan} onChange={e => setStruct(s => ({ ...s, pan: e.target.value }))} style={{ width: '100%', marginTop: 4 }} placeholder="Left blank, the stored PAN stands" autoComplete="off" />
          </label>
        </div>
      </Modal>

      <Modal
        open={disbursing != null}
        onClose={() => setDisbursing(null)}
        title={disbursing ? `Disburse — ${disbursing.month}` : 'Disburse'}
        sub={disbursing ? `${rupees(disbursing.totalCents)} across ${disbursing.payslips ?? '—'} payslips. This records money leaving the school.` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisbursing(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={disburseRun}>{busy ? 'Recording…' : 'Record the payout'}</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <label className="u-xs">Paid how
            <input className="input" value={disburse.mode} onChange={e => setDisburse(d => ({ ...d, mode: e.target.value }))} style={{ width: '100%', marginTop: 4 }} placeholder="e.g. bank transfer" />
          </label>
          <label className="u-xs">Payment reference
            <input className="input" value={disburse.ref} onChange={e => setDisburse(d => ({ ...d, ref: e.target.value }))} style={{ width: '100%', marginTop: 4 }} placeholder="UTR / cheque no. / voucher no." />
          </label>
        </div>
      </Modal>
    </div>
  );
}
