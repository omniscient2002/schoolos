/* ============================================================
   Automation — two different things, kept visibly apart.

   1. RULES THAT RUN. `app.workflow_rules` + `server/scripts/workflow-
      worker.js` (the L2-5.2 decision) are real: the runner reads the
      outbox spine, matches topic + an optional top-level condition, and
      performs ONE action per rule (a derived event, or a queued message).
      A rule is created and disabled from this screen through
      /workflow-rules. Nothing about a rule is estimated.

   2. A LOCAL DRAFT LIBRARY. The cards, the run history, the success rate
      and the visual builder below are a workspace: they read the demo
      store and write to the device. They are labelled as such and are
      NOT a second runtime — there is exactly one runner, and it reads
      the rule table.

   F3 close-out: the decision doc's "delete the fiction" option was not
   needed — the runner shipped with tests, so this screen now pairs with
   it. What was left was the claim that no runtime exists, which had
   stopped being true when workflow-worker.js landed.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as seed from '../data/dataset';
import { workflowService } from '../demo/seedServices';
import { useStore } from '../state/store';
import {Badge, Button, Card, DataTable, Drawer, Empty, ErrorState, Modal, PageHead, SampleNote, Section, SkeletonCard, Stat, useToast, ClickThrough} from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDateTime, fmtNum, fmtRelative } from '../lib/format';
import { humanize, statusLabel } from '../lib/labels';
import { apiWorkflowRules, apiDisableWorkflowRule, apiCreateWorkflowRule, apiEvents, type WorkflowRule } from '../services/liveApi';
import { automationTemplates, type AutoTemplate } from '../services/complianceApi';
import { useRoleOrGrant } from '../lib/access';
import { friendly } from '../lib/friendlyErrors';
import type { WorkflowDef, WorkflowRun, WorkflowStep } from '../types/domain';

/* ---------- standard async hook (APP-SPEC pattern, local copy) ---------- */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => live && setState({ data: d, loading: false, error: null }))
      .catch(e => live && setState({ data: null, loading: false, error: String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

const STEP_ICON: Record<WorkflowStep['type'], ReactNode> = {
  condition: <Icon.Filter size={12} />,
  notify: <Icon.Message size={12} />,
  task: <Icon.Clipboard size={12} />,
  approval: <Icon.Key size={12} />,
  wait: <Icon.Clock size={12} />,
  update: <Icon.Refresh size={12} />,
};

const postureLabel = (p: WorkflowDef['posture']) => (p === 'APPROVAL' ? 'Needs approval' : p === 'HUMAN-ONLY' ? 'Never without a human' : 'Runs automatically');

const RUN_TONE: Record<WorkflowRun['status'], 'success' | 'warning' | 'danger' | 'info'> = {
  completed: 'success', 'awaiting-approval': 'warning', failed: 'danger', running: 'info',
};

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (next: boolean) => void }) {
  return (
    <label className="switch" title={on ? 'Enabled — click to pause' : 'Paused — click to enable'}>
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} aria-label={label} />
      <span className="track" />
    </label>
  );
}

function StepChips({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="u-flex" style={{ gap: 5, flexWrap: 'wrap' }}>
      {steps.slice(0, 4).map((s, i) => (
        <span key={s.id} className="u-flex u-xs mono" style={{ gap: 4, border: '1px solid var(--border)', borderRadius: 999, padding: '2px 8px', background: 'var(--surface-2)', color: 'var(--text-2)' }}>
          <span style={{ color: 'var(--accent-text)', fontWeight: 650 }}>{i + 1}</span>
          <span className="u-flex" style={{ gap: 3 }}>{STEP_ICON[s.type]}<span className="u-truncate" style={{ maxWidth: 130 }}>{s.label}</span></span>
        </span>
      ))}
      {steps.length > 4 && <span className="u-xs u-faint" style={{ alignSelf: 'center' }}>+{steps.length - 4} more</span>}
    </div>
  );
}

function StepFlow({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="u-col" style={{ gap: 0 }}>
      {steps.map((s, i) => (
        <div key={s.id} className="u-flex" style={{ gap: 10 }}>
          <div className="u-col" style={{ alignItems: 'center', flexShrink: 0 }}>
            <span className="u-flex" style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--accent-weak)', color: 'var(--accent-text)', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 650 }}>
              {STEP_ICON[s.type]}<span style={{ marginLeft: 2 }}>{i + 1}</span>
            </span>
            {i < steps.length - 1 && <span style={{ width: 1.5, flex: 1, minHeight: 18, background: 'var(--border-strong)' }} />}
          </div>
          <div style={{ minWidth: 0, paddingBottom: i < steps.length - 1 ? 14 : 0 }}>
            <div style={{ fontWeight: 580, fontSize: 'var(--text-md)' }}>{s.label}</div>
            {s.detail && <div className="u-small u-muted">{s.detail}</div>}
            <div className="u-xs u-faint" style={{ marginTop: 1 }}>{humanize(s.type)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function neverDoFor(w: WorkflowDef): string[] {
  if (w.posture === 'HUMAN-ONLY') {
    return ['Assembles evidence and drafts only — every decision rests with a named staff member'];
  }
  if (w.posture === 'APPROVAL') {
    return [
      'Never executes a step without a named human approver',
      'Never sends a message before the policy check passes',
      'Never touches safeguarding records (HUMAN-ONLY by constitution)',
      'Never messages a guardian during quiet hours 20:30–07:30',
    ];
  }
  return [
    'Never sends a message before the policy check passes',
    'Never touches safeguarding records (HUMAN-ONLY by constitution)',
    'Never messages a guardian during quiet hours 20:30–07:30',
    'Never repeats a notification to the same guardian within 12h',
  ];
}

const NL_EXAMPLES = [
  'When a guardian replies to an absence notification with a reason, classify it and create a follow-up task for the class teacher.',
  'If a compliance document expires within 14 days, tell the owner, and after 7 days pass it to the Admin Officer.',
  'When a bus is delayed more than 15 minutes, notify affected parents and mark attendance leniency for that route.',
  'When a payment fails for the second time, create a finance call task and pause automated reminders.',
];

type BNodeType = 'trigger' | 'condition' | 'notify' | 'task' | 'approval';
interface BNode { id: string; type: BNodeType; label: string; x: number; y: number }
const BUILDER_META: Record<BNodeType, { label: string; icon: ReactNode; color: string; def: string }> = {
  trigger: { label: 'Trigger', icon: <Icon.Zap size={13} />, color: 'var(--accent)', def: 'When event fires' },
  condition: { label: 'Condition', icon: <Icon.Filter size={13} />, color: 'var(--info)', def: 'Check condition' },
  notify: { label: 'Notify', icon: <Icon.Message size={13} />, color: 'var(--warning)', def: 'Notify (approval if bulk)' },
  task: { label: 'Task', icon: <Icon.Clipboard size={13} />, color: 'var(--text-2)', def: 'Create owner task' },
  approval: { label: 'Approval', icon: <Icon.Key size={13} />, color: 'var(--ai)', def: 'Human approval gate' },
};

export default function Automation() {
  const { session, dispatch, actorName } = useStore();
  const toast = useToast();

  const list = useAsync(() => workflowService.list(), []);
  const runs = useAsync(() => workflowService.runs(), []);

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const [nlText, setNlText] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<WorkflowDef | null>(null);
  const [drafts, setDrafts] = useState<WorkflowDef[]>([]);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [nodes, setNodes] = useState<BNode[]>([]);
  const [edges, setEdges] = useState<{ from: string; to: string }[]>([]);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);

  /* D6: the workflow runtime DOES exist server-side (workflow-worker + /workflow-rules doors).
     The owner/principal/IT admin can see and disable the rules that actually run; the library
     above stays an honest local workspace. */
  const canManageLive = useRoleOrGrant(['owner', 'principal', 'itadmin'], ['GET /workflow-rules']);
  const liveRules = useAsync(() => (canManageLive ? apiWorkflowRules() : Promise.resolve({ rules: [] as WorkflowRule[] })), [canManageLive]);
  const [busyRule, setBusyRule] = useState<string | null>(null);

  /* Starting points: the server's named templates over the same /workflow-rules doors.
     Applying one PREFILLS the rule form below — nothing is created until the office
     reviews and presses Create, so a template can never silently start running. */
  const templates = useAsync(() => (canManageLive ? automationTemplates().then(r => r.templates) : Promise.resolve([] as AutoTemplate[])), [canManageLive]);
  const applyTemplate = (t: AutoTemplate) => {
    setRuleForm(f => ({ ...f, name: t.name, topic: t.topic, field: '', op: 'equals', value: '',
      kind: 'outbox', actionTopic: String((t.action as Record<string, unknown>).topic ?? '') }));
    toast({ title: `“${t.name}” loaded below`, sub: 'Review it and press Create — the template itself runs nothing.', tone: 'info' });
  };

  /* Which topics this school actually emits, read from the event feed. A rule names a topic, and
     guessing one is how a rule sits enabled forever doing nothing — so the picker offers what the
     feed has carried, and the field stays editable for a topic the feed has not produced yet. */
  const recentTopics = useAsync(async () => {
    if (!canManageLive) return [] as string[];
    const res = await apiEvents();
    const seen = new Set<string>();
    for (const e of res.events ?? []) {
      const t = String((e as unknown as { topic?: string }).topic ?? e.type ?? '');
      if (t) seen.add(t);
    }
    return [...seen].slice(0, 12);
  }, [canManageLive]);

  const [ruleForm, setRuleForm] = useState({
    name: '', topic: '', field: '', op: 'equals', value: '',
    kind: 'outbox' as 'outbox' | 'comms', actionTopic: '', channel: 'in_app', body: '',
  });
  const [creating, setCreating] = useState(false);
  const setRule = (k: keyof typeof ruleForm, v: string) => setRuleForm(f => ({ ...f, [k]: v }));

  const createRule = async () => {
    if (!ruleForm.name.trim() || !ruleForm.topic.trim()) {
      toast({ title: 'A rule needs a name and the topic it listens to', tone: 'info' });
      return;
    }
    setCreating(true);
    try {
      /* The condition is optional and deliberately tiny — {field, op, value} against the payload's
         TOP level. The door refuses an op it does not know, so the picker only offers three. */
      const condition = ruleForm.field.trim()
        ? { field: ruleForm.field.trim(), op: ruleForm.op, value: ruleForm.value }
        : undefined;
      const action = ruleForm.kind === 'outbox'
        ? { kind: 'outbox' as const, topic: ruleForm.actionTopic.trim() || undefined, payload: {} }
        : { kind: 'comms' as const, channel: ruleForm.channel, audienceKind: 'custom', audience: [], template: 'WORKFLOW', body: ruleForm.body };
      await apiCreateWorkflowRule({ name: ruleForm.name.trim(), topic: ruleForm.topic.trim(), condition, action });
      toast({
        title: `Rule “${ruleForm.name.trim()}” created`,
        sub: `It applies to ${ruleForm.topic} events from now on. Earlier events are not replayed — the runner reads the outbox forward.`,
        tone: 'success',
      });
      setRuleForm({ name: '', topic: '', field: '', op: 'equals', value: '', kind: 'outbox', actionTopic: '', channel: 'in_app', body: '' });
      liveRules.retry();
      recentTopics.retry();
    } catch (e) {
      toast({ title: 'The rule was refused', sub: friendly(e), tone: 'error' });
    } finally { setCreating(false); }
  };

  const disableRule = async (rule: WorkflowRule) => {
    setBusyRule(rule.id);
    try {
      await apiDisableWorkflowRule(rule.id);
      toast({ title: `Rule disabled — ${rule.name}`, sub: 'It applies to no future events. The rule row is kept for the activity history.', tone: 'success' });
      liveRules.retry();
    } catch (e) {
      toast({ title: 'Could not disable the rule', sub: friendly(e), tone: 'error' });
    } finally { setBusyRule(null); }
  };

  const effective: WorkflowDef[] = useMemo(
    () => (list.data ?? seed.workflows).map(w => ({ ...w, enabled: overrides[w.id] ?? w.enabled })),
    [list.data, overrides],
  );
  const allRuns: WorkflowRun[] = runs.data ?? seed.workflowRuns;
  const selected = effective.find(w => w.id === openId) ?? null;
  const selectedRuns = selected ? allRuns.filter(r => r.workflowId === selected.id) : [];

  const activeCount = effective.filter(w => w.enabled).length;
  const runsThisMonth = effective.reduce((a, w) => a + w.runsThisMonth, 0);
  const awaiting = allRuns.filter(r => r.status === 'awaiting-approval').length;
  /* L5-4.2: success rate computed from the actual run log — null when there
     is nothing to compute (never a hardcoded number). */
  const finished = allRuns.filter(r => r.status === 'completed' || r.status === 'failed');
  const successRate: number | null = finished.length
    ? Math.round((finished.filter(r => r.status === 'completed').length / finished.length) * 100)
    : null;

  const openBuilder = () => {
    setNodes([{ id: 'n0', type: 'trigger', label: BUILDER_META.trigger.def, x: 28, y: 28 }]);
    setEdges([]); setConnectFrom(null);
    setBuilderOpen(true);
  };

  const toggleWf = async (wf: WorkflowDef, next: boolean) => {
    setOverrides(o => ({ ...o, [wf.id]: next }));
    try {
      await workflowService.toggle(wf.id, next);
      /* L5-4.2 honesty: workflowService.toggle mutates the LOCAL demo store —
         these library cards are drafts, not rules. The runner on the server
         reads app.workflow_rules and nothing else, so toggling a card here
         changes no behaviour. Say exactly that; no "runs are processed" claims. */
      toast({
        title: next ? `Workflow enabled — ${wf.name}` : `Workflow paused — ${wf.name}`,
        sub: next
          ? 'Saved in this workspace only — this is a local library entry, not a server rule, so no runs are scheduled.'
          : 'Removed from the local workspace only; no server rule was changed.',
        tone: 'success',
      });
      dispatch({
        type: 'audit/add',
        entry: {
          actor: actorName, actorRole: session.roleId,
          action: next ? 'Enabled workflow' : 'Paused workflow',
          recordType: 'Workflow', recordRef: `${wf.id} — ${wf.name}`,
          policyRef: `Posture: ${postureLabel(wf.posture)}`,
          aiInvolved: false, risk: next ? 'low' : 'medium',
          outcome: next ? 'Enabled in the local workspace — local library entry, not a server rule' : 'Paused by staff — local workspace',
        },
      });
    } catch {
      setOverrides(o => ({ ...o, [wf.id]: !next }));
      toast({ title: 'Could not update workflow', sub: 'The change was rolled back locally.', tone: 'error' });
    }
  };

  const compile = async () => {
    if (!nlText.trim()) { toast({ title: 'Describe the automation first', sub: 'One or two plain sentences is enough.', tone: 'info' }); return; }
    setCompiling(true);
    try {
      const def = await workflowService.compileFromNaturalLanguage(nlText.trim());
      setCompiled(def);
    } catch (e) {
      toast({ title: 'Compilation failed', sub: String(e), tone: 'error' });
    } finally {
      setCompiling(false);
    }
  };

  const saveDraft = (def: WorkflowDef) => {
    setDrafts(d => [def, ...d]);
    setCompiled(null); setNlText('');
    toast({ title: `Saved as draft — ${def.name}`, sub: 'Saved as a local draft in this workspace — a local draft never runs; only a server rule runs.', tone: 'success' });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Saved NL-compiled workflow draft',
        recordType: 'Workflow', recordRef: def.name, policyRef: 'AI Governance §1.0 (drafting allowed)',
        aiInvolved: true, risk: 'low', outcome: 'Draft stored — observe-only until enabled',
      },
    });
  };

  const runObserve = (def: WorkflowDef) => {
    /* review NIT: nothing is queued anywhere — the draft is noted, not run. */
    toast({ title: `Observe run noted — ${def.name}`, sub: 'Drafts do not execute — only server rules run. Nothing was queued and no side effects occurred.', tone: 'info' });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Noted observe-mode draft run',
        recordType: 'Workflow', recordRef: def.name, policyRef: 'Posture: AUTO (observe-only, first 3 runs)',
        aiInvolved: true, risk: 'low', outcome: 'Draft noted for observe mode — local draft, not a server rule',
      },
    });
  };

  const addNode = (type: BNodeType) => {
    if (nodes.length >= 12) { toast({ title: 'Canvas is full', sub: '12 nodes keep automations reviewable. Split complex flows instead.', tone: 'info' }); return; }
    const id = `n${nodes.length + 1}_${Date.now().toString(36).slice(-3)}`;
    setNodes(ns => [...ns, { id, type, label: BUILDER_META[type].def, x: 28 + (ns.length % 3) * 172, y: 28 + Math.floor(ns.length / 3) * 72 }]);
  };

  const nodeClick = (n: BNode) => {
    if (connectFrom === n.id) { setConnectFrom(null); return; }
    if (connectFrom) {
      setEdges(es => (es.some(e => e.from === connectFrom && e.to === n.id) || es.some(e => e.from === n.id && e.to === connectFrom))
        ? es
        : [...es, { from: connectFrom, to: n.id }]);
      setConnectFrom(null);
      return;
    }
    setConnectFrom(n.id);
  };

  const removeSelected = () => {
    if (!connectFrom) return;
    setNodes(ns => ns.filter(n => n.id !== connectFrom));
    setEdges(es => es.filter(e => e.from !== connectFrom && e.to !== connectFrom));
    setConnectFrom(null);
  };

  const saveBuilder = () => {
    /* review MAJOR: the toast previously claimed a save while nodes/edges were
       discarded. The draft now REALLY lands in this workspace's drafts list
       (local only — no server runtime exists to persist it, and the copy
       says exactly that). */
    const def: WorkflowDef = {
      id: `wf_vis_${Date.now()}`,
      name: `Visual draft · ${nodes.length} step${nodes.length === 1 ? '' : 's'}`,
      description: `Built in the visual builder — ${edges.length} connection${edges.length === 1 ? '' : 's'}. Local draft; not a server rule.`,
      trigger: { event: 'draft.builder', label: BUILDER_META.trigger.def, condition: 'Set when this draft becomes a server rule' },
      steps: nodes.map(n => ({
        id: n.id,
        type: n.type === 'trigger' ? 'condition' : n.type,
        label: n.label,
        detail: BUILDER_META[n.type].def,
      })),
      enabled: false,
      runsThisMonth: 0,
      source: 'custom',
      posture: 'APPROVAL',
    };
    setDrafts(d => [def, ...d]);
    toast({
      title: 'Draft saved in this workspace',
      sub: `${nodes.length} nodes · ${edges.length} connections · kept in the drafts list below — a local draft never runs; only a server rule runs.`,
      tone: 'success',
    });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Built workflow in visual builder',
        recordType: 'Workflow', recordRef: `visual draft · ${nodes.length} nodes`,
        policyRef: 'Constitution guardrails applied at runtime',
        aiInvolved: false, risk: 'low', outcome: 'Local draft saved — not a server rule; nothing runs from here',
      },
    });
    setBuilderOpen(false);
  };

  const byId = (id: string) => nodes.find(n => n.id === id);

  return (
    <>
      <PageHead
        title="Automation"
        sub="Constitution-gated automations — the server step-runner acts on the live rules below; the workflow library here is a local workspace of drafts."
        actions={<Button variant="secondary" icon={<Icon.Grid size={14} />} onClick={openBuilder}>Visual builder</Button>}
      />

      <SampleNote>Sample automation library — the workflow cards and run counts here are illustrative local drafts, not school records. Rules that actually run are listed under &ldquo;Rules running on the server&rdquo;.</SampleNote>

      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Active workflows" value={activeCount} sub={`of ${effective.length} in the library`} />
        <Stat label="Runs this month" value={fmtNum(runsThisMonth)} sub="sample data — local library only" />
        <Stat label="Awaiting approval" value={awaiting} sub="runs paused at an approval node" />
        {/* L5-4.2: the hardcoded 99.2% / "4 failed runs auto-retried" was
            fiction — computed from the actual run log or honestly absent. */}
        {successRate === null
          ? <Stat label="Success rate" unavailable="No runs yet" sub="no logged runs to compute from" />
          : <Stat label="Success rate" value={`${successRate}%`} sub={`of ${finished.length} finished runs · sample data`} />}
      </div>

      <Section
        title="Workflow library"
        sub="Click a card for the full flow, recent runs, and the guarantees this automation operates under."
        actions={<Button variant="ghost" size="sm" icon={<Icon.Refresh size={13} />} onClick={list.retry}>Refresh</Button>}
      >
        {list.loading && (
          <div className="grid grid-2">
            <SkeletonCard lines={4} /><SkeletonCard lines={4} /><SkeletonCard lines={4} /><SkeletonCard lines={4} />
          </div>
        )}
        {list.error && <ErrorState title="Could not load workflows" sub={list.error} onRetry={list.retry} />}
        {!list.loading && !list.error && effective.length === 0 && (
          <Empty icon={<Icon.Workflow size={26} />} title="No workflows yet" sub="Compile one from plain words below, or draw it in the visual builder." />
        )}
        {!list.loading && !list.error && effective.length > 0 && (
          <div className="auto-grid">
            {effective.map(wf => (
              <Card key={wf.id} onClick={() => setOpenId(wf.id)}>
                <div className="u-between" style={{ gap: 10, marginBottom: 6, alignItems: 'flex-start' }}>
                  <div className="u-flex" style={{ gap: 8, minWidth: 0 }}>
                    <span className="u-flex" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-weak)', color: 'var(--accent-text)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon.Workflow size={15} />
                    </span>
                    <span className="u-col" style={{ gap: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 620, lineHeight: 1.3 }}>{wf.name}</span>
                      <span className={`u-flex u-xs ${wf.posture === 'APPROVAL' ? 'wf-posture-approval' : ''}`} style={{ gap: 5, fontWeight: 600, color: !wf.enabled ? 'var(--text-3)' : wf.posture === 'APPROVAL' ? 'var(--status-warning)' : 'var(--success)' }}>
                        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: 'currentColor', display: 'inline-block' }} />
                        {wf.enabled ? 'On' : 'Paused'} · {wf.posture === 'APPROVAL' ? 'needs approval' : 'runs on its own'}
                      </span>
                    </span>
                  </div>
                  <ClickThrough className="wf-toggle"><Toggle on={wf.enabled} label={`Toggle ${wf.name}`} onChange={next => void toggleWf(wf, next)} /></ClickThrough>
                </div>
                <div className="u-small u-muted" style={{ marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{wf.description}</div>
                <div className="u-small" style={{ marginBottom: 3 }}>
                  <span className="u-faint">Trigger · </span>{wf.trigger.label}
                </div>
                {wf.trigger.condition && <div className="u-xs u-faint" style={{ marginBottom: 8 }}>Condition: {wf.trigger.condition}</div>}
                <div style={{ marginBottom: 10 }}><StepChips steps={wf.steps} /></div>
                <div className="auto-meta">
                  <span>Runs <b className="tnum">{fmtNum(wf.runsThisMonth)}</b>/mo</span>
                  <span>Last run <b>{wf.lastRun ? fmtRelative(wf.lastRun) : '—'}</b></span>
                  <span>Source <b>{wf.source === 'nl' ? 'compiled' : humanize(wf.source)}</b></span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {canManageLive && (
        <Section
          title="Rules running on the server"
          sub="When a matching event fires, the step-runner applies each enabled rule — one action per rule (a derived event, or a queued message). Rules apply to events from now on; nothing already in the spine is replayed."
          actions={<Button variant="ghost" size="sm" icon={<Icon.Refresh size={13} />} onClick={() => { liveRules.retry(); recentTopics.retry(); }}>Refresh</Button>}
        >
          <Card headAs="h3" head="Starting points" sub="Six honest starting points — each one fills the rule form below for review. Templates never run on their own.">
            {templates.loading ? <div className="u-small u-muted">Reading the starting points…</div>
              : templates.error ? <ErrorState title="Could not read the starting points" sub={String(templates.error)} onRetry={templates.retry} />
                : (templates.data ?? []).length === 0 ? <div className="u-small u-muted">No starting points on this deployment.</div>
                  : (
                    <div className="u-col" style={{ gap: 8 }}>
                      {(templates.data ?? []).map(t => (
                        <div key={t.key} className="u-between u-small" style={{ gap: 10 }}>
                          <span style={{ minWidth: 0 }}><strong>{t.name}</strong> <span className="u-faint">· listens to {t.topic}</span><br />
                            <span className="u-muted">{t.blurb}</span></span>
                          <Button variant="ghost" size="sm" onClick={() => applyTemplate(t)}>Use</Button>
                        </div>
                      ))}
                    </div>
                  )}
          </Card>
          <Card headAs="h3" head="Add a rule" sub="Name it, choose the topic it listens to, and say what it should do. Nothing runs until the rule row exists here.">
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              <label style={{ fontSize: 13 }}>Rule name
                <input value={ruleForm.name} onChange={e => setRule('name', e.target.value)} placeholder="e.g. Absent pupil → guardian SMS" aria-label="Rule name" />
              </label>
              <label style={{ fontSize: 13 }}>Listens to topic
                <input
                  list="workflow-topics" value={ruleForm.topic} onChange={e => setRule('topic', e.target.value)}
                  placeholder="attendance.marked" aria-label="Topic the rule listens to"
                />
                <datalist id="workflow-topics">
                  {(recentTopics.data ?? []).map(t => <option key={t} value={t} />)}
                </datalist>
              </label>
              <label style={{ fontSize: 13 }}>Only when a field…
                <input value={ruleForm.field} onChange={e => setRule('field', e.target.value)} placeholder="leave blank to match every event" aria-label="Condition field" />
              </label>
              <label style={{ fontSize: 13 }}>…is
                <select value={ruleForm.op} onChange={e => setRule('op', e.target.value)} aria-label="Condition operator" disabled={!ruleForm.field.trim()}>
                  {['equals', 'contains', 'exists'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>…this value
                <input value={ruleForm.value} onChange={e => setRule('value', e.target.value)} aria-label="Condition value" disabled={!ruleForm.field.trim() || ruleForm.op === 'exists'} />
              </label>
              <label style={{ fontSize: 13 }}>Then
                <select value={ruleForm.kind} onChange={e => setRule('kind', e.target.value)} aria-label="Action kind">
                  <option value="outbox">publish a derived event</option>
                  <option value="comms">queue a message</option>
                </select>
              </label>
              {ruleForm.kind === 'outbox' ? (
                <label style={{ fontSize: 13 }}>Derived topic
                  <input value={ruleForm.actionTopic} onChange={e => setRule('actionTopic', e.target.value)} placeholder="blank = the same topic, suffixed .workflow" aria-label="Derived topic" />
                </label>
              ) : (
                <>
                  <label style={{ fontSize: 13 }}>Channel
                    <select value={ruleForm.channel} onChange={e => setRule('channel', e.target.value)} aria-label="Message channel">
                      {['in_app', 'sms', 'whatsapp', 'email'].map(c => <option key={c} value={c}>{humanize(c)}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>Message body
                    <input value={ruleForm.body} onChange={e => setRule('body', e.target.value)} placeholder="What the recipient should read" aria-label="Message body" />
                  </label>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="primary" size="sm" loading={creating} onClick={() => void createRule()}>Create the rule</Button>
              <span className="u-xs u-faint">
                One action per rule per event, applied once (the runner dedupes on rule + event). A published event never
                re-triggers a rule, so a rule cannot loop.
              </span>
            </div>
          </Card>
          {liveRules.loading && <SkeletonCard lines={3} />}
          {liveRules.error && <ErrorState title="Could not load live rules" sub={friendly(liveRules.error)} onRetry={liveRules.retry} />}
          {!liveRules.loading && !liveRules.error && (liveRules.data?.rules ?? []).length === 0 && (
            <Empty icon={<Icon.Workflow size={24} />} title="No live rules" sub="Rules created through the owner/IT admin API appear here. The drafts in the library above are a local workspace and never run." />
          )}
          {!liveRules.loading && !liveRules.error && (liveRules.data?.rules ?? []).length > 0 && (
            <DataTable<WorkflowRule>
              caption="Live automation rules processed by the server step-runner"
              rows={liveRules.data!.rules}
              rowKey={r => r.id}
              columns={[
                { key: 'name', label: 'Rule', render: r => (<div><div style={{ fontWeight: 570 }}>{r.name}</div><div className="u-xs mono u-faint">{humanize(r.topic)}</div></div>) },
                { key: 'action', label: 'Action taken', render: r => <span className="u-small">{humanize((r.action?.kind as string) ?? 'outbox')}</span> },
                { key: 'status', label: 'Status', render: r => <Badge tone={r.enabled ? 'success' : 'outline'}>{r.enabled ? 'Enabled' : 'Disabled'}</Badge> },
                { key: 'actions', label: '', align: 'right', render: r => (
                  <Button size="sm" variant="ghost" disabled={!r.enabled || busyRule === r.id} onClick={() => void disableRule(r)}>Disable</Button>
                ) },
              ]}
            />
          )}
        </Section>
      )}

      <Section
        title="Describe an automation in plain words"
        sub="A local draft-builder turns your sentence into an editable draft workflow, with the school's policy guardrails pre-applied. No server compiler is connected — this stays a local draft and never runs; a server rule (above) is how an automation actually runs."
      >
        <Card>
          <textarea
            className="textarea"
            rows={3}
            value={nlText}
            onChange={e => setNlText(e.target.value)}
            placeholder="e.g. When a guardian replies to an absence notification, classify the reason and create a follow-up task for the class teacher."
            aria-label="Describe an automation in plain words"
          />
          <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 12px' }}>
            {NL_EXAMPLES.map(ex => (
              <button
                key={ex}
                className="u-xs"
                style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer', textAlign: 'left' }}
                onClick={() => setNlText(ex)}
              >
                {ex.length > 72 ? `${ex.slice(0, 70)}…` : ex}
              </button>
            ))}
          </div>
          <div className="u-flex" style={{ gap: 8 }}>
            <Button variant="ai" icon={<Icon.Sparkle size={14} />} loading={compiling} onClick={() => void compile()}>Compile draft</Button>
            <Button variant="ghost" onClick={() => { setNlText(''); setCompiled(null); }}>Clear</Button>
          </div>

          {compiled && (
            <div style={{ marginTop: 14, border: '1px solid var(--ai-weak-2)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              <div className="u-between" style={{ padding: '8px 12px', background: 'var(--ai-weak)' }}>
                <span className="u-flex" style={{ gap: 7 }}>
                  <Icon.Sparkle size={13} style={{ color: 'var(--ai-text)' }} />
                  <span style={{ fontWeight: 620, fontSize: 'var(--text-sm)', color: 'var(--ai-text)' }}>Compiled draft</span>
                </span>
                <Badge tone="ai">compiled from words</Badge>
              </div>
              <div className="u-col" style={{ padding: 12, gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{compiled.name}</div>
                  <div className="u-small u-muted">{compiled.description}</div>
                </div>
                <div className="u-small">
                  <span className="u-faint">Trigger guessed · </span>
                  <span>{compiled.trigger.label}</span>
                  {compiled.trigger.condition && <span className="u-faint"> · condition: {compiled.trigger.condition}</span>}
                </div>
                <StepChips steps={compiled.steps} />
                <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Badge tone="success">posture: AUTO</Badge>
                  <Badge tone="warning">first 3 runs observe-only</Badge>
                  <Badge tone="outline">Constitution guardrails applied</Badge>
                </div>
                <div className="u-flex" style={{ gap: 8 }}>
                  <Button variant="primary" size="sm" icon={<Icon.Check size={13} />} onClick={() => saveDraft(compiled)}>Save as draft</Button>
                  <Button variant="secondary" size="sm" icon={<Icon.Play size={12} />} onClick={() => runObserve(compiled)}>Run in observe mode</Button>
                </div>
              </div>
            </div>
          )}

          {drafts.length > 0 && (
            <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              <span className="u-xs u-faint" style={{ alignSelf: 'center' }}>Saved drafts:</span>
              {drafts.map(d => <Badge key={d.id} tone="outline">{d.name}</Badge>)}
            </div>
          )}
        </Card>
      </Section>

      {/* ---------- workflow detail drawer ---------- */}
      <Drawer
        open={!!selected}
        onClose={() => setOpenId(null)}
        title={selected?.name ?? ''}
        sub={selected ? `${postureLabel(selected.posture)} · ${fmtNum(selected.runsThisMonth)} runs this month · source: ${humanize(selected.source)}` : undefined}
        footer={selected && (
          <>
            <Button variant={selected.enabled ? 'danger-ghost' : 'primary'} onClick={() => void toggleWf(selected, !selected.enabled)}>
              {selected.enabled ? 'Pause workflow' : 'Enable workflow'}
            </Button>
            <Button variant="ghost" onClick={() => setOpenId(null)}>Close</Button>
          </>
        )}
      >
        {selected && (
          <div className="u-col" style={{ gap: 18 }}>
            <div>
              <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>Trigger</div>
              <div className="u-flex" style={{ gap: 9, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}>
                <Icon.Zap size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 580 }}>{selected.trigger.label}</div>
                  {selected.trigger.condition && <div className="u-small u-muted" style={{ marginTop: 2 }}>Condition: {selected.trigger.condition}</div>}
                </div>
              </div>
            </div>

            <div>
              <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Steps</div>
              <StepFlow steps={selected.steps} />
            </div>

            <div>
              <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Recent runs</div>
              {selectedRuns.length === 0 ? (
                <Empty title="No runs recorded yet" sub="This workflow executes when its trigger event fires; every run lands here." />
              ) : (
                <div className="u-col" style={{ gap: 8 }}>
                  {selectedRuns.slice(0, 6).map(r => (
                    <div key={r.id} className="u-between" style={{ gap: 10, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="u-small u-truncate" style={{ fontWeight: 570 }}>{r.triggerRecord}</div>
                        <div className="u-xs u-faint">{fmtDateTime(r.on)} · {r.stepsCompleted}/{r.totalSteps} steps</div>
                        <div className="progress" style={{ height: 4, marginTop: 5, maxWidth: 180 }}>
                          <div style={{ width: `${(r.stepsCompleted / r.totalSteps) * 100}%`, background: r.status === 'failed' ? 'var(--danger)' : 'var(--accent)' }} />
                        </div>
                      </div>
                      <Badge tone={RUN_TONE[r.status]}>{statusLabel(r.status)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 12, background: 'var(--surface-2)' }}>
              <div className="u-flex u-small" style={{ gap: 7, fontWeight: 620, marginBottom: 6 }}>
                <Icon.Shield size={14} style={{ color: 'var(--accent)' }} /> What this automation will never do
              </div>
              <ul className="u-small u-muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
                {neverDoFor(selected).map(l => <li key={l}>{l}</li>)}
              </ul>
            </div>
          </div>
        )}
      </Drawer>

      {/* ---------- visual builder modal ---------- */}
      <Modal
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        title="Visual builder"
        sub="Click a node type to add it · click two nodes in turn to connect them · save writes a draft to the library."
        size="lg"
        footer={
          <>
            <Button variant="ghost" icon={<Icon.Trash size={13} />} onClick={removeSelected} disabled={!connectFrom}>Remove selected node</Button>
            <div style={{ flex: 1 }} />
            <Button variant="ghost" onClick={() => setBuilderOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={13} />} onClick={saveBuilder}>Save draft ({nodes.length} nodes · {edges.length} links)</Button>
          </>
        }
      >
        <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {(Object.keys(BUILDER_META) as BNodeType[]).map(t => (
            <button
              key={t}
              className="u-flex u-xs"
              style={{ gap: 5, border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', background: 'var(--surface)', cursor: 'pointer' }}
              onClick={() => addNode(t)}
              aria-label={`Add ${BUILDER_META[t].label} node`}
            >
              {BUILDER_META[t].icon}<span>{BUILDER_META[t].label}</span><Icon.Plus size={11} />
            </button>
          ))}
          <span className="u-xs u-faint" style={{ alignSelf: 'center', marginLeft: 6 }}>
            {connectFrom ? 'Now click a second node to draw the connection.' : 'Connections run in the order drawn.'}
          </span>
        </div>
        <div /* eslint-disable-line jsx-a11y/no-noninteractive-element-interactions -- drawing canvas is role=application by design; pointer + Esc keyboard paths provided */
          style={{
            position: 'relative', height: 320, border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden',
            background: 'radial-gradient(var(--border-subtle) 1px, transparent 1px)', backgroundSize: '18px 18px', backgroundPosition: '9px 9px',
          }}
          onClick={() => setConnectFrom(null)}
          onKeyDown={e => { if (e.key === 'Escape') setConnectFrom(null); }}
          role="application"
          aria-label="Workflow builder canvas">
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden="true">
            {edges.map((e, i) => {
              const a = byId(e.from); const b = byId(e.to);
              if (!a || !b) return null;
              return <line key={i} x1={a.x + 62} y1={a.y + 19} x2={b.x + 62} y2={b.y + 19} stroke="var(--accent)" strokeWidth={1.6} />;
            })}
          </svg>
          {nodes.map(n => {
            const meta = BUILDER_META[n.type];
            const isFrom = connectFrom === n.id;
            return (
              <button
                key={n.id}
                className="u-flex"
                style={{
                  position: 'absolute', left: n.x, top: n.y, width: 124, height: 38, gap: 6, alignItems: 'center',
                  paddingLeft: 9, borderRadius: 9, cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)',
                  border: `1.5px solid ${isFrom ? 'var(--accent)' : 'var(--border)'}`,
                  boxShadow: isFrom ? '0 0 0 3px var(--accent-weak)' : 'var(--shadow-xs)',
                  borderLeft: `3px solid ${meta.color}`,
                }}
                onClick={e => { e.stopPropagation(); nodeClick(n); }}
                aria-label={`${meta.label} node: ${n.label}`}
              >
                {meta.icon}
                <span className="u-xs u-truncate" style={{ textAlign: 'left', fontWeight: 570 }}>{n.label}</span>
              </button>
            );
          })}
          {nodes.length === 0 && <Empty icon={<Icon.Workflow size={22} />} title="Canvas is empty" sub="Add a trigger node to begin." titleAs="h3" style={{ padding: '60px 0' }} />}
        </div>
      </Modal>
    </>
  );
}
