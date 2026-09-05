/* ============================================================
   TechnicianWorkspace — mobile-first job sheet for the signed-in
   technician (demo identity: Arif Shaikh, /maintenance/technician).
   Voice-first completion: inspect per the category steps, hit the
   mic, confirm the parsed summary, complete — the job moves to
   verification and lands in "Done". Supervisors opening this
   route see the whole campus queue with a note.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { maintenanceService } from '../services';
import * as m from '../data/dataset';
import { PageHead, Badge, Button, Empty, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { PriorityBadge, WOStatusChip, SLAIndicator, AssetTag, AiUnderstanding } from '../components/Maint';
import { fmtDateTime, fmtDuration, fmtMoney, fmtRelative } from '../lib/format';
import type { CampusId, WOCategory, WorkOrderRecord } from '../types/domain';

type TabId = 'mine' | 'queue' | 'done';
const OPEN_STATES = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification'];

const STEPS: Partial<Record<WOCategory, string[]>> = {
  HVAC: ['Power down unit', 'Inspect filter', 'Check airflow', 'Compare temperature differential'],
  AV: ['Check power outlet & cable', 'Reseat lamp/board', 'Test on alternate input', 'Check lamp hours'],
  Plumbing: ['Isolate supply valve', 'Inspect joint/washer', 'Pressure check', 'Dry test'],
  Electrical: ['Isolate circuit', 'Inspect fitting', 'Replace consumables', 'Test load'],
};

const stepsFor = (c: WOCategory) => STEPS[c] ?? ['Inspect', 'Repair', 'Test'];

/* canned transcripts — the parsed voice-completion demo */
const TRANSCRIPTS: Partial<Record<WOCategory, string>> = {
  Plumbing: 'Replaced the coupling. Leak stopped. Part cost 610 rupees. Took 45 minutes.',
  AV: 'Checked power path, reseated the lamp board, tested on alternate input. Projector powers on. Took 40 minutes.',
  HVAC: 'Cleaned filter, topped up gas, leak-tested. Cooling restored. Took 90 minutes.',
};
const transcriptFor = (c: WOCategory) =>
  TRANSCRIPTS[c] ?? 'Inspected the unit, completed the repair on site, tested it. Job done. Took 50 minutes.';

/* duration parsed from the canned transcript so the confirmation card matches it */
const DURATIONS: Partial<Record<WOCategory, number>> = { Plumbing: 45, AV: 40, HVAC: 90 };
const durationFor = (c: WOCategory) => DURATIONS[c] ?? 50;

interface LocalPhoto { stage: 'before' | 'after'; on: Date }

function MicPulse({ listening }: { listening: boolean }) {
  return (
    <span
      className="u-inline"
      style={{
        gap: 3, alignItems: 'flex-end', height: 16,
      }}
      aria-hidden="true"
    >
      {[10, 16, 7, 13].map((h, i) => (
        <span
          key={i}
          style={{
            width: 3, height: listening ? h : 4, borderRadius: 3, background: 'currentColor',
            transition: 'height 180ms ease', opacity: listening ? 1 : 0.4,
            animation: listening ? `pulse ${700 + i * 130}ms ease-in-out infinite` : undefined,
          }}
        />
      ))}
    </span>
  );
}

export default function TechnicianWorkspace() {
  const { session, domain, dispatch, actorName } = useStore();
  const toast = useToast();
  const navigate = useNavigate();

  const isTech = session.roleId === 'technician';
  const scope = session.activeCampus;
  const techName = isTech ? actorName : 'Arif Shaikh';

  const [tab, setTab] = useState<TabId>('mine');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [listeningId, setListeningId] = useState<string | null>(null);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, LocalPhoto[]>>({});
  const timersRef = useRef<number[]>([]);
  useEffect(() => () => { timersRef.current.forEach(t => window.clearTimeout(t)); }, []);

  const campusWos = useMemo(
    () => domain.workOrders.filter(w => (scope as CampusId | 'all') === 'all' || w.campus === scope),
    [domain.workOrders, scope],
  );

  const mine = useMemo(() => campusWos.filter(w => w.assignedTo === techName && OPEN_STATES.includes(w.status)), [campusWos, techName]);
  const queue = useMemo(() => campusWos.filter(w => !w.assignedTo && OPEN_STATES.includes(w.status)), [campusWos]);
  const done = useMemo(() => campusWos.filter(w => w.assignedTo === techName && ['resolved', 'closed'].includes(w.status)), [campusWos, techName]);

  const tabList: { id: TabId; label: string; count?: number }[] = isTech
    ? [{ id: 'mine', label: 'My jobs', count: mine.length }, { id: 'queue', label: 'Queue', count: queue.length }, { id: 'done', label: 'Done', count: done.length }]
    : [{ id: 'mine', label: 'Campus jobs', count: mine.length }, { id: 'queue', label: 'Unassigned', count: queue.length }, { id: 'done', label: 'Done', count: done.length }];

  const shown = tab === 'mine' ? mine : tab === 'queue' ? queue : done;

  const startListening = (wo: WorkOrderRecord) => {
    setConfirmedId(prev => (prev === wo.id ? null : prev));
    setListeningId(wo.id);
    const t = window.setTimeout(() => {
      setListeningId(null);
      setConfirmedId(wo.id);
    }, 1400);
    timersRef.current.push(t);
  };

  const claim = async (wo: WorkOrderRecord) => {
    setBusy(`claim:${wo.id}`);
    try {
      await maintenanceService.assign(wo.id, techName, actorName);
      dispatch({
        type: 'wo/patch', id: wo.id,
        patch: { assignedTo: techName, assignedOn: new Date(), status: 'assigned' },
        actor: actorName, note: `Assigned to ${techName}`,
      });
      toast({ title: `${wo.id} added to your jobs`, sub: 'Response clock started — accept when you pick it up.', tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not claim job', sub: String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const completeJob = async (wo: WorkOrderRecord) => {
    setBusy(`done:${wo.id}`);
    try {
      const summary = transcriptFor(wo.category);
      const part = maintenancePart(wo.category);
      await maintenanceService.complete(wo.id, techName, {
        resolution: summary,
        rootCause: 'Per inspection steps',
        parts: part ? [{ inventoryId: part.id, name: part.name, qty: 1, cost: part.unitCost }] : [],
        labourMins: durationFor(wo.category),
      });
      dispatch({
        type: 'wo/advance', id: wo.id, to: 'verification',
        actor: techName, actorRole: session.roleId,
        note: 'Completed — sent for verification',
      });
      setConfirmedId(null);
      setOpenId(null);
      toast({ title: `${wo.id} completed`, sub: 'Sent for verification — it is in your Done tab now.', tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not complete job', sub: String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const addPhoto = (wo: WorkOrderRecord, stage: 'before' | 'after') => {
    setPhotos(p => ({ ...p, [wo.id]: [...(p[wo.id] ?? []), { stage, on: new Date() }] }));
    toast({ title: `Demo ${stage}-photo attached`, sub: 'Camera capture is a placeholder in this demo — the chip stays on this device only.', tone: 'info' });
  };

  return (
    <div>
      <PageHead
        title={isTech ? 'Your shift' : 'Technician workspace'}
        sub={isTech
          ? `${mine.length} active · ${queue.length} unassigned on campus · ${techName} — ${m.technicianByName(techName)?.shift ?? 'on shift'}`
          : `Supervisor view — showing all ${campusWos.filter(w => OPEN_STATES.includes(w.status)).length} open jobs on ${scope + ' campus'} · the signed-in technician (${techName}) would see only their own queue here`}
        actions={
          <Button variant="secondary" icon={<Icon.Grid size={14} />} onClick={() => navigate('/maintenance/work-orders')}>
            Work-order board
          </Button>
        }
      />

      <div className="tabs" style={{ marginBottom: 14 }}>
        {tabList.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count !== undefined && <span className="u-faint" style={{ marginLeft: 5 }}>{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="u-col" style={{ gap: 10 }}>
        {shown.length === 0 && (
          <Empty
            icon={<Icon.Check size={22} />}
            title={tab === 'mine' ? 'No active jobs on you' : tab === 'queue' ? 'Queue is clear' : 'Nothing completed yet'}
            sub={tab === 'mine'
              ? 'Claim a job from the Queue tab, or wait for the facilities desk to assign one.'
              : tab === 'queue'
                ? 'Every reported job has a technician. New reports land here.'
                : 'Completed jobs move here once they go through verification.'}
          />
        )}

        {shown.map(wo => {
          const isOpen = openId === wo.id;
          const sla = m.slaState(wo);
          const asset = wo.assetId ? m.assetById(wo.assetId) : undefined;
          const steps = stepsFor(wo.category);
          const localShots = photos[wo.id] ?? [];
          const part = maintenancePart(wo.category);
          const listening = listeningId === wo.id;
          const confirmed = confirmedId === wo.id;
          const doneState = ['resolved', 'closed'].includes(wo.status);

          return (
            <div key={wo.id} className={`wo-card prio-${wo.priority} u-col`} style={{ gap: 0, padding: 0 }}>
              {/* collapsed row — the tap target */}
              <button
                onClick={() => setOpenId(isOpen ? null : wo.id)}
                aria-expanded={isOpen}
                className="u-between"
                style={{ gap: 10, width: '100%', background: 'transparent', border: 'none', padding: '12px 14px', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
              >
                <span className="u-col" style={{ gap: 5, minWidth: 0, flex: 1 }}>
                  <span className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="u-mono u-small u-muted">{wo.id}</span>
                    <PriorityBadge p={wo.priority} size="sm" />
                    <WOStatusChip s={wo.status} />
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{wo.title}</span>
                  <span className="u-inline u-small u-muted" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {wo.assetId && <AssetTag id={wo.assetId} />}
                    <span>{wo.building}{wo.room ? ` · ${wo.room}` : ''}</span>
                    {!doneState && <SLAIndicator sla={sla} breach size="sm" />}
                  </span>
                </span>
                <span className="u-inline" style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  {!wo.assignedTo && <Badge tone="warning" dot>Unassigned</Badge>}
                  <Icon.ChevronDown size={15} style={{ color: 'var(--text-3)', transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform var(--t-fast) var(--ease)' }} />
                </span>
              </button>

              {/* expanded sheet */}
              {isOpen && (
                <div className="u-col" style={{ gap: 14, padding: '2px 14px 14px', borderTop: '1px solid var(--border-subtle)' }}>
                  <span className="u-small u-muted" style={{ marginTop: 10 }}>
                    Reported {fmtRelative(wo.reportedOn)} by {wo.reportedBy} · {wo.category}{wo.recurrenceOf ? ` · recurrence of ${wo.recurrenceOf}` : ''}
                  </span>
                  <p style={{ margin: 0, fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{wo.description}</p>

                  {wo.aiUnderstanding && <AiUnderstanding wo={wo} />}

                  {asset && (
                    <div className="u-col" style={{ gap: 6, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--surface-2)' }}>
                      <span className="u-upper" style={{ fontWeight: 620 }}>Asset history</span>
                      {asset.failures.length > 0 ? asset.failures.slice(-2).reverse().map((f, i) => (
                        <span key={i} className="u-small" style={{ color: 'var(--text-2)' }}>
                          <span className="u-mono u-small u-muted" style={{ marginRight: 7 }}>{fmtDateTime(f.on)}</span>{f.summary}
                        </span>
                      )) : <span className="u-small u-muted">No prior failures logged on this asset.</span>}
                      {asset.manualDoc && (
                        <span className="u-inline u-small" style={{ gap: 6 }}>
                          <Icon.Document size={12} style={{ color: 'var(--text-3)' }} /> Manual: {asset.manualDoc}
                        </span>
                      )}
                    </div>
                  )}

                  {/* inspection steps */}
                  <div className="u-col" style={{ gap: 6 }}>
                    <span className="u-upper" style={{ fontWeight: 620 }}>Inspection steps — {wo.category}</span>
                    <ol className="u-col" style={{ gap: 4, margin: 0, paddingLeft: 18 }}>
                      {steps.map((s, i) => <li key={i} className="u-small" style={{ color: 'var(--text-2)' }}>{s}</li>)}
                    </ol>
                    {wo.category === 'Safety' && (
                      <div className="u-inline" style={{ gap: 7, alignItems: 'flex-start', background: 'color-mix(in srgb, var(--danger) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 22%, transparent)', borderRadius: 'var(--r-md)', padding: '8px 10px' }}>
                        <Icon.Alert size={13} style={{ color: 'var(--danger-text)', flexShrink: 0, marginTop: 1 }} />
                        <span className="u-small" style={{ color: 'var(--danger-text)' }}>
                          Safety category — isolate the system before touching it, keep the barricade/signage in place, and never work the energised side alone.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* parts hint from the store */}
                  <div className="u-col" style={{ gap: 6 }}>
                    <span className="u-upper" style={{ fontWeight: 620 }}>Parts in store for {wo.category}</span>
                    {part
                      ? <span className="u-inline u-small" style={{ gap: 7, flexWrap: 'wrap' }}>
                          <Icon.Grid size={12} style={{ color: 'var(--text-3)' }} />
                          {part.name} · {part.stock} in stock at {part.store} · {fmtMoney(part.unitCost)}
                        </span>
                      : <span className="u-small u-muted">No linked stock item for {wo.category} — record costs in the voice note.</span>}
                  </div>

                  {/* local photo chips */}
                  {localShots.length > 0 && (
                    <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {localShots.map((p, i) => (
                        <span key={i} className="u-inline" style={{ gap: 6, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 9px', background: 'var(--surface-3)' }}>
                          <Badge tone={p.stage === 'before' ? 'neutral' : 'success'}>{p.stage.toUpperCase()}</Badge>
                          <span className="u-xs u-faint u-mono">{fmtDateTime(p.on)}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* actions / completion flow */}
                  {doneState ? (
                    <div className="u-col" style={{ gap: 6 }}>
                      {wo.resolution && <span className="u-small">Resolution: {wo.resolution.summary}</span>}
                      {wo.reporterRating != null && (
                        <span className="u-inline u-small" style={{ gap: 6 }}>
                          <Icon.Star size={12} style={{ color: '#DC6803' }} /> {wo.reporterRating}★ from the reporter
                        </span>
                      )}
                    </div>
                  ) : !wo.assignedTo ? (
                    <Button variant="primary" icon={<Icon.Plus size={14} />} loading={busy === `claim:${wo.id}`} disabled={!!busy} onClick={() => claim(wo)}>
                      Claim this job
                    </Button>
                  ) : confirmed ? (
                    /* confirmation card */
                    <div className="u-col" style={{ gap: 10, border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border))', background: 'var(--accent-weak)', borderRadius: 'var(--r-md)', padding: 12 }}>
                      <span className="u-inline" style={{ gap: 7 }}>
                        <Icon.Sparkle size={13} style={{ color: 'var(--accent-text)' }} />
                        <span style={{ fontWeight: 620, fontSize: 'var(--text-sm)' }}>Check this before you send it</span>
                      </span>
                      <span style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{transcriptFor(wo.category)}</span>
                      <div className="u-col" style={{ gap: 4 }}>
                        {part && (
                          <span className="u-inline u-small u-between">
                            <span className="u-muted">Part · {part.name}</span>
                            <span className="u-mono">{fmtMoney(part.unitCost)}</span>
                          </span>
                        )}
                        <span className="u-inline u-small u-between">
                          <span className="u-muted">Labour time</span>
                          <span className="u-mono">{fmtDuration(durationFor(wo.category))}</span>
                        </span>
                        <span className="u-inline u-small u-between">
                          <span className="u-muted">Total cost to the school</span>
                          <span className="u-mono" style={{ fontWeight: 640 }}>{fmtMoney((part?.unitCost ?? 0) + Math.round(durationFor(wo.category) * 2))}</span>
                        </span>
                      </div>
                      <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <Button variant="primary" icon={<Icon.Check size={14} />} loading={busy === `done:${wo.id}`} disabled={!!busy} onClick={() => completeJob(wo)}>
                          Complete job
                        </Button>
                        <Button variant="ghost" onClick={() => startListening(wo)} disabled={!!busy}>Re-record</Button>
                      </div>
                    </div>
                  ) : (
                    /* voice-first completion */
                    <div className="u-col" style={{ gap: 10 }}>
                      <span className="u-small u-muted">Fix it, then talk it in — SchoolOS turns the note into the completion record.</span>
                      <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <Button
                          variant={listening ? 'primary' : 'secondary'}
                          icon={<MicPulse listening={listening} />}
                          onClick={() => startListening(wo)}
                          disabled={!!busy}
                          aria-label="Record completion note"
                        >
                          {listening ? 'Listening…' : 'Voice completion'}
                        </Button>
                        <Button variant="secondary" size="sm" icon={<Icon.Grid size={13} />} onClick={() => addPhoto(wo, 'before')} disabled={!!busy}>Before photo</Button>
                        <Button variant="secondary" size="sm" icon={<Icon.Grid size={13} />} onClick={() => addPhoto(wo, 'after')} disabled={!!busy}>After photo</Button>
                      </div>
                      {listening && (
                        <span className="u-inline u-small" style={{ gap: 7, color: 'var(--accent-text)' }}>
                          <span className="spinner" style={{ width: 11, height: 11 }} /> Hearing you — describe the fix, part and time…
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* supervisor note when a non-technician opens the workspace */}
      {!isTech && mine.length === 0 && tab === 'mine' && shown.length === 0 && (
        <p className="u-small u-muted" style={{ marginTop: 10 }}>
          Technician identity in this demo is {techName} ({m.technicianByName(techName)?.skills.join(' · ') ?? 'AV & Electrical'}) — switch to the technician role from the avatar menu to see the mobile experience.
        </p>
      )}
    </div>
  );
}

/* one representative linked stock item for a category (from the live inventory).
   AssetCategory is a superset of WOCategory — every work-order category that has
   linked stock is a valid AssetCategory, so a runtime-guarded cast is honest here. */
const ASSET_CATS: readonly string[] = ['HVAC', 'AV', 'Electrical', 'Plumbing', 'Water', 'Power', 'Safety', 'Lab', 'Security', 'Furniture'];
function maintenancePart(category: WOCategory) {
  if (!ASSET_CATS.includes(category)) return undefined;
  const items = m.inventory.filter(i => i.linkedCategories.includes(category as (typeof ASSET_CATS)[number] as never));
  return items.sort((a, b) => a.unitCost - b.unitCost)[0];
}
