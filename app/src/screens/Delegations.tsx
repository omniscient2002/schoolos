/* ============================================================
   Delegations — OPP-OVR-2. Bounded hand-over of approval
   authority (vacation cover). Live door GET/POST /delegations.
   Owner and finance authority can never be delegated.
   ============================================================ */
import { useEffect, useState } from 'react';
import { useSession } from '../App';
import { apiGet, apiPost } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Button, DataTable, Empty, ErrorState, Section, SkeletonCard, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { roleLabel, statusLabel } from '../lib/labels';

interface Delegation { id: string; from_name?: string; from_role: string; to_name?: string; to_role: string; scope_role?: string | null; starts_at: string; ends_at: string; reason?: string | null }
interface Person { id: string; name: string; role: string }

export default function Delegations() {
  const toast = useToast();
  const session = useSession();
  const myRole = session.role;
  const [rows, setRows] = useState<Delegation[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState({ fromUserId: '', fromRole: myRole, toUserId: '', toRole: myRole, endsAt: '', reason: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    apiGet<{ delegations: Delegation[] }>('/delegations')
      .then(r => { if (live) { setRows(r.delegations); setError(null); } })
      .catch(e => { if (live) { setRows(null); setError(String(e)); } });
    // RBAC-6: the delegating roles can reach this roster (people.admin/users is owner/itadmin only).
    apiGet<{ users?: Person[] }>('/delegations/roster')
      .then(r => { if (live) setPeople((r.users ?? []) as Person[]); })
      .catch(() => {});
    return () => { live = false; };
  }, [tick]);

  const create = () => {
    if (!form.toUserId || !form.endsAt) { toast({ title: 'Deputy and end time are required', tone: 'error' }); return; }
    setBusy(true);
    // `fromUserId` omitted means "delegate my own authority"; the server binds from_role to the
    // resolved user's real role (OVR-7), so we never send a role that does not match.
    const body: Record<string, unknown> = { toUserId: form.toUserId, toRole: form.toRole, fromRole: form.fromRole, scopeRole: form.fromRole, endsAt: form.endsAt, reason: form.reason };
    if (form.fromUserId) body.fromUserId = form.fromUserId;
    apiPost('/delegations', body)
      .then(() => { toast({ title: 'Delegation created', tone: 'success' }); setForm({ fromUserId: '', fromRole: myRole, toUserId: '', toRole: myRole, endsAt: '', reason: '' }); setTick(t => t + 1); })
      .catch(e => toast({ title: 'Could not create delegation', sub: friendly(e), tone: 'error' }))
      .finally(() => setBusy(false));
  };

  const delegators = people.filter(p => p.role === 'principal' || p.role === 'coordinator');

  const list = rows ?? [];
  const active = (d: Delegation) => new Date(d.ends_at) > new Date();
  return (
    <>
      <PageHead title="Approval delegations" sub="Hand your approval authority to a named deputy for a bounded window — never for owner or finance decisions." />

      <Section title="New delegation" style={{ marginBottom: 4 }}>
        <Card pad>
          <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
            <label className="u-small">Delegate from
              <select
                className="select"
                value={form.fromUserId}
                onChange={e => {
                  const p = delegators.find(x => x.id === e.target.value);
                  setForm(f => ({ ...f, fromUserId: e.target.value, fromRole: p ? p.role : myRole, toRole: p ? p.role : myRole }));
                }}
              >
                <option value="">Me ({roleLabel(myRole)})</option>
                {delegators.map(p => <option key={p.id} value={p.id}>{p.name} · {roleLabel(p.role)}</option>)}
              </select>
            </label>
            <label className="u-small" style={{ flex: 1, minWidth: 220 }}>Deputy
              <select className="select" value={form.toUserId} onChange={e => setForm(f => ({ ...f, toUserId: e.target.value }))} style={{ width: '100%' }}>
                <option value="">Select a staff member…</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name} · {roleLabel(p.role)}</option>)}
              </select>
            </label>
            <label className="u-small">Until
              <input className="input" type="datetime-local" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} />
            </label>
            <label className="u-small" style={{ flex: 1, minWidth: 160 }}>Reason
              <input className="input" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. conference leave" style={{ width: '100%' }} />
            </label>
            <Button variant="primary" disabled={busy} onClick={create}>Delegate</Button>
          </div>
        </Card>
      </Section>

      <Section title="Active & past delegations">
        {rows == null && !error ? <SkeletonCard lines={4} />
          : error ? <ErrorState title="Could not load delegations" sub={friendly(error)} onRetry={() => setTick(t => t + 1)} />
          : list.length === 0 ? <Empty icon={<Icon.Shield size={24} />} title="No delegations" sub="A principal on leave can hand their approval authority to a deputy here." />
          : (
            <DataTable<Delegation>
              columns={[
                { key: 'from', label: 'From', render: r => <span>{r.from_name ?? roleLabel(r.from_role)} <span className="u-xs u-faint">({roleLabel(r.from_role)})</span></span> },
                { key: 'to', label: 'To', render: r => <span>{r.to_name ?? roleLabel(r.to_role)} <span className="u-xs u-faint">({roleLabel(r.to_role)})</span></span> },
                { key: 'window', label: 'Window', render: r => <span className="u-small">{new Date(r.starts_at).toLocaleString()} → {new Date(r.ends_at).toLocaleString()}</span> },
                { key: 'status', label: 'Status', render: r => <Badge tone={active(r) ? 'success' : 'outline'} dot>{statusLabel(active(r) ? 'active' : 'expired')}</Badge> },
                { key: 'reason', label: 'Reason', render: r => <span className="u-small u-muted">{r.reason ?? '—'}</span> },
              ]}
              rows={list}
              rowKey={r => r.id}
            />
          )}
      </Section>
    </>
  );
}
