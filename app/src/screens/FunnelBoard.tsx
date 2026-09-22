/* ============================================================
   FunnelBoard — live admissions.funnel surface (unit 14, v1.3).
   Consumes the admissions.funnel plugin doors as server truth:
   - GET  /plugins/admissions.funnel/leads       → masked flag decides PII display
   - POST /plugins/admissions.funnel/leads       → capture a lead
   - PATCH /plugins/admissions.funnel/leads/:id  → correct a lead
   - POST .../leads/:id/stage                    → lattice enforced SERVER-side
   - GET  .../leads/:id/history                  → transition trail
   - POST .../leads/:id/activities               → visit/interview scheduling
   - POST .../leads/:id/documents                → attach an admission document
   - GET  .../leads/:id/offer-letter             → generated offer letter
   - GET  .../health                             → probe + orphan reconciliation
   House style: three-tier loading (SkeletonCard), ErrorState, Empty, tokens
   only, keyboard-accessible controls, sort-ready DataTable semantics.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHead, Card, Stat, Badge, Button, useToast, Empty, ErrorState, SkeletonCard, DataTable, Dropdown,
  Drawer, Modal, Section,
} from '../components/ui';
import { fmtRelative } from '../lib/format';
import { friendly } from '../lib/friendlyErrors';
import { SegmentedBar } from '../components/Chart';
import { Icon } from '../components/Icon';
import {
  LIVE_API, apiFunnelLeads, apiCreateFunnelLead, apiEditFunnelLead, apiFunnelMoveStage,
  apiFunnelHistory, apiFunnelSummary, apiFunnelActivities, apiLogFunnelActivity,
  apiFunnelOfferLetter, apiFunnelHealth,
  type ApiFunnelLead, type ApiFunnelActivity, type FunnelHealth,
} from '../services/liveApi';
import { useStore } from '../state/store';
import { useSession } from '../App'; /* live authenticated role (DemoBar precedent) */
import { useRoleOrGrant } from '../lib/access';

/* server lattice — display order mirrors the forward path; side exits render in history */
const PATH: { id: string; label: string; color: string }[] = [
  { id: 'enquiry', label: 'Enquiry', color: 'var(--info)' },
  { id: 'form', label: 'Form', color: 'var(--chart-steel)' },
  { id: 'interaction', label: 'Interaction', color: 'var(--accent)' },
  { id: 'offer', label: 'Offer', color: 'var(--ai)' },
  { id: 'waitlisted', label: 'Waitlisted', color: 'var(--warning)' },
  { id: 'enrolled', label: 'Enrolled', color: 'var(--success)' },
];
const EXITS: { id: string; label: string }[] = [
  { id: 'rejected', label: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];
const TERMINAL = new Set(['enrolled', 'rejected', 'withdrawn']);
const ALL_STAGES = [...PATH, ...EXITS];

type History = { from_stage: string | null; to_stage: string; actor: string; at: string }[];
const stageLabel = (id: string | null) => ALL_STAGES.find(s => s.id === id)?.label ?? id ?? '—';

const stageBadgeTone = (stage: string): 'info' | 'accent' | 'ai' | 'success' | 'warning' | 'danger' | 'neutral' =>
  stage === 'enquiry' ? 'info'
    : stage === 'form' ? 'info'
      : stage === 'interaction' ? 'accent'
        : stage === 'offer' ? 'ai'
          : stage === 'waitlisted' ? 'warning'
            : stage === 'enrolled' ? 'success'
              : stage === 'rejected' ? 'danger' : 'warning';

type LeadForm = { studentName: string; guardianName: string; guardianPhone: string; classApplied: string; source: string; admissionYear: string };
const EMPTY_FORM: LeadForm = { studentName: '', guardianName: '', guardianPhone: '', classApplied: '', source: '', admissionYear: '' };

export default function FunnelBoard() {
  const toast = useToast();
  const { session, actorName, dispatch } = useStore();
  /* gate on the LIVE server role, not the demo view switcher: the store's roleId
     could historically drift from the authenticated identity (AuthGate restore
     path — unit 14 finding). Unit 16 (A1) restores parity at the AuthGate
     source; the ADMIN set still mirrors the doors' require(...) preHandler, and
     the server 403s any mutation it disallows (UI mirrors, server decides). */
  const live = useSession();
  /* FEX-4/FEX-7: the admissions ADMIN set (server _shared/admissions-access.js) plus any custom-role
     mask that grants the capture door. The server's require(...ADMIN) re-decides every mutation. */
  const canTransition = useRoleOrGrant(
    ['owner', 'principal', 'itadmin', 'finance', 'coordinator', 'admissions'],
    ['POST /plugins/admissions.funnel/leads', 'POST /plugins/admissions.funnel/leads/:id/stage']);

  const [data, setData] = useState<{ masked: boolean; capped: boolean; leads: ApiFunnelLead[] } | null>(null);
  const [summary, setSummary] = useState<{ byStage: Record<string, number>; total: number } | null>(null);
  const [health, setHealth] = useState<FunnelHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [editLead, setEditLead] = useState<ApiFunnelLead | null>(null);
  const [form, setForm] = useState<LeadForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [activityLead, setActivityLead] = useState<ApiFunnelLead | null>(null);
  const [activities, setActivities] = useState<ApiFunnelActivity[]>([]);
  const [actForm, setActForm] = useState({ kind: 'visit', scheduledAt: '', outcome: '', notes: '' });
  const [offerLead, setOfferLead] = useState<ApiFunnelLead | null>(null);
  const [offerLetter, setOfferLetter] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    apiFunnelLeads()
      .then(leads => { if (alive) { setData(leads); setLoading(false); } })
      .catch(e => { if (alive) { setError(friendly(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [tick]);

  /* summary + health are privileged doors (server truth): fetch only when the role
     can, and never let a failure kill the board */
  useEffect(() => {
    let alive = true;
    if (!canTransition) return;
    apiFunnelSummary().then(s => { if (alive) setSummary(s); }).catch(() => { if (alive) setSummary(null); });
    return () => { alive = false; };
  }, [canTransition, tick]);
  useEffect(() => {
    let alive = true;
    if (!['owner', 'principal', 'itadmin'].includes(live.role)) return;
    apiFunnelHealth().then(h => { if (alive) setHealth(h); }).catch(() => { if (alive) setHealth(null); });
    return () => { alive = false; };
  }, [live.role, tick]);

  const masked = data?.masked ?? false;
  const leads = useMemo(() => data?.leads ?? [], [data]);

  const move = async (id: string, to: string) => {
    setBusyId(id);
    try {
      const r = await apiFunnelMoveStage(id, to);
      setTick(t => t + 1);
      toast({
        title: `Moved to ${stageLabel(r.to)}`,
        sub: r.actionId
          ? 'Offer accepted — an approval to enroll the student was sent to the Principal.'
          : 'Stage transitioned on the server lattice. Audit entry recorded.',
        tone: 'success',
      });
      dispatch({
        type: 'audit/add',
        entry: {
          actor: actorName, actorRole: session.roleId, action: `Funnel stage → ${stageLabel(r.to)}`,
          recordType: 'Admission lead (plugin)', recordRef: id,
          reason: 'admissions.funnel stage transition', policyRef: 'Platform §3 (plugin governance)',
          aiInvolved: false, risk: r.to === 'enrolled' ? 'medium' : 'low',
          outcome: `${r.from} → ${r.to}${r.actionId ? ' · enrollment approval sent to the Principal' : ''}`,
        },
      });
    } catch (e) {
      toast({ title: 'Transition rejected', sub: friendly(e), tone: 'error' });
    } finally { setBusyId(null); }
  };

  const openHistory = async (id: string) => {
    setHistoryId(id);
    setHistoryLoading(true);
    try { setHistory((await apiFunnelHistory(id)).history); }
    catch { setHistory(null); }
    finally { setHistoryLoading(false); }
  };

  const openCapture = () => { setForm(EMPTY_FORM); setCaptureOpen(true); };
  const openEdit = (l: ApiFunnelLead) => {
    setEditLead(l);
    setForm({
      studentName: l.studentName, guardianName: l.guardianName ?? '', guardianPhone: l.guardianPhone ?? '',
      classApplied: l.classApplied, source: l.source, admissionYear: l.admissionYear ?? '',
    });
  };

  const submitCapture = async () => {
    if (!form.studentName.trim() || !form.guardianPhone.trim() || !form.classApplied.trim()) {
      toast({ title: 'Missing details', sub: 'Student name, guardian phone and class are required.', tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      const r = await apiCreateFunnelLead({
        studentName: form.studentName.trim(), guardianName: form.guardianName.trim() || undefined,
        guardianPhone: form.guardianPhone.trim(), classApplied: form.classApplied.trim(),
        source: form.source.trim() || undefined, admissionYear: form.admissionYear.trim() || undefined,
      });
      setCaptureOpen(false); setTick(t => t + 1);
      toast({ title: 'Enquiry captured', sub: `${form.studentName} is at the Enquiry stage (session ${r.admissionYear}).`, tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not capture the enquiry', sub: friendly(e), tone: 'error' });
    } finally { setSaving(false); }
  };

  const submitEdit = async () => {
    if (!editLead) return;
    setSaving(true);
    try {
      await apiEditFunnelLead(editLead.id, {
        studentName: form.studentName.trim(), guardianName: form.guardianName.trim(),
        guardianPhone: form.guardianPhone.trim(), classApplied: form.classApplied.trim(), source: form.source.trim(),
      });
      setEditLead(null); setTick(t => t + 1);
      toast({ title: 'Enquiry updated', sub: 'The correction is recorded in the audit trail.', tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not update the enquiry', sub: friendly(e), tone: 'error' });
    } finally { setSaving(false); }
  };

  const openActivity = async (l: ApiFunnelLead) => {
    setActivityLead(l); setActForm({ kind: 'visit', scheduledAt: '', outcome: '', notes: '' });
    try { setActivities((await apiFunnelActivities(l.id)).activities); } catch { setActivities([]); }
  };
  const submitActivity = async () => {
    if (!activityLead) return;
    setSaving(true);
    try {
      await apiLogFunnelActivity(activityLead.id, {
        kind: actForm.kind, scheduledAt: actForm.scheduledAt || undefined,
        outcome: actForm.outcome || undefined, notes: actForm.notes || undefined,
      });
      setActivities((await apiFunnelActivities(activityLead.id)).activities);
      setActForm({ kind: 'visit', scheduledAt: '', outcome: '', notes: '' });
      toast({ title: 'Activity logged', sub: 'Visit/interview scheduling is now on the lead record.', tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not log the activity', sub: friendly(e), tone: 'error' });
    } finally { setSaving(false); }
  };

  const openOffer = async (l: ApiFunnelLead) => {
    setOfferLead(l); setOfferLetter(null);
    try { setOfferLetter((await apiFunnelOfferLetter(l.id)).letter); }
    catch (e) { setOfferLetter(`Could not generate the offer letter: ${friendly(e)}`); }
  };

  /* count fallback: server summary when the door is reachable for the role,
     otherwise counts over the fetched leads page (counts are not PII) */
  const stageCount = useMemo(() => {
    const by = summary?.byStage ?? {};
    return (id: string) => by[id] ?? leads.filter(l => l.stage === id).length;
  }, [summary, leads]);

  const parts = useMemo(() => {
    const at = (id: string) => stageCount(id);
    /* cumulative funnel for the bar: enquiry ≥ form ≥ … ≥ enrolled (waitlisted folded into offer+) */
    const cum = PATH.map((_, i) => PATH.slice(i).reduce((a, s) => a + at(s.id), 0));
    return PATH.map((s, i) => ({ value: cum[i], color: s.color, label: `${s.label} — ${cum[i]}` }));
  }, [stageCount]);

  /* forward-lattice display mirror (server enforces); terminal stages move nowhere */
  const nextStages = (lead: ApiFunnelLead) => {
    const at = PATH.findIndex(x => x.id === lead.stage);
    if (at < 0) return []; /* terminal: enrolled / rejected / withdrawn are immutable */
    return PATH.filter((_, i) => i > at);
  };

  if (!LIVE_API) {
    return <Card pad><Empty icon={<Icon.Database size={22} />} title="Live API not enabled" sub="The admissions.funnel board reads the server plugin doors — run with VITE_LIVE_API=1." /></Card>;
  }
  if (loading) return <SkeletonCard lines={8} />;
  if (error) return <ErrorState title="Could not load the funnel" sub={error} onRetry={() => setTick(t => t + 1)} />;

  const offerLeads = leads.filter(l => l.stage === 'offer' || l.stage === 'waitlisted');

  return (
    <div>
      <PageHead
        title="Admissions funnel"
        sub={masked
          ? 'Privacy-masked view — guardian contact details are hidden for your role (DPDP masking tiers).'
          : 'Admissions office view — guardian contacts visible per DPDP masking tier.'}
        actions={
          <div className="u-flex" style={{ gap: 8 }}>
            {canTransition && <Button variant="primary" icon={<Icon.Plus size={14} />} onClick={openCapture}>Capture enquiry</Button>}
            <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={() => setTick(t => t + 1)}>Refresh</Button>
          </div>
        }
      />

      {health && !health.healthy && (
        <Card pad style={{ marginBottom: 20, borderColor: 'var(--danger-weak-2)' }}>
          <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone="danger" dot>Conversion reconciliation needed</Badge>
            <span className="u-small">
              {health.orphans.strandedEnrolled.length} enrolled lead(s) with no student and no open approval ·
              {' '}{health.orphans.danglingActions.length} open approval(s) whose lead is not enrolled.
            </span>
          </div>
        </Card>
      )}

      <div className="grid grid-5" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 16, marginBottom: 24 }}>
        <Stat label="Total enquiries" value={summary?.total ?? leads.length} sub="All stages, this session" />
        {PATH.slice(1, 5).map(s => <Stat key={s.id} label={s.label} value={stageCount(s.id)} sub={`Leads at ${s.label.toLowerCase()}`} />)}
        <Stat label="Enrolled" value={stageCount('enrolled')} sub="Offer accepted this cycle" />
      </div>

      <Card pad style={{ marginBottom: 24 }}>
        <div className="u-upper" style={{ marginBottom: 6 }}>Conversion funnel (cumulative)</div>
        <SegmentedBar parts={parts} height={12} />
        <div className="u-flex u-xs u-muted" style={{ gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          {parts.map(p => (
            <span key={p.label} className="u-flex" style={{ gap: 5 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 3, background: p.color }} /> {p.label}
            </span>
          ))}
        </div>
      </Card>

      {leads.length === 0 ? (
        <Empty icon={<Icon.Users size={22} />} title="No enquiries yet" sub="Captured enquiries land here, at the enquiry stage." action={canTransition ? <Button variant="primary" onClick={openCapture}>Capture the first enquiry</Button> : undefined} />
      ) : (
        <>
          <DataTable<ApiFunnelLead>
            caption={masked ? 'Admission enquiries — PII masked for your role' : 'Admission enquiries — guardian contacts visible to admissions office roles'}
            rows={leads}
            rowKey={l => l.id}
            columns={[
              {
                key: 'student', label: 'Student', sortable: true, sortValue: l => l.studentName,
                render: l => (
                  <div>
                    <div style={{ fontWeight: 570 }}>{l.studentName}</div>
                    <div className="u-xs u-faint">{l.classApplied}{l.documentCount ? ` · ${l.documentCount} doc${l.documentCount === 1 ? '' : 's'}` : ''}</div>
                  </div>
                ),
              },
              {
                key: 'guardian', label: 'Guardian', sortable: true, sortValue: l => l.guardianName ?? '',
                render: l => masked
                  ? <span className="u-faint" title="Masked for your role — DPDP tiering">Masked</span>
                  : <div><div>{l.guardianName ?? '—'}</div><div className="u-xs u-faint">{l.guardianPhone ?? ''}</div></div>,
              },
              { key: 'source', label: 'Source', sortable: true, render: l => <span className="u-small u-muted">{l.source}</span> },
              { key: 'stage', label: 'Stage', sortable: true, render: l => <Badge tone={stageBadgeTone(l.stage)}>{stageLabel(l.stage)}</Badge> },
              { key: 'updated', label: 'Updated', sortable: true, sortValue: l => new Date(l.updatedAt).getTime(), render: l => <span className="u-small">{fmtRelative(l.updatedAt)}</span> },
              {
                key: 'actions', label: 'Actions', align: 'right',
                render: l => {
                  if (!canTransition) return <span className="u-faint u-small">Read-only</span>;
                  const nexts = nextStages(l);
                  const exits = EXITS.filter(() => !TERMINAL.has(l.stage));
                  return (
                    <div className="u-flex" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {nexts.slice(0, 2).map(n => (
                        <Button key={n.id} size="sm" variant={n.id === 'enrolled' ? 'primary' : 'secondary'} disabled={busyId === l.id}
                          onClick={() => move(l.id, n.id)}>{n.id === 'enrolled' ? 'Accept offer' : n.label}</Button>
                      ))}
                      <Dropdown
                        label={`More actions for ${l.studentName}`}
                        trigger={() => (
                          <button className="btn btn-ghost btn-sm" aria-label={`More actions for ${l.studentName}`} title="More actions">
                            More
                          </button>
                        )}
                      >
                        {(close: () => void) => (
                          <div className="u-col" style={{ padding: 4 }}>
                            <div role="none" className="dropdown-label">Actions</div>
                            {nexts.length > 2 && nexts.slice(2).map(n => (
                              <button key={n.id} role="menuitem" className="dropdown-item" onClick={() => { close(); move(l.id, n.id); }}>
                                Move to {n.label}
                              </button>
                            ))}
                            <button role="menuitem" className="dropdown-item" onClick={() => { close(); openEdit(l); }}>Edit details</button>
                            <button role="menuitem" className="dropdown-item" onClick={() => { close(); openActivity(l); }}>Visit / interview</button>
                            {['offer', 'waitlisted', 'enrolled'].includes(l.stage) && (
                              <button role="menuitem" className="dropdown-item" onClick={() => { close(); openOffer(l); }}>Offer letter</button>
                            )}
                            <button role="menuitem" className="dropdown-item" onClick={() => { close(); openHistory(l.id); }}>Stage history</button>
                            {exits.map(x => (
                              <button key={x.id} role="menuitem" className="dropdown-item" onClick={() => { close(); move(l.id, x.id); }}>
                                Mark {x.label.toLowerCase()}
                              </button>
                            ))}
                          </div>
                        )}
                      </Dropdown>
                    </div>
                  );
                },
              },
            ]}
          />
          {data?.capped && (
            <div className="u-small u-muted" style={{ marginTop: 8 }}>
              Showing the 200 most recent enquiries. Refine by stage to see older ones.
            </div>
          )}
          <div style={{ height: 20 }} />
          <div className="u-small u-muted">
            Stage moves are validated server-side against the lattice (enquiry → form → interaction → offer → waitlisted → enrolled, side exits rejected/withdrawn).
            Terminal stages are immutable. Accepting an offer raises <strong>students.create</strong> as a kernel approval action for the Principal — the plugin never writes core student records.
            {masked && ' Guardian contact details are masked for your role (DPDP masking tiers by server truth).'}
          </div>
        </>
      )}

      {/* ---- stage history drawer ---- */}
      {historyId && (
        <Card pad style={{ marginTop: 24 }}>
          <div className="u-flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 620 }}>Stage history — {leads.find(l => l.id === historyId)?.studentName ?? historyId}</div>
            <Button size="sm" variant="ghost" icon={<Icon.X size={13} />} onClick={() => { setHistoryId(null); setHistory(null); }}>Close</Button>
          </div>
          {historyLoading ? <SkeletonCard lines={2} /> : !history || history.length === 0 ? (
            <Empty icon={<Icon.Clock size={18} />} title="No history" sub="The server returned no transitions for this lead." />
          ) : (
            <ol style={{ margin: 0, paddingLeft: 20 }} className="u-col" >
              {history.map((h, i) => (
                <li key={i} className="u-small" style={{ padding: '3px 0' }}>
                  <span style={{ fontWeight: 570 }}>{stageLabel(h.from_stage)} → {stageLabel(h.to_stage)}</span>
                  <span className="u-faint"> · {h.actor} · {fmtRelative(h.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {/* offer-acceptance preview: show what the kernel action will do (office roles see it in Action Center) */}
      {offerLeads.length > 0 && !masked && (
        <Card pad style={{ marginTop: 24, borderColor: 'var(--ai-weak-2)' }}>
          <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
            <Icon.Sparkle size={13} style={{ color: 'var(--ai-text)' }} />
            <span className="u-small" style={{ fontWeight: 600 }}>{offerLeads.length} offer{offerLeads.length === 1 ? '' : 's'} awaiting a decision</span>
            <span className="u-small u-faint">— accepting one raises a students.create approval in the Action Center (Principal decides).</span>
          </div>
        </Card>
      )}

      {/* ---- capture / edit drawer ---- */}
      <Drawer
        open={captureOpen || !!editLead}
        onClose={() => { setCaptureOpen(false); setEditLead(null); }}
        title={editLead ? 'Edit enquiry' : 'Capture enquiry'}
        sub={editLead ? 'Correct a lead. The change is audited; the session is immutable.' : 'Record a walk-in, phone or referral enquiry. Guardian contacts stay in the admissions data plane.'}
        footer={
          <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => { setCaptureOpen(false); setEditLead(null); }}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={editLead ? submitEdit : submitCapture}>{editLead ? 'Save changes' : 'Capture enquiry'}</Button>
          </div>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <Field label="Student name" value={form.studentName} onChange={v => setForm(f => ({ ...f, studentName: v }))} />
          <Field label="Guardian name" value={form.guardianName} onChange={v => setForm(f => ({ ...f, guardianName: v }))} />
          <Field label="Guardian phone" value={form.guardianPhone} onChange={v => setForm(f => ({ ...f, guardianPhone: v }))} placeholder="+91 98765 43210" />
          <Field label="Class applied" value={form.classApplied} onChange={v => setForm(f => ({ ...f, classApplied: v }))} placeholder="6 or 6-A" />
          <Field label="Source" value={form.source} onChange={v => setForm(f => ({ ...f, source: v }))} placeholder="walk-in, referral, website…" />
          {!editLead && <Field label="Admission session (optional)" value={form.admissionYear} onChange={v => setForm(f => ({ ...f, admissionYear: v }))} placeholder="2026-27" />}
        </div>
      </Drawer>

      {/* ---- activity drawer ---- */}
      <Drawer
        open={!!activityLead}
        onClose={() => setActivityLead(null)}
        title={`Visit / interview — ${activityLead?.studentName ?? ''}`}
        sub="Schedule a campus visit or interview, or log a call/note. Outcomes feed the funnel."
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div className="u-flex" style={{ gap: 8 }}>
            <label className="u-small u-muted" htmlFor="act-kind">Kind</label>
            <select id="act-kind" className="input" value={actForm.kind} onChange={e => setActForm(f => ({ ...f, kind: e.target.value }))} style={{ width: 160 }}>
              <option value="visit">Campus visit</option>
              <option value="interview">Interview</option>
              <option value="call">Call</option>
              <option value="note">Note</option>
            </select>
          </div>
          <div className="u-flex" style={{ gap: 8 }}>
            <label className="u-small u-muted" htmlFor="act-when">Scheduled</label>
            <input id="act-when" type="datetime-local" className="input" value={actForm.scheduledAt} onChange={e => setActForm(f => ({ ...f, scheduledAt: e.target.value }))} />
          </div>
          <Field label="Outcome" value={actForm.outcome} onChange={v => setActForm(f => ({ ...f, outcome: v }))} placeholder="e.g. positive, reschedule, no-show" />
          <Field label="Notes" value={actForm.notes} onChange={v => setActForm(f => ({ ...f, notes: v }))} />
          <div className="u-flex" style={{ justifyContent: 'flex-end' }}>
            <Button variant="primary" loading={saving} onClick={submitActivity}>Log activity</Button>
          </div>
          <Section title="Activity trail">
            {activities.length === 0 ? <Empty icon={<Icon.Clock size={18} />} title="No activity yet" sub="Visits and interviews you log appear here." />
              : (
                <ol style={{ margin: 0, paddingLeft: 18 }} className="u-col">
                  {activities.map(a => (
                    <li key={a.id} className="u-small" style={{ padding: '3px 0' }}>
                      <span style={{ fontWeight: 570, textTransform: 'capitalize' }}>{a.kind}</span>
                      {a.scheduled_at && <span className="u-faint"> · {fmtRelative(a.scheduled_at)}</span>}
                      {a.outcome && <span className="u-faint"> · {a.outcome}</span>}
                      {a.notes && <span className="u-faint"> · {a.notes}</span>}
                    </li>
                  ))}
                </ol>
              )}
          </Section>
        </div>
      </Drawer>

      {/* ---- offer letter modal ---- */}
      <Modal
        open={!!offerLead}
        onClose={() => { setOfferLead(null); setOfferLetter(null); }}
        title={`Offer letter — ${offerLead?.studentName ?? ''}`}
        sub="Generated from the lead record. Print or copy into your letterhead."
        footer={<Button variant="secondary" onClick={() => { if (offerLetter) navigator.clipboard?.writeText(offerLetter); }}>Copy letter</Button>}
      >
        <pre className="u-small" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>{offerLetter ?? 'Generating…'}</pre>
      </Modal>
    </div>
  );
}

/* ---------- small labelled text field ---------- */
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="u-col" style={{ gap: 4 }}>
      <span className="u-small u-muted">{label}</span>
      <input className="input" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  );
}
