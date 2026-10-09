/* ============================================================
   Cases — the school's real case board (P2-9).

   This screen used to render a deterministic SAMPLE world: the queue, the
   deadline clock, the create action and the triage example all came from the
   local dataset, and the screen said so. The server has had the whole case
   model the whole time — GET /cases, POST /cases, POST /cases/:id/status, with
   a derived `origin`, a role-derived owner and a real `sla_due_at` — so a school
   that filed a complaint through the parent app could not see it here, and a
   case opened here never left the browser.

   The board is now live: the queue is `GET /cases`, opening a case is
   `POST /cases`, and moving one is `POST /cases/:id/status`. What stays local is
   only what has no server model behind it — the AI-triage explainer at the
   bottom is POLICY, not data, and it says which steps are classification versus
   which need a person.

   What this screen deliberately does NOT pretend: there is no message thread.
   `app.cases` has no notes/messages table, so a case has a record, not a
   conversation. The drawer below says exactly that instead of showing a thread
   that exists only in the demo build.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { Badge, Button, Card, DataTable, Drawer, Empty, ErrorState, Modal, PageHead, Section, SkeletonCard, Stat, Tabs, useToast } from '../components/ui';
import { AiTraceCard, EvidenceChain } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtDateShort, fmtNum, fmtRelative } from '../lib/format';
import { humanize, statusLabel } from '../lib/labels';
import { useRoleOrGrant } from '../lib/access';
import { apiCases, apiCaseStatus, apiCreateCase } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import type { AiTrace } from '../types/domain';

/* ---------- ticking clock for deadline countdowns ---------- */
function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

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

/* ---------- the server's row, as this board needs it ---------- */
type CaseStatus = 'open' | 'triaged' | 'in-progress' | 'resolved' | 'closed';
type CasePriority = 'critical' | 'high' | 'normal' | 'low';
interface LiveCase {
  id: string;
  code: string;
  kind: string;
  title: string;
  detail: string | null;
  priority: CasePriority;
  status: CaseStatus;
  owner: string | null;
  origin: string;
  slaDueAt: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  linkedRefs: unknown[];
}
const mapCase = (r: Record<string, unknown>): LiveCase => ({
  id: String(r.id),
  code: String(r.code ?? r.id),
  kind: String(r.kind ?? 'request'),
  title: String(r.title ?? ''),
  detail: r.detail ? String(r.detail) : null,
  priority: (r.priority ?? 'normal') as CasePriority,
  status: (r.status ?? 'open') as CaseStatus,
  owner: r.owner ? String(r.owner) : null,
  origin: String(r.origin ?? 'staff'),
  slaDueAt: r.sla_due_at ? String(r.sla_due_at) : null,
  createdAt: r.created_at ? String(r.created_at) : null,
  resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
  linkedRefs: Array.isArray(r.linked_refs) ? (r.linked_refs as unknown[]) : [],
});

/* The kinds a school actually files. The server accepts any `kind` string; these
   are the ones the compose form offers, because a free-text kind is how a board
   becomes untriageable. */
const KIND_TABS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'complaint', label: 'Complaint' },
  { id: 'request', label: 'Request' },
  { id: 'reconciliation', label: 'Payment matching' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'transport', label: 'Transport' },
  { id: 'facilities', label: 'Facilities' }];
const kindLabel = (k: string) => KIND_TABS.find(t => t.id === k)?.label ?? humanize(k);
const STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'Open', triaged: 'Triaged', 'in-progress': 'In-progress', resolved: 'Resolved', closed: 'Closed'};
const STATUS_TONE: Record<CaseStatus, 'info' | 'warning' | 'accent' | 'success' | 'neutral'> = {
  open: 'info', triaged: 'warning', 'in-progress': 'accent', resolved: 'success', closed: 'neutral'};
const PRIORITY_TONE: Record<CasePriority, 'danger' | 'warning' | 'neutral' | 'outline'> = {
  critical: 'danger', high: 'warning', normal: 'neutral', low: 'outline'};
const ORIGIN_LABEL: Record<string, string> = {
  'parent-whatsapp': 'WhatsApp', phone: 'Phone', 'walk-in': 'Walk-in',
  system: 'System', staff: 'Staff', parent: 'Reported by a family', student: 'Reported by a pupil' };
const ORIGIN_TONE: Record<string, 'success' | 'info' | 'neutral' | 'ai' | 'accent' | 'warning' | 'danger'> = {
  'parent-whatsapp': 'success', phone: 'info', 'walk-in': 'neutral', system: 'ai', staff: 'accent',
  /* a family's own report is deliberately the loudest origin on the board */
  parent: 'warning', student: 'danger' };
/* The flow is the server's. Offering a step it refuses is the "button that can
   never succeed" defect (P2-10) in a different costume. */
const NEXT_STATUS: Partial<Record<CaseStatus, CaseStatus>> = {
  open: 'triaged', triaged: 'in-progress', 'in-progress': 'resolved', resolved: 'closed' };

function fmtH(hours: number): string {
  if (Math.abs(hours) < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return `${Math.round(hours)}h`;
}

/* The deadline is `sla_due_at` — the server's own value — not a per-kind guess. */
function deadline(c: LiveCase, now: number) {
  if (!c.slaDueAt) return { label: 'No deadline set', tone: 'neutral' as const, pct: 0, atRisk: false, breached: false };
  const due = new Date(c.slaDueAt).getTime();
  const leftH = (due - now) / 3600000;
  const opened = c.createdAt ? new Date(c.createdAt).getTime() : due - 48 * 3600000;
  const totalH = Math.max(1, (due - opened) / 3600000);
  const pct = Math.max(0, Math.min(100, (leftH / totalH) * 100));
  if (leftH <= 0) return { label: `Deadline missed ${fmtH(-leftH)} ago`, tone: 'danger' as const, pct, atRisk: false, breached: true };
  if (pct < 25) return { label: `Deadline soon — ${fmtH(leftH)} left`, tone: 'warning' as const, pct, atRisk: true, breached: false };
  return { label: `${fmtH(leftH)} left`, tone: 'neutral' as const, pct, atRisk: false, breached: false };
}

const TRIAGE_TRACE: AiTrace = {
  trigger: 'An inbound family message classified as a case',
  policy: 'Communication §1.1 (WhatsApp-first) · Privacy §1.2 (reads logged)',
  dataUsed: ['guardian thread', 'fees records', 'transport roster', 'incident index'],
  reasoningRole: 'Triage (classify + link only)',
  action: 'Opened the case, set priority, attached linked records',
  approvalStatus: 'Auto-triage allowed; the first reply to the guardian needs staff approval',
  verification: 'Linked records verified against IDs before attachment'};

export default function Cases() {
  const { session } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow();
  /* The board door itself: staff case roles. A role outside it gets an honest empty state
     rather than a 403 toast, and the compose action is hidden because the server would refuse it. */
  const canRead = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'finance', 'finance_head', 'finance_clerk'], ['GET /cases']);
  const canMove = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'finance', 'finance_head', 'finance_clerk'], ['POST /cases/:id/status']);

  const board = useAsync(async () => {
    const r = await apiCases();
    return (r.cases ?? []).map((c: Record<string, unknown>) => mapCase(c));
  }, []);

  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [openCase, setOpenCase] = useState<LiveCase | null>(null);
  const [form, setForm] = useState<{ kind: string; title: string; detail: string; priority: CasePriority; slaHours: string }>({
    kind: 'complaint', title: '', detail: '', priority: 'normal', slaHours: '48' });

  const cases = useMemo(() => board.data ?? [], [board.data]);
  const filtered = cases.filter(c =>
    (kind === 'all' || c.kind === kind) &&
    (status === 'all' || c.status === status) &&
    (!q.trim() || `${c.code} ${c.title} ${c.owner ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));

  const openCases = cases.filter(c => c.status !== 'resolved' && c.status !== 'closed');
  const atRisk = openCases.filter(c => deadline(c, now).atRisk).length;
  const breached = openCases.filter(c => deadline(c, now).breached).length;
  const fromFamilies = cases.filter(c => c.origin === 'parent' || c.origin === 'parent-whatsapp' || c.origin === 'student').length;

  const createCase = async () => {
    if (!form.title.trim()) { toast({ title: 'Give the case a short title', tone: 'info' }); return; }
    setSaving(true);
    try {
      const slaHours = Number(form.slaHours);
      const r = await apiCreateCase({
        kind: form.kind, title: form.title.trim(),
        ...(form.detail.trim() ? { detail: form.detail.trim() } : {}),
        priority: form.priority,
        ...(Number.isFinite(slaHours) && slaHours > 0 ? { slaHours } : {}),
      });
      const opened = mapCase(r.case as Record<string, unknown>);
      toast({ title: `Case ${opened.code} opened`, sub: `${deadline(opened, now).label} · owned by ${opened.owner ?? 'the office'}`, tone: 'success' });
      setNewOpen(false);
      setForm(f => ({ ...f, title: '', detail: '' }));
      board.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setSaving(false); }
  };

  const advance = async (c: LiveCase, to: CaseStatus) => {
    setMoving(c.id);
    try {
      await apiCaseStatus(c.id, to);
      toast({ title: `${c.code} → ${STATUS_LABEL[to]}`, sub: 'Recorded on the case with your name and role.', tone: 'success' });
      board.retry();
      setOpenCase(open => (open && open.id === c.id ? { ...open, status: to } : open));
    } catch (e) { toast({ title: 'Could not move the case', sub: friendly(e), tone: 'error' }); }
    finally { setMoving(null); }
  };

  return (
    <>
      <PageHead
        title="Cases"
        sub={session.roleId === 'finance'
          ? 'Payment matching and fee-linked cases surface first for your role. Every case carries a deadline.'
          : 'One queue for every channel. Guardians never have to repeat themselves; nothing falls through.'}
        actions={canRead ? <Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setNewOpen(true)}>New case</Button> : undefined}
      />

      {!canRead ? (
        <Card>
          <Empty icon={<Icon.Clipboard size={24} />} title="The case board is staff-only"
            sub="Families see their own complaints under My complaints. If you are waiting on a case, ask the school office." />
        </Card>
      ) : board.loading ? (
        <div className="u-col" style={{ gap: 10 }}><SkeletonCard lines={3} /><SkeletonCard lines={3} /></div>
      ) : board.error ? (
        <ErrorState title="Could not load the case board" sub={friendly(board.error)} onRetry={board.retry} />
      ) : (
        <>
          <div className="grid grid-4" style={{ marginBottom: 20 }}>
            <Stat label="Open cases" value={openCases.length} sub={`${cases.length} total · ${fmtNum(fromFamilies)} reported by a family`} />
            <Stat label="Deadline soon" value={atRisk} sub="unresolved · less than a quarter of the time left" />
            <Stat label="Over deadline" value={breached} sub="unresolved · past the server's own deadline" />
            {/* First-response time is a target this product measures nowhere: there is no message
                table, so there is no first response to read. An empty figure would be a lie. */}
            <Stat label="Avg first response" unavailable="Not recorded" sub="No message thread is stored, so there is no first response to measure" />
          </div>

          <Tabs tabs={KIND_TABS.map(t => ({ id: t.id, label: t.label, count: t.id === 'all' ? cases.length : cases.filter(c => c.kind === t.id).length }))} active={kind} onChange={setKind} />

          <div className="u-flex" style={{ gap: 10, margin: '14px 0 16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="select" style={{ width: 170 }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {(Object.keys(STATUS_LABEL) as CaseStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <div style={{ width: 280 }}>
              <input className="input" placeholder="Search by code, title or owner…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search cases" />
            </div>
            <span className="u-xs u-faint">{filtered.length} shown · from the school's case records</span>
          </div>

          <Card>
            <DataTable<LiveCase>
              columns={[
                { key: 'code', label: 'Case', width: 110, render: c => <span className="mono u-xs" style={{ fontWeight: 620 }}>{c.code}</span> },
                { key: 'kind', label: 'Kind', width: 110, render: c => <Badge tone="outline">{kindLabel(c.kind)}</Badge> },
                {
                  key: 'title', label: 'Title', render: c => (
                    <div style={{ minWidth: 220 }}>
                      <div style={{ fontWeight: 580 }}>{c.title}</div>
                      {c.detail ? <div className="u-xs u-faint u-truncate" style={{ maxWidth: 420 }}>{c.detail}</div> : null}
                    </div>
                  )},
                { key: 'opened', label: 'Opened', width: 130, render: c => c.createdAt
                  ? <div><div className="u-small">{fmtDateShort(new Date(c.createdAt))}</div><div className="u-xs u-faint">{fmtRelative(new Date(c.createdAt))}</div></div>
                  : <span className="u-faint">—</span> },
                { key: 'origin', label: 'Reported by', width: 140, render: c => <Badge tone={ORIGIN_TONE[c.origin] ?? 'neutral'}>{ORIGIN_LABEL[c.origin] ?? humanize(c.origin)}</Badge> },
                { key: 'owner', label: 'Owner', width: 130, render: c => c.owner ?? <span className="u-faint">the office</span> },
                { key: 'priority', label: 'Priority', width: 84, render: c => <Badge tone={PRIORITY_TONE[c.priority]}>{statusLabel(c.priority)}</Badge> },
                {
                  key: 'sla', label: 'Deadline', width: 150, render: (c) => {
                    const d = deadline(c, now);
                    return (
                      <div>
                        <Badge tone={d.tone}>{d.label}</Badge>
                        <div className="progress" style={{ height: 3, marginTop: 5, maxWidth: 130 }}><div style={{ width: `${d.pct}%`, background: d.tone === 'danger' ? 'var(--danger)' : d.tone === 'warning' ? 'var(--warning)' : 'var(--accent)' }} /></div>
                      </div>
                    );
                  }},
                { key: 'status', label: 'Status', width: 150, render: c => (
                  <span className="u-inline" style={{ gap: 6 }}>
                    <Badge tone={STATUS_TONE[c.status]} dot>{STATUS_LABEL[c.status]}</Badge>
                    {canMove && NEXT_STATUS[c.status] && (
                      <Button size="sm" variant="ghost" disabled={moving === c.id}
                        onClick={() => { void advance(c, NEXT_STATUS[c.status]!); }}>
                        {moving === c.id ? '…' : STATUS_LABEL[NEXT_STATUS[c.status]!]}
                      </Button>
                    )}
                  </span>
                )},
              ]}
              rows={filtered}
              rowKey={c => c.id}
              onRowClick={c => setOpenCase(c)}
              empty={<Empty icon={<Icon.Clipboard size={26} />} title="No cases match" sub="Try another kind or status, or open a new case." />}
            />
          </Card>
        </>
      )}

      {/* The live record. Stating what the model does NOT hold is part of the drawer: a case has a
          record here, not a conversation, and the detail route that used to open is demo-only. */}
      <Drawer open={openCase != null} onClose={() => setOpenCase(null)}
        title={openCase ? `${openCase.code} · ${openCase.title}` : ''}
        sub={openCase ? `${kindLabel(openCase.kind)} · ${STATUS_LABEL[openCase.status]}` : ''}>
        {openCase && (
          <div className="u-col" style={{ gap: 12 }}>
            {openCase.detail && <p className="u-small" style={{ margin: 0, lineHeight: 1.6 }}>{openCase.detail}</p>}
            <div className="u-flex u-gap-2 u-wrap">
              <Badge tone={ORIGIN_TONE[openCase.origin] ?? 'neutral'}>{ORIGIN_LABEL[openCase.origin] ?? humanize(openCase.origin)}</Badge>
              <Badge tone={PRIORITY_TONE[openCase.priority]}>{statusLabel(openCase.priority)}</Badge>
              <Badge tone={STATUS_TONE[openCase.status]} dot>{STATUS_LABEL[openCase.status]}</Badge>
            </div>
            <div className="u-small u-muted">
              Owner: {openCase.owner ?? 'the office'} · deadline {openCase.slaDueAt ? new Date(openCase.slaDueAt).toLocaleString() : 'not set'}
            </div>
            {canMove && NEXT_STATUS[openCase.status] && (
              <div>
                <Button disabled={moving === openCase.id}
                  onClick={() => { void advance(openCase, NEXT_STATUS[openCase.status]!); }}>
                  Move to {STATUS_LABEL[NEXT_STATUS[openCase.status]!]}
                </Button>
              </div>
            )}
            <div className="u-xs u-faint" style={{ lineHeight: 1.6 }}>
              A case in SchoolOS is a record with a deadline, an owner and a status — there is no
              message thread on the server, so replies live in the channel the case arrived on.
              Families track progress themselves under My complaints.
            </div>
            <div className="u-xs u-faint">
              <button className="u-linkish" onClick={() => navigate('/communications')} style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent-text)', cursor: 'pointer' }}>
                Open communications →
              </button>
            </div>
          </div>
        )}
      </Drawer>

      <div style={{ height: 22 }} />

      <Section title="How an inbound case is triaged" sub="Classification is automatic; the first reply to a family is not.">
        <Card>
          <div className="grid grid-2" style={{ gap: 16 }}>
            <div className="u-col" style={{ gap: 10 }}>
              <p className="u-small u-muted" style={{ margin: 0 }}>
                Language is detected so replies use the guardian's language template. Sentiment is scored to raise priority when
                a guardian contacts us repeatedly. Linked records — school records, routes, prior cases — are attached before the
                case reaches a queue, so the owner starts with the full picture.
              </p>
              <EvidenceChain
                title="Triage chain — how a case is processed"
                steps={[
                  { label: 'Origin', detail: 'Channel and timestamp checked against communication windows', source: 'Communication log' },
                  { label: 'Language', detail: 'Detected per message; the family’s template language is attached for the reply', source: 'Reply classifier · Fast model' },
                  { label: 'Sentiment', detail: 'Scored to raise priority when someone contacts us repeatedly', source: 'Sentiment scorer' },
                  { label: 'Linked records', detail: 'School records, routes and prior cases attach automatically', source: 'Record linker · verified IDs' }]}
              />
            </div>
            <AiTraceCard trace={TRIAGE_TRACE} defaultOpen />
          </div>
        </Card>
      </Section>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Open a case"
        sub="Recorded in the school's case log with a deadline, and attributed to you in the audit trail."
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={13} />} onClick={createCase} disabled={!form.title.trim() || saving}>
              {saving ? 'Opening…' : 'Open case'}
            </Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div>
            <label className="u-xs" htmlFor="nc-kind">Kind</label>
            <select id="nc-kind" className="select" style={{ width: '100%', marginTop: 5 }} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
              {KIND_TABS.filter(t => t.id !== 'all').map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="u-xs" htmlFor="nc-title">Title</label>
            <input id="nc-title" className="input" style={{ width: '100%', marginTop: 5 }} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Transport fee charged twice — September" />
          </div>
          <div>
            <label className="u-xs" htmlFor="nc-detail">What happened (optional)</label>
            <textarea id="nc-detail" className="input" rows={3} style={{ width: '100%', marginTop: 5 }} value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} />
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div>
              <label className="u-xs" htmlFor="nc-priority">Priority</label>
              <select id="nc-priority" className="select" style={{ width: '100%', marginTop: 5 }} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as CasePriority }))}>
                {(['low', 'normal', 'high', 'critical'] as CasePriority[]).map(p => <option key={p} value={p}>{statusLabel(p)}</option>)}
              </select>
            </div>
            <div>
              <label className="u-xs" htmlFor="nc-sla">Deadline (hours)</label>
              <input id="nc-sla" className="input" type="number" min={1} style={{ width: '100%', marginTop: 5 }} value={form.slaHours} onChange={e => setForm(f => ({ ...f, slaHours: e.target.value }))} />
            </div>
          </div>
          {/* `origin` and `owner` are DERIVED server-side from the caller's role — a body field for
              either is ignored on purpose (SEC-4), so the form does not offer them. */}
          <div className="u-xs u-faint">
            Who reported it and who owns it are decided by the server from your role — the office can
            re-file an origin later, but nobody can label their own report as the school's.
          </div>
        </div>
      </Modal>
    </>
  );
}
