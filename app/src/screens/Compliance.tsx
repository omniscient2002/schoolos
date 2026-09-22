/* ============================================================
   Compliance — OPP-PRD-5. The compliance calendar: board returns,
   inspections, fire drills, DPDP audits. Live door GET /compliance;
   filing is POST /compliance/:id/file. No seed data.
   ============================================================ */
import { useEffect, useState } from 'react';
import { apiCompliance, apiCreateCompliance, apiFileCompliance } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Button, DataTable, Empty, ErrorState, Section, SkeletonCard, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

interface Item { id: string; kind: string; title: string; due_on: string; owner_role: string; status: string; evidence_ref?: string | null }
const KIND_LABEL: Record<string, string> = { board_return: 'Board return', inspection: 'Inspection', fire_drill: 'Fire drill', dpdp_audit: 'DPDP audit', certification: 'Certification', other: 'Other' };

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

      <Section title="Calendar">
        {items == null && !error ? <SkeletonCard lines={4} />
          : error ? <ErrorState title="Could not load the compliance calendar" sub={friendly(error)} onRetry={() => setTick(t => t + 1)} />
          : list.length === 0 ? <Empty icon={<Icon.Calendar size={24} />} title="Nothing on the compliance calendar" sub="Add a statutory return, inspection or drill above." />
          : (
            <DataTable<Item>
              columns={[
                { key: 'title', label: 'Item', render: r => <div><div style={{ fontWeight: 570 }}>{r.title}</div><div className="u-xs u-faint">{KIND_LABEL[r.kind] ?? r.kind} · {r.owner_role}</div></div> },
                { key: 'due_on', label: 'Due', render: r => <span className={overdue(r.due_on) && r.status !== 'filed' ? 'u-danger' : ''}>{r.due_on}</span> },
                { key: 'status', label: 'Status', render: r => <Badge tone={r.status === 'filed' ? 'success' : r.status === 'reminded' ? 'warning' : overdue(r.due_on) ? 'danger' : 'outline'} dot>{r.status}</Badge> },
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
