/* ============================================================
   Incidents — the lifecycle board: Detected → Triaged →
   Assigned → In-progress → Resolved → Reviewed.
   ============================================================ */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Badge, Button, Card, Dropdown, Drawer, Empty, ErrorState, PageHead, Section, SkeletonCard, Stat, Timeline, useToast } from '../components/ui';
import { Sparkline } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateTime, fmtRelative } from '../lib/format';
import type { SchoolCase } from '../types/domain';
import type { IncidentRecord } from '../types/domain';

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

const STATUS_ORDER: IncidentRecord['status'][] = ['detected', 'triaged', 'assigned', 'in-progress', 'resolved', 'reviewed'];
const STATUS_LABEL: Record<IncidentRecord['status'], string> = {
  detected: 'Detected', triaged: 'Triaged', assigned: 'Assigned', 'in-progress': 'In-progress', resolved: 'Resolved', reviewed: 'Reviewed',
};
const SEVERITY_TONE: Record<IncidentRecord['severity'], 'neutral' | 'info' | 'warning' | 'danger'> = {
  low: 'neutral', medium: 'info', high: 'warning', critical: 'danger',
};
const SEVERITY_COLOR: Record<IncidentRecord['severity'], string> = {
  low: 'var(--border-strong)', medium: 'var(--warning)', high: 'var(--danger)', critical: 'var(--danger)',
};
const KIND_TONE: Record<IncidentRecord['kind'], 'accent' | 'info' | 'neutral' | 'outline' | 'warning' | 'danger'> = {
  transport: 'accent', payment: 'info', facilities: 'neutral', student: 'warning', it: 'info', compliance: 'danger', parent: 'accent', other: 'outline',
};
const CAMPUS_LABEL: Record<IncidentRecord['campus'], string> = { north: 'North', city: 'City', east: 'East' };

function linkedFor(inc: IncidentRecord): { label: string; ref: string }[] {
  switch (inc.kind) {
    case 'transport': return [{ label: 'Routes & live status', ref: '/transport' }, { label: 'Attendance leniency', ref: '/attendance' }];
    case 'payment': return [{ label: 'Fees records', ref: '/fees' }, { label: 'Payment matching case', ref: '/cases' }];
    case 'facilities': return [{ label: 'Maintenance flagship', ref: '/maintenance' }];
    case 'student': return [{ label: 'Operations desk', ref: '/operations' }];
    case 'compliance': return [{ label: 'Obligations', ref: '/operations' }];
    case 'it': return [{ label: 'IT admin', ref: '/it' }];
    default: return [{ label: 'Operations desk', ref: '/operations' }];
  }
}

export default function Incidents() {
  const { session, dispatch, actorName, domain } = useStore();
  const toast = useToast();
  const navigate = useNavigate();

  const incidents = useAsync<IncidentRecord[]>(() => Promise.resolve(seed.incidents.map(i => ({ ...i }))), []);
  const [statusOv, setStatusOv] = useState<Record<string, IncidentRecord['status']>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const data: IncidentRecord[] = (incidents.data ?? seed.incidents).map(i => (statusOv[i.id] ? { ...i, status: statusOv[i.id] } : i));
  const selected = data.find(i => i.id === openId) ?? null;

  const isOpen = (s: IncidentRecord['status']) => s !== 'resolved' && s !== 'reviewed';
  const openCount = data.filter(i => isOpen(i.status)).length;
  const highOpen = data.filter(i => isOpen(i.status) && (i.severity === 'high' || i.severity === 'critical')).length;

  const advance = (inc: IncidentRecord, next: IncidentRecord['status']) => {
    setStatusOv(o => ({ ...o, [inc.id]: next }));
    toast({ title: `Incident moved to ${STATUS_LABEL[next]}`, sub: `${inc.id} · ${inc.title}`, tone: 'success' });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: `Incident → ${STATUS_LABEL[next]}`,
        recordType: 'Incident', recordRef: `${inc.id} — ${inc.title}`,
        reason: 'Status advanced from incident board', aiInvolved: false,
        risk: inc.severity === 'critical' ? 'high' : inc.severity === 'high' ? 'medium' : 'low',
        outcome: `Lifecycle moved to ${STATUS_LABEL[next]}`,
      },
    });
  };

  const openAsCase = (inc: IncidentRecord) => {
    const id = `case_inc_${inc.id.replace('inc_', '')}`;
    if (domain.cases.some(c => c.id === id)) { navigate(`/cases/${id}`); return; }
    const c: SchoolCase = {
      id, kind: 'incident', title: inc.title, openedOn: new Date(), openedBy: actorName,
      origin: 'staff', owner: inc.owner,
      priority: inc.severity === 'critical' ? 'critical' : inc.severity === 'high' ? 'high' : 'normal',
      slaHours: 24, status: 'open', campus: inc.campus,
      messages: [{ on: new Date(), from: 'SchoolOS (auto)', text: `Case opened from incident ${inc.id} by ${actorName} · incident timeline and evidence linked`, internal: true }],
      linkedRecords: [{ label: `Incident ${inc.id}`, ref: '/incidents' }, ...linkedFor(inc)],
    };
    dispatch({ type: 'case/add', c });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Opened case from incident',
        recordType: 'Case', recordRef: `${id} — ${inc.title}`,
        reason: 'Incident needs coordinated follow-up across owners', aiInvolved: false, risk: 'medium',
        outcome: 'Case opened · SLA 24h · linked to incident timeline',
      },
    });
    toast({ title: 'Case opened from incident', sub: `${id} · SLA 24h · linked to ${inc.id}`, tone: 'success' });
    navigate(`/cases/${id}`);
  };

  const requestMaintenance = (inc: IncidentRecord) => {
    toast({ title: 'Maintenance request sent', sub: `Vendor slot requested for ${CAMPUS_LABEL[inc.campus]} campus — admin officer notified`, tone: 'success' });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Requested maintenance',
        recordType: 'Facilities', recordRef: `${inc.id} — ${inc.title}`,
        reason: 'Repair or vendor visit needed', aiInvolved: false, risk: 'low',
        outcome: 'Vendor request queued · admin officer assigned',
      },
    });
  };

  return (
    <>
      <PageHead
        title="Incidents"
        sub={session.roleId === 'transport'
          ? 'Transport-linked incidents surface first for your role. Every status change is audit-logged.'
          : 'Everything that went wrong, from detection to review — with the timeline that proves what happened.'}
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Open incidents" value={openCount} sub={`of ${data.length} in the last 30 days`} />
        <Stat label="High / critical open" value={highOpen} sub="escalation policy applies above 0" />
        <Stat label="Avg time-to-resolve" value="6.2h" sub="last 30 days · target 8h" />
        <Stat label="MTTR trend" value="6.2h" delta={{ value: '0.4h faster', dir: 'down' }} spark={<Sparkline points={[7.8, 7.2, 6.9, 6.6, 6.4, 6.2]} width={80} height={26} />} sub="weekly, trailing 6 weeks" />
      </div>

      <Section
        title="Lifecycle board"
        sub="Cards move left to right as they are handled. Click a card for the full timeline and actions."
        actions={<Button variant="ghost" size="sm" icon={<Icon.Refresh size={13} />} onClick={incidents.retry}>Refresh</Button>}
      >
        {incidents.loading && (
          <div className="grid grid-3"><SkeletonCard lines={4} /><SkeletonCard lines={4} /><SkeletonCard lines={4} /></div>
        )}
        {incidents.error && <ErrorState title="Could not load incidents" sub={incidents.error} onRetry={incidents.retry} />}
        {!incidents.loading && !incidents.error && data.length === 0 && (
          <Empty icon={<Icon.Alert size={26} />} title="No incidents" sub="Nothing has gone wrong recently. The board fills automatically from monitors." />
        )}
        {!incidents.loading && !incidents.error && data.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <div className="u-flex" style={{ gap: 12, alignItems: 'flex-start', minWidth: 980 }}>
              {STATUS_ORDER.map(st => {
                const col = data.filter(i => i.status === st);
                return (
                  <div key={st} style={{ flex: 1, minWidth: 150 }}>
                    <div className="u-between" style={{ padding: '0 2px 8px' }}>
                      <span className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{STATUS_LABEL[st]}</span>
                      <Badge tone={col.length ? 'accent' : 'outline'}>{col.length}</Badge>
                    </div>
                    <div className="u-col" style={{ gap: 8 }}>
                      {col.length === 0 && (
                        <div className="u-xs u-faint" style={{ border: '1px dashed var(--border)', borderRadius: 'var(--r-md)', padding: '12px 10px', textAlign: 'center' }}>—</div>
                      )}
                      {col.map(inc => (
                        <Card key={inc.id} onClick={() => setOpenId(inc.id)} className="incident-card">
                          <div style={{ borderLeft: `3px solid ${SEVERITY_COLOR[inc.severity]}`, paddingLeft: 9 }}>
                            <div className="u-flex" style={{ gap: 5, flexWrap: 'wrap', marginBottom: 5 }}>
                              <Badge tone={KIND_TONE[inc.kind]}>{inc.kind}</Badge>
                              <Badge tone={SEVERITY_TONE[inc.severity]}>{inc.severity}</Badge>
                            </div>
                            <div className="u-small" style={{ fontWeight: 590, lineHeight: 1.35, marginBottom: 5 }}>{inc.title}</div>
                            <div className="u-xs u-faint">
                              {CAMPUS_LABEL[inc.campus]} · {inc.owner}
                            </div>
                            <div className="u-xs u-faint">Opened {fmtRelative(inc.openedOn)}</div>
                            {inc.id === 'inc_1' && (
                              <div className="u-xs" style={{ marginTop: 5, color: 'var(--accent-text)', fontWeight: 600 }}>Bus 14 — flagship incident, 6-step timeline inside</div>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      <Drawer
        open={!!selected}
        onClose={() => setOpenId(null)}
        title={selected?.title ?? ''}
        sub={selected ? `${selected.id} · ${STATUS_LABEL[selected.status]} · ${selected.severity} severity` : undefined}
        footer={selected && (
          <>
            <Dropdown
            label="Status advance"
              trigger={() => <Button variant="primary" icon={<Icon.ArrowRight size={13} />}>Advance status</Button>}
              align="left"
            >
              {close => {
                const idx = STATUS_ORDER.indexOf(selected.status);
                const nexts = STATUS_ORDER.slice(idx + 1);
                return nexts.length === 0
                  ? <div className="u-small u-muted" style={{ padding: '8px 12px' }}>Already at the final stage.</div>
                  : (
                    <div className="u-col" style={{ padding: 4 }}>
                      {nexts.map(s => (
                        <button
                          key={s}
                          role="menuitem"
                          className="u-small"
                          style={{ textAlign: 'left', padding: '7px 10px', borderRadius: 8, cursor: 'pointer', border: 'none', background: 'transparent' }}
                          onClick={() => { advance(selected, s); close(); }}
                        >
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  );
              }}
            </Dropdown>
            <Button variant="secondary" icon={<Icon.Clipboard size={13} />} onClick={() => openAsCase(selected)}>Open as case</Button>
            <Button variant="ghost" icon={<Icon.Wrench size={13} />} onClick={() => requestMaintenance(selected)}>Request maintenance</Button>
          </>
        )}
      >
        {selected && (
          <div className="u-col" style={{ gap: 16 }}>
            <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Badge tone={KIND_TONE[selected.kind]}>{selected.kind}</Badge>
              <Badge tone={SEVERITY_TONE[selected.severity]}>{selected.severity}</Badge>
              <Badge tone="outline">{CAMPUS_LABEL[selected.campus]} campus</Badge>
              <Badge tone={isOpen(selected.status) ? 'warning' : 'success'} dot>{STATUS_LABEL[selected.status]}</Badge>
            </div>

            <div className="u-small u-muted">{selected.summary}</div>

            <div className="grid grid-2" style={{ gap: 12 }}>
              <div>
                <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Owner</div>
                <div className="u-small">{selected.owner}</div>
              </div>
              <div>
                <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Opened</div>
                <div className="u-small">{fmtDateTime(selected.openedOn)} · {fmtRelative(selected.openedOn)}</div>
              </div>
            </div>

            <div>
              <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>Linked records</div>
              <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                {linkedFor(selected).map(l => (
                  <button
                    key={l.label}
                    className="u-flex u-xs"
                    style={{ gap: 5, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 10px', background: 'var(--surface)', cursor: 'pointer' }}
                    onClick={() => navigate(l.ref)}
                  >
                    <Icon.ArrowUpRight size={11} />{l.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Timeline</div>
              <Timeline
                items={selected.timeline.map(t => ({
                  time: `${fmtDateTime(t.on)} · ${t.actor}`,
                  title: t.note,
                  dot: /schoolos|gps|auto|worker|engine/i.test(t.actor) ? 'ai' : 'accent',
                }))}
              />
            </div>

            <div className="u-xs u-faint">
              Detected {fmtDate(selected.openedOn)} — this incident and its full timeline are preserved in the audit trail; entries cannot be edited or deleted.
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
