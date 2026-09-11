/* ============================================================
   RolesAdmin — L5-5.1. Custom roles over L3-4.2's doors (kernel
   sections of server/src/routes.js:160-270, store from L1's
   migration 063):

   GET    /roles                  → { roles:[{key,label,base_role,permissions:{allow,deny},members}], builtin:ROLES[] }
   POST   /roles                  { key, label, base_role, permissions:{allow,deny} }
   PATCH  /roles/:key             { label?, base_role?, permissions? }
   DELETE /roles/:key             → 409 while members > 0
   POST   /roles/:key/assign      { userIds:[…] }   (1–200, never self, never owners)
   POST   /roles/:key/unassign    { userIds:[…] }

   Model (server doc): a custom role is a BUILTIN base + a mask. Base role
   decides the default doors; a matched DENY refuses even base doors; a
   matched ALLOW grants doors the base lacks. Resolution: custom → builtin.

   Honest-UI rules (D-6): the mask pattern grammar is the server's ("GET
   /fees", "POST /students/*", "*") and the server validates every pattern
   against the LIVE route registry — a pattern that matches no real door is
   refused (400), so presets here are real doors only. PATCH/DELETE go
   through local full-response fetches (only apiGet/apiPost are shared
   exports; liveApi additions are L4-owned per D-29). Owner + IT admin per
   the doors' ROLES_ADMIN; light roles never reach this route (staffOnly).
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, LIVE_BASE } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { Badge, Button, Card, Empty, ErrorState, PageHead, Section, SkeletonCard, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import { fmtDate } from '../lib/format';

interface RoleMask { allow: string[]; deny: string[] }
interface CustomRole { key: string; label: string; base_role: string; permissions: RoleMask; created_at: string; members: number }
interface RolesResponse { roles: CustomRole[]; builtin: string[] }
interface UserRow { id: string; name: string; email: string; role: string; active: boolean }

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', '*'] as const;

/* Curated presets — every pattern is a REAL door (routes.js / plugins).
   The server re-validates against the live route registry and refuses
   dead patterns, so this grid can never invent a permission. */
const PRESETS: { pattern: string; label: string }[] = [
  { pattern: 'GET /me', label: 'Own identity' },
  { pattern: 'GET /dataset', label: 'Read core records' },
  { pattern: 'GET /students', label: 'View students' },
  { pattern: 'POST /students', label: 'Create students' },
  { pattern: 'PATCH /students/*', label: 'Edit student records' },
  { pattern: 'POST /students/*', label: 'Student lifecycle actions' },
  { pattern: 'GET /fees', label: 'View fees' },
  { pattern: 'POST /fees/payments', label: 'Record payments' },
  { pattern: 'GET /plugins/ops.bi/*', label: 'BI read models' },
  { pattern: 'GET /plugins/people.admin/users', label: 'List accounts' },
];

async function roleSend<T>(method: 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem('schoolos_token');
  const res = await fetch(`${LIVE_BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/* ---- mask editor: pattern rows + real-door presets ---- */
function MaskEditor({ mask, onChange }: { mask: RoleMask; onChange: (m: RoleMask) => void }) {
  const [method, setMethod] = useState<string>('GET');
  const [path, setText] = useState<string>('');

  const addPattern = (raw: string) => {
    const p = raw.trim();
    if (!p) return;
    if (mask.allow.includes(p) || mask.deny.includes(p)) return;
    onChange({ ...mask, allow: [...mask.allow, p] });
  };

  const addRow = () => {
    if (method === '*' && !path.trim()) { onChange({ ...mask, allow: [...mask.allow, '*'] }); setText(''); return; }
    if (!path.trim().startsWith('/')) return;
    addPattern(`${method} ${path.trim()}`);
    setText('');
  };

  const renderList = (kind: 'allow' | 'deny') => (
    <div className="u-col" style={{ gap: 4 }}>
      <span className="u-xs u-faint" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {kind === 'allow' ? 'Allow (grant even if the base role lacks it)' : 'Deny (refuse even if the base role has it)'}
      </span>
      {mask[kind].length === 0 && <span className="u-xs u-faint">nothing {kind === 'allow' ? 'granted' : 'refused'} beyond the base role</span>}
      {mask[kind].map(p => (
        <div key={`${kind}-${p}`} className="u-flex" style={{ gap: 6, alignItems: 'center' }}>
          <code className="u-mono u-small" style={{ background: 'var(--surface-2)', padding: '4px 8px', borderRadius: 'var(--r-md)', flex: 1 }}>{p}</code>
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...mask, [kind]: mask[kind].filter(x => x !== p) })} aria-label={`Remove ${p}`}>✕</Button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="u-col" style={{ gap: 12 }}>
      <div className="u-col" style={{ gap: 6 }}>
        <span className="u-xs u-faint" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>Common doors (real presets — the server refuses patterns that match nothing)</span>
        <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map(pr => {
            const on = mask.allow.includes(pr.pattern);
            return (
              <button key={pr.pattern} type="button"
                className="u-xs"
                aria-pressed={on}
                style={{
                  border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
                  background: on ? 'var(--accent-weak)' : 'var(--surface)',
                  color: on ? 'var(--accent-text)' : 'var(--text-2)',
                  borderRadius: 999, padding: '4px 10px', cursor: 'pointer', minHeight: 28,
                }}
                title={pr.pattern}
                onClick={() => onChange(on
                  ? { ...mask, allow: mask.allow.filter(x => x !== pr.pattern) }
                  : { ...mask, allow: [...mask.allow, pr.pattern], deny: mask.deny.filter(x => x !== pr.pattern) })}
              >{pr.label}</button>
            );
          })}
        </div>
      </div>

      <div className="u-col" style={{ gap: 6 }}>
        <span className="u-xs u-faint" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>Custom pattern</span>
        <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="select" style={{ width: 110 }} value={method} onChange={e => setMethod(e.target.value)} aria-label="HTTP method">
            {METHODS.map(m => <option key={m} value={m}>{m === '*' ? 'ANY method' : m}</option>)}
          </select>
          <input className="input" style={{ flex: 1, minWidth: 200 }} value={path} placeholder="/path or /prefix/*  (or empty with ANY method)"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } }} />
          <Button size="sm" variant="secondary" onClick={addRow}>Add to allow</Button>
        </div>
      </div>

      <div className="grid grid-2">
        {renderList('allow')}
        {renderList('deny')}
      </div>
      <div className="u-xs u-faint" style={{ lineHeight: 1.55 }}>
        Deny wins over allow, and both win over the base role. A trailing <code>*</code> matches a prefix
        (e.g. <code>POST /students/*</code>); a bare <code>*</code> matches everything.
      </div>
    </div>
  );
}

/* ---- assign drawer: pick accounts, assign or clear ---- */
function AssignDrawer({ role, onClose, onDone }: { role: CustomRole; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    apiGet<{ users: UserRow[] }>('/plugins/people.admin/users')
      .then(r => { if (live) setUsers(r.users.filter(u => u.active && u.role !== 'owner')); })
      .catch(e => { if (live) setError(friendly(e)); });
    return () => { live = false; };
  }, []);

  const filtered = useMemo(() => {
    if (!users) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(u => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(needle));
  }, [users, q]);

  const run = async (kind: 'assign' | 'unassign') => {
    const userIds = [...picked];
    if (!userIds.length) return;
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{ assigned?: number; cleared?: number }>(`/roles/${role.key}/${kind}`, { userIds });
      toast({
        title: kind === 'assign' ? 'Role assigned' : 'Role cleared',
        sub: kind === 'assign'
          ? `${r.assigned ?? userIds.length} account(s) now carry “${role.label}” (base ${role.base_role} + mask).`
          : `${r.cleared ?? userIds.length} account(s) back to their builtin role.`,
        tone: 'success',
      });
      onDone();
      onClose();
    } catch (e: unknown) {
      setError(friendly((e as Error)?.message ?? 'assignment failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="u-col" style={{ gap: 10 }}>
      <div className="u-small u-muted" style={{ lineHeight: 1.55 }}>
        Accounts carry ONE custom overlay; assigning replaces whatever they had. Owner accounts can never
        carry an overlay and you can’t change your own role here — the server refuses both.
      </div>
      {error && <div role="alert" className="u-small" style={{ color: 'var(--danger)' }}>{error}</div>}
      <input className="input" placeholder="Filter by name, email or role…" value={q} onChange={e => setQ(e.target.value)} />
      {users === null && <SkeletonCard lines={6} />}
      {users !== null && filtered.length === 0 && <Empty title="No accounts match" sub="Refine the filter." style={{ border: 'none' }} />}
      {users !== null && filtered.length > 0 && (
        <div className="scroll-thin u-col" style={{ gap: 2, maxHeight: 320, overflowY: 'auto' }}>
          {filtered.map(u => {
            const on = picked.has(u.id);
            return (
              <button key={u.id} type="button" className="u-between u-small"
                style={{ padding: '7px 8px', borderRadius: 'var(--r-md)', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border-subtle)'), background: on ? 'var(--accent-weak)' : 'var(--surface)', cursor: 'pointer', textAlign: 'left' }}
                aria-pressed={on}
                onClick={() => setPicked(prev => { const next = new Set(prev); if (on) next.delete(u.id); else next.add(u.id); return next; })}>
                <span><strong>{u.name}</strong> <span className="u-muted">{u.email}</span></span>
                <span className="u-xs u-faint">{u.role}{on ? ' · picked' : ''}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="u-flex" style={{ gap: 8 }}>
        <Button size="sm" variant="primary" disabled={busy || picked.size === 0} onClick={() => void run('assign')}>Assign ({picked.size})</Button>
        <Button size="sm" variant="ghost" disabled={busy || picked.size === 0} onClick={() => void run('unassign')}>Clear from role</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

export default function RolesAdmin() {
  const { session } = useStore();
  const canAdmin = session.roleId === 'owner' || session.roleId === 'itadmin';

  const [data, setData] = useState<RolesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null);
  const [assigning, setAssigning] = useState<CustomRole | null>(null);

  const reload = () => setTick(t => t + 1);

  useEffect(() => {
    let live = true;
    setLoading(true); setLoadError(null);
    apiGet<RolesResponse>('/roles')
      .then(r => { if (live) setData(r); })
      .catch(e => { if (live) setLoadError(friendly(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [tick]);

  if (!canAdmin) {
    return (
      <>
        <PageHead title="Roles & permissions" sub="Custom roles are managed by the school owner and IT admin." />
        <Empty icon={<Icon.Lock size={24} />} title="Not your desk" sub="Ask the school owner or IT admin for role changes — every change is audited on the server." />
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Roles & permissions"
        sub="Custom roles: pick a builtin base, then grant or refuse specific doors. The mask is read fresh on every request; assignment changes apply within the server's binding window."
        actions={<Button variant="secondary" icon={<Icon.Plus size={14} />} onClick={() => setEditing('new')}>New role</Button>}
      />

      {loading && <div className="grid grid-2"><SkeletonCard lines={5} /><SkeletonCard lines={5} /></div>}
      {loadError && <ErrorState title="Could not load roles" sub={loadError} onRetry={reload} />}
      {!loading && !loadError && data && data.roles.length === 0 && (
        <Empty icon={<Icon.Users size={26} />} title="No custom roles yet"
          sub="Every account uses its builtin role. Create a custom role when someone needs a base role plus (or minus) specific doors." />
      )}
      {!loading && !loadError && data && data.roles.length > 0 && (
        <Section title="Custom roles" sub={`${data.roles.length} role${data.roles.length === 1 ? '' : 's'} · resolution order: custom mask → builtin base`}>
          <div className="grid grid-2">
            {data.roles.map(r => (
              <Card key={r.key} head={r.label}
                actions={
                  <div className="u-flex" style={{ gap: 4 }}>
                    <Button size="sm" variant="ghost" icon={<Icon.Edit size={12} />} onClick={() => setEditing(r)}>Edit</Button>
                    <Button size="sm" variant="ghost" icon={<Icon.Users size={12} />} onClick={() => setAssigning(r)}>Assign</Button>
                  </div>
                }>
                <div className="u-col" style={{ padding: 'var(--s-4) var(--s-5)', gap: 8 }}>
                  <div className="u-between u-small">
                    <span className="u-muted">key <code className="u-mono">{r.key}</code></span>
                    <Badge tone={r.members > 0 ? 'accent' : 'neutral'} dot>{r.members} account{r.members === 1 ? '' : 's'}</Badge>
                  </div>
                  <div className="u-small">Base role: <strong>{r.base_role}</strong></div>
                  <div className="u-small u-muted">
                    {r.permissions.allow.length > 0 ? <>allows <code className="u-mono">{r.permissions.allow.join(', ')}</code></> : 'no extra grants'}
                    {r.permissions.deny.length > 0 && <> · refuses <code className="u-mono">{r.permissions.deny.join(', ')}</code></>}
                  </div>
                  <div className="u-xs u-faint">created {fmtDate(new Date(r.created_at))}</div>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {data && data.roles.length > 0 && (
        <Section title="Builtin roles" sub="The base every custom role starts from — not editable">
          <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {data.builtin.map(b => <Badge key={b} tone="neutral">{b}</Badge>)}
          </div>
        </Section>
      )}

      {editing && (
        <RoleForm
          role={editing === 'new' ? null : editing}
          builtin={data?.builtin ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}

      {assigning && (
        <Card head={`Assign “${assigning.label}”`} style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
          <div style={{ padding: 'var(--s-4) var(--s-5)' }}>
            <AssignDrawer role={assigning} onClose={() => setAssigning(null)} onDone={reload} />
          </div>
        </Card>
      )}
    </>
  );
}

/* ---- create/edit form ---- */
function RoleForm({ role, builtin, onClose, onSaved }: { role: CustomRole | null; builtin: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState(role?.key ?? '');
  const [label, setLabel] = useState(role?.label ?? '');
  const [baseRole, setBaseRole] = useState(role?.base_role ?? (builtin[0] ?? 'teacher'));
  const [mask, setMask] = useState<RoleMask>(role?.permissions ? { allow: [...role.permissions.allow], deny: [...role.permissions.deny] } : { allow: [], deny: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = role === null;

  const save = async () => {
    setError(null);
    if (isNew && !/^[a-z0-9_-]{2,40}$/.test(key.trim())) { setError('Key: 2-40 characters, lowercase letters, digits, - or _'); return; }
    if (label.trim().length < 2 || label.trim().length > 60) { setError('Give the role a name of 2-60 characters'); return; }
    setBusy(true);
    try {
      if (isNew) {
        await apiPost<{ ok?: boolean }>('/roles', { key: key.trim(), label: label.trim(), base_role: baseRole, permissions: mask });
        toast({ title: `Role created — ${label.trim()}`, sub: `Base ${baseRole} + ${mask.allow.length} grant${mask.allow.length === 1 ? '' : 's'}${mask.deny.length ? ` · ${mask.deny.length} refusal${mask.deny.length === 1 ? '' : 's'}` : ''}. Assign it to accounts next.`, tone: 'success' });
      } else {
        await roleSend('PATCH', `/roles/${role.key}`, { label: label.trim(), base_role: baseRole, permissions: mask });
        toast({ title: `Role updated — ${label.trim()}`, sub: 'The mask is read fresh on every request — changes apply immediately (within the server’s short binding window).', tone: 'success' });
      }
      onSaved();
    } catch (e: unknown) {
      setError(friendly((e as Error)?.message ?? 'could not save the role'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card head={isNew ? 'New custom role' : `Edit “${role.label}”`} style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>
      <div className="u-col" style={{ padding: 'var(--s-4) var(--s-5)', gap: 12 }}>
        {error && <div role="alert" className="u-small" style={{ color: 'var(--danger)' }}>{error}</div>}
        <div className="grid grid-2">
          <label>Role key {isNew ? '' : '(fixed)'}
            <input className="input" value={key} onChange={e => setKey(e.target.value)} disabled={!isNew}
              placeholder="e.g. fee-desk-clerk" maxLength={40} />
          </label>
          <label>Role name
            <input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Fee desk clerk" maxLength={60} />
          </label>
        </div>
        <label>Base role (the builtin this role starts from)
          <select className="select" value={baseRole} onChange={e => setBaseRole(e.target.value)}>
            {builtin.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <MaskEditor mask={mask} onChange={setMask} />
        <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : isNew ? 'Create role' : 'Save changes'}
          </button>
        </div>
      </div>
    </Card>
  );
}
