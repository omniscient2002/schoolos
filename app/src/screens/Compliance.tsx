/* ============================================================
   Compliance — OPP-PRD-5. The compliance calendar: board returns,
   inspections, fire drills, DPDP audits. Live door GET /compliance;
   filing is POST /compliance/:id/file. No seed data.
   ============================================================ */
import { useEffect, useState } from 'react';
import { apiCompliance, apiCreateCompliance, apiFileCompliance } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Button, DataTable, Empty, ErrorState, Modal, Section, SkeletonCard, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate } from '../lib/format';
import { humanize, roleLabel, statusLabel } from '../lib/labels';

interface Item { id: string; kind: string; title: string; due_on: string; owner_role: string; status: string; evidence_ref?: string | null }
const KIND_LABEL: Record<string, string> = { board_return: 'Board return', inspection: 'Inspection', fire_drill: 'Fire drill', dpdp_audit: 'DPDP audit', certification: 'Certification', other: 'Other' };

/* Breach register (DPDP): owner/principal/IT admin record and contain. The 72-hour clock runs
   from found_on — contained without notified stays open until notification is recorded. */
function BreachCard() {
  const toast = useToast();
  const [rows, setRows] = useState<{ id: string; title: string; detail?: string; found_on: string; contained_on?: string | null; notified_on?: string | null; status: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', detail: '', foundOn: '' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    import('../services/complianceApi').then(({ breachList }) => breachList()
      .then(r => { if (live) setRows(r.breaches); })
      .catch(() => { if (live) setRows([]); }));
    return () => { live = false; };
  }, [tick]);
  const report = async () => {
    if (!form.title.trim() || !form.detail.trim() || !form.foundOn) { toast({ title: 'What, whose data, and when', tone: 'info' }); return; }
    setBusy(true);
    try {
      const { breachReport } = await import('../services/complianceApi');
      await breachReport({ title: form.title.trim(), detail: form.detail.trim(), foundOn: form.foundOn });
      toast({ title: 'Breach recorded', sub: 'The 72-hour clock is running.', tone: 'success' });
      setForm({ title: '', detail: '', foundOn: '' });
      setOpen(false);
      setTick(t => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const contain = async (id: string, notified: boolean) => {
    setBusy(true);
    try {
      const { breachContain } = await import('../services/complianceApi');
      const today = new Date().toISOString().slice(0, 10);
      await breachContain(id, notified
        ? { containedOn: today, notifiedOn: today }
        : { containedOn: today });
      toast({ title: notified ? 'Breach closed — notification recorded' : 'Breach contained', tone: 'success' });
      setTick(t => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Button variant="secondary" icon={<Icon.Alert size={14} />} onClick={() => setOpen(true)}>Record a breach</Button>
      </div>
      {rows == null ? <SkeletonCard lines={2} />
        : rows.length === 0 ? <Empty title="No breaches on record" sub="If personal data escapes the school's control, it lands here with its timeline." />
        : (
          <Card pad={false}>
            <DataTable<{ id: string; title: string; detail?: string; found_on: string; contained_on?: string | null; notified_on?: string | null; status: string }>
              columns={[
                { key: 'title', label: 'What', render: r => <div><div style={{ fontWeight: 570 }}>{r.title}</div><div className="u-xs u-faint">found {fmtDate(r.found_on)}</div></div> },
                { key: 'status', label: 'State', width: 130, render: r => <Badge tone={r.status === 'closed' ? 'success' : r.status === 'contained' ? 'warning' : 'danger'} dot>{statusLabel(r.status)}</Badge> },
                { key: 'act', label: '', width: 220, render: r => r.status === 'closed' ? <span className="u-xs u-faint">history</span> : (
                  <span className="u-flex" style={{ gap: 8 }}>
                    {r.status === 'open' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void contain(r.id, false); }}>Contain</Button>}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void contain(r.id, true); }}>Notify + close</Button>
                  </span>
                ) },
              ]}
              rows={rows}
              rowKey={r => r.id}
            />
          </Card>
        )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record a breach"
        sub="What happened and whose data — the clock starts at found-on."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" disabled={busy || !form.title.trim() || !form.detail.trim() || !form.foundOn} onClick={report}>
              {busy ? 'Recording…' : 'Record it'}
            </Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div>
            <label className="u-xs" htmlFor="br-title">What happened</label>
            <input id="br-title" className="input" style={{ width: '100%', marginTop: 5 }} value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Bus register printout left at the depot" />
          </div>
          <div>
            <label className="u-xs" htmlFor="br-detail">Whose data, and how</label>
            <textarea id="br-detail" className="input" rows={3} style={{ width: '100%', marginTop: 5 }} value={form.detail}
              onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} />
          </div>
          <div>
            <label className="u-xs" htmlFor="br-date">Found on</label>
            <input id="br-date" className="input" type="date" style={{ width: '100%', marginTop: 5 }} value={form.foundOn}
              onChange={e => setForm(f => ({ ...f, foundOn: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function Compliance() {
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState({ kind: 'board_return', title: '', dueOn: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    apiCompliance().then(r => { if (live) { setItems(r.items as unknown as Item[]); setError(null); } })
      .catch(e => { if (live) { setItems(null); setError(String(e)); } });
    return () => { live = false; };
  }, [tick]);

  const add = () => {
    if (!form.title || !form.dueOn) { toast({ title: 'Title and due date are required', tone: 'error' }); return; }
    setBusy(true);
    apiCreateCompliance(form)
      .then(r => { toast({ title: r.already ? 'That item already exists' : 'Compliance item added', tone: r.already ? 'info' : 'success' }); setForm({ kind: 'board_return', title: '', dueOn: '' }); setTick(t => t + 1); })
      .catch(e => toast({ title: 'Could not add item', sub: friendly(e), tone: 'error' }))
      .finally(() => setBusy(false));
  };
  const file = (id: string) => {
    apiFileCompliance(id)
      .then(() => { toast({ title: 'Marked filed', tone: 'success' }); setTick(t => t + 1); })
      .catch(e => toast({ title: 'Could not file', sub: friendly(e), tone: 'error' }));
  };

  const list = items ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const overdue = (d: string) => d < today;

  return (
    <>
      <PageHead title="Compliance calendar" sub="Statutory returns, inspections and drills — with a reminder before each due date." />

      <Section title="Add an item" style={{ marginBottom: 4 }}>
        <Card pad>
          <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
            <label className="u-small">Kind
              <select className="select" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} style={{ width: 160 }}>
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="u-small" style={{ flex: 1, minWidth: 200 }}>Title
              <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. UDISE+ annual return" style={{ width: '100%' }} />
            </label>
            <label className="u-small">Due
              <input className="input" type="date" value={form.dueOn} onChange={e => setForm(f => ({ ...f, dueOn: e.target.value }))} />
            </label>
            <Button variant="primary" disabled={busy} onClick={add}>Add</Button>
          </div>
        </Card>
      </Section>

      <Section title="Breach register" sub="What happened, whose data, found when — contained and notified on a visible 72-hour clock.">
        <BreachCard />
      </Section>

      <Section title="Calendar">
        {items == null && !error ? <SkeletonCard lines={4} />
          : error ? <ErrorState title="Could not load the compliance calendar" sub={friendly(error)} onRetry={() => setTick(t => t + 1)} />
          : list.length === 0 ? <Empty icon={<Icon.Calendar size={24} />} title="Nothing on the compliance calendar" sub="Add a statutory return, inspection or drill above." />
          : (
            <DataTable<Item>
              columns={[
                { key: 'title', label: 'Item', render: r => <div><div style={{ fontWeight: 570 }}>{r.title}</div><div className="u-xs u-faint">{KIND_LABEL[r.kind] ?? humanize(r.kind)} · {roleLabel(r.owner_role)}</div></div> },
                { key: 'due_on', label: 'Due', render: r => <span className={overdue(r.due_on) && r.status !== 'filed' ? 'u-danger' : ''}>{fmtDate(r.due_on)}</span> },
                { key: 'status', label: 'Status', render: r => <Badge tone={r.status === 'filed' ? 'success' : r.status === 'reminded' ? 'warning' : overdue(r.due_on) ? 'danger' : 'outline'} dot>{statusLabel(r.status)}</Badge> },
                { key: 'act', label: '', render: r => r.status === 'filed'
                  ? <span className="u-xs u-faint">filed{r.evidence_ref ? ` · ${r.evidence_ref}` : ''}</span>
                  : <Button size="sm" variant="secondary" onClick={() => file(r.id)}>Mark filed</Button> },
              ]}
              rows={list}
              rowKey={r => r.id}
            />
          )}
      </Section>
    </>
  );
}
