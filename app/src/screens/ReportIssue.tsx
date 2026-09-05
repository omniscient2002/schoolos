/* ============================================================
   ReportIssue — "Tell us what happened."
   One box. AI extracts category, asset, location, priority and
   skill; the reporter confirms with one tap. No ten-field form.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../state/store';
import { maintenanceService } from '../services';
import * as m from '../data/dataset';
import { PageHead, Card, Badge, Button, Modal, useToast, KeyValue, Empty, Avatar } from '../components/ui';
import { Icon } from '../components/Icon';
import { AssetTag, HealthRing, PriorityBadge, SLAIndicator, TechnicianWhy, StatusDot } from '../components/Maint';
import type { WorkOrderRecord, MaintPriority } from '../types/domain';

const EXAMPLES = [
  { text: 'The projector in Science Lab 204 isn\u2019t turning on.', hint: 'AV · matches NOR-PRJ-204' },
  { text: 'Water cooler in Block B corridor is leaking', hint: 'Plumbing · drinking-water asset' },
  { text: 'AC in room 204 trips the breaker after a few minutes', hint: 'HVAC · repeat failure' },
  { text: 'Sparks from the socket near the chemistry lab sink', hint: 'Electrical · safety-relevant' },
  { text: '2nd floor boys washroom door hinge broken', hint: 'Civil · low urgency' },
];

type Phase = 'input' | 'thinking' | 'classified' | 'assigned' | 'done';

export default function ReportIssue() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { session, actorName, dispatch } = useStore();
  const toast = useToast();
  const presetAsset = params.get('asset') ?? undefined;

  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [photo, setPhoto] = useState(false);
  const [voiceUsed, setVoiceUsed] = useState(false);
  const [listening, setListening] = useState(false);
  const [created, setCreated] = useState<WorkOrderRecord | null>(null);
  const [recs, setRecs] = useState<{ tech: { id: string; name: string; currentJobs: number; firstTimeFixRate: number; lastSeen: string }; score: number; skillMatch: boolean; why: string[] }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTo, setOverrideTo] = useState<MaintPriority | null>(null);

  const preset = presetAsset ? m.assetById(presetAsset) : undefined;

  /* pre-fill from QR / asset flow */
  useEffect(() => {
    if (preset && phase === 'input' && !text) {
      setText(`${preset.name} — `);
      setPhase('thinking'); // synthetic: asset scan already "understands" the asset
      setTimeout(() => setPhase('input'), 600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetAsset]);

  const canSubmit = text.trim().length >= 8 && phase === 'input';

  const submit = async () => {
    setError(null);
    setPhase('thinking');
    const res = await maintenanceService.createFromReport({
      text, source: voiceUsed ? 'voice' : photo ? 'app' : 'app',
      reporter: actorName, reporterRole: session.roleId as WorkOrderRecord['reportedRole'],
      campus: session.activeCampus,
      assetId: presetAsset,
    });
    if (res.error || !res.data) {
      setError(res.error ?? 'Could not file the report');
      setPhase('input');
      return;
    }
    const wo = res.data;
    /* keep the store authoritative so other screens update live */
    dispatch({ type: 'wo/create', wo });
    const rec = await maintenanceService.recommend(wo.category, wo.campus);
    setRecs(Array.isArray(rec) ? rec : (rec as { data?: typeof rec }).data ?? []);
    setCreated(wo);
    setPhase('classified');
  };

  const assign = async (techName: string) => {
    if (!created) return;
    setPhase('assigned');
    dispatch({ type: 'wo/patch', id: created.id, patch: { assignedTo: techName, assignedOn: new Date(), status: 'assigned' }, actor: actorName, note: `Assigned to ${techName}` });
    await maintenanceService.assign(created.id, techName, actorName);
    toast({ title: `Assigned to ${techName.split(' ')[0]}`, sub: `${created.id} · notification sent · SLA clock adjusted`, tone: 'success' });
    setTimeout(() => setPhase('done'), 900);
  };

  const doOverride = () => {
    if (!created || !overrideTo) return;
    dispatch({ type: 'wo/patch', id: created.id, patch: { priority: overrideTo, timeline: [...created.timeline, { on: new Date(), actor: actorName, note: `Priority overridden ${created.priority} → ${overrideTo} by ${actorName} · reason recorded`, kind: 'status' as const }] }, actor: actorName, note: `Priority override → ${overrideTo}` });
    setCreated({ ...created, priority: overrideTo });
    setOverrideOpen(false);
    toast({ title: `Priority set to ${overrideTo}`, sub: 'Override recorded in the audit ledger', tone: 'success' });
  };

  const voiceFill = () => {
    setListening(true);
    setTimeout(() => {
      setListening(false);
      setVoiceUsed(true);
      if (!text.trim()) setText('The projector in Science Lab 204 isn\u2019t turning on.');
      toast({ title: 'Voice captured', sub: 'Transcribed on device — edit anything before sending', tone: 'info' });
    }, 1400);
  };

  const reading = useMemo(() => created?.aiUnderstanding, [created]);

  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      <PageHead
        title="Report an issue"
        sub="Describe it in one line. SchoolOS finds the asset, sets priority, and routes it."
        back={session.roleId === 'technician' ? { to: '/maintenance/technician', label: 'My jobs' } : { to: '/maintenance', label: 'Maintenance' }}
      />

      {phase === 'input' && (
        <div className="u-col" style={{ gap: 'var(--s-4)' }}>
          {preset && (
            <Card>
              <div className="u-inline" style={{ gap: 12, alignItems: 'center' }}>
                <HealthRing score={preset.health} />
                <div className="u-col" style={{ gap: 2, flex: 1 }}>
                  <span className="u-inline" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{preset.name}</span>
                    <AssetTag id={preset.id} />
                  </span>
                  <span className="u-small u-muted">Scanned from the asset QR tag · {preset.building} · {preset.room}</span>
                </div>
                <StatusDot status={preset.status} />
              </div>
            </Card>
          )}

          <Card>
            <div className="report-bubble u-col" style={{ gap: 10 }}>
              <textarea
                autoFocus
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Tell us what happened — e.g. “The projector in room 204 isn\u2019t turning on.”"
                rows={3}
                style={{ border: 'none', outline: 'none', background: 'transparent', resize: 'none', font: 'inherit', fontSize: 'var(--text-lg)', color: 'var(--text-1)' }}
                aria-label="Describe the issue"
              />
              <div className="u-inline" style={{ gap: 6, justifyContent: 'space-between' }}>
                <div className="u-inline" style={{ gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setPhoto(true); toast({ title: 'Photo attached (demo)', sub: 'Camera capture is simulated in this prototype', tone: 'info' }); }} aria-label="Attach photo"><Icon.Plus size={13} /> Photo</button>
                  <button className="btn btn-ghost btn-sm" onClick={voiceFill} aria-label="Record voice note">
                    {listening ? <span className="u-inline" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 8, background: 'var(--danger)', animation: 'pulse 1s infinite' }} /> Listening…</span> : <><Icon.Mic size={13} /> Voice</>}
                  </button>
                  {preset && <Badge tone="outline"><Icon.Grid size={11} /> {preset.id}</Badge>}
                </div>
                <Button variant="primary" disabled={!canSubmit} onClick={submit} icon={<Icon.Send size={14} />}>Send report</Button>
              </div>
            </div>
            {photo && <div className="u-small u-muted" style={{ marginTop: 8 }}>📷 photo-204-powerlight.jpg attached — helps the technician arrive prepared. (Demo placeholder.)</div>}
            {error && <div className="u-small" style={{ color: 'var(--danger-text)', marginTop: 8 }}>{error}</div>}
          </Card>

          <div className="u-col" style={{ gap: 8 }}>
            <span className="u-small" style={{ fontWeight: 620, color: 'var(--text-3)', letterSpacing: '0.04em' }}>TRY ONE — SEE HOW MUCH IS UNDERSTOOD</span>
            <div className="u-col" style={{ gap: 7 }}>
              {EXAMPLES.map(ex => (
                <button key={ex.text} className="report-example u-inline" style={{ gap: 10, justifyContent: 'space-between' }} onClick={() => setText(ex.text)}>
                  <span>“{ex.text}”</span>
                  <span className="u-small u-muted" style={{ whiteSpace: 'nowrap' }}>{ex.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <Card>
            <div className="u-inline" style={{ gap: 12, alignItems: 'flex-start' }}>
              <Icon.Compass size={18} style={{ color: 'var(--text-3)', marginTop: 2 }} />
              <div className="u-col" style={{ gap: 4 }}>
                <span style={{ fontWeight: 560, fontSize: 'var(--text-sm)' }}>Other ways in</span>
                <span className="u-small u-muted">WhatsApp to the school facilities number · email to facilities@meridian.edu · QR tag on the asset · staff app (this page). Everything lands in the same queue, understood the same way.</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {phase === 'thinking' && (
        <Card>
          <div className="u-col" style={{ gap: 12, padding: '24px 8px', alignItems: 'center' }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in srgb, var(--ai) 10%, transparent)', color: 'var(--ai-text, var(--ai))', display: 'grid', placeItems: 'center' }}><Icon.Sparkle size={20} /></span>
            <span style={{ fontWeight: 600 }}>Reading the report…</span>
            <span className="u-small u-muted">Matching against the asset register · classifying category · checking safety signals · applying the priority policy</span>
          </div>
        </Card>
      )}

      {(phase === 'classified' || phase === 'assigned') && created && reading && (
        <div className="u-col" style={{ gap: 'var(--s-4)' }}>
          <Card>
            <div className="u-col" style={{ gap: 10 }}>
              <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Badge tone="ai"><Icon.Sparkle size={11} /> Understood as</Badge>
                <Badge tone="outline">{reading.category}</Badge>
                {created.assetId && <AssetTag id={created.assetId} />}
                <PriorityBadge p={created.priority} />
                {reading.safetyRelevant && <Badge tone="danger"><Icon.Alert size={11} /> Safety-relevant</Badge>}
                <Badge tone="outline">{Math.round((reading.confidence ?? 0.9) * 100)}% confidence</Badge>
              </div>
              <div style={{ fontWeight: 620, fontSize: 'var(--text-lg)' }}>{created.title}</div>
              <ul className="u-col" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
                {reading.reasoning.map((r, i) => (
                  <li key={i} className="u-inline" style={{ gap: 8, alignItems: 'flex-start', fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}>
                    <span className="u-mono" style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 1 }}>{String(i + 1).padStart(2, '0')}</span>{r}
                  </li>
                ))}
              </ul>
              <div className="divider" />
              <KeyValue items={[
                { k: 'SLA', v: <SLAIndicator sla={{ label: `resolve in ${Math.round(created.sla.resolveMins / 60)}h · respond in ${created.sla.responseMins}m`, tone: 'neutral' }} /> },
                { k: 'Affected', v: `${reading.affectedPeople ?? 5} people (estimated)` },
                { k: 'Skill needed', v: reading.suggestedSkill },
              ]} cols={3} />
              <div className="u-inline" style={{ gap: 8 }}>
                <Button variant="ghost" size="sm" onClick={() => setOverrideOpen(true)}>Override priority</Button>
                <Button variant="ghost" size="sm" onClick={() => { setCreated(null); setText(''); setPhoto(false); setVoiceUsed(false); setPhase('input'); }}>Edit report</Button>
              </div>
            </div>
          </Card>

          <Card head="Recommended technician" sub="Skill match · availability · first-time fix rate on this asset type">
            <div className="u-col" style={{ gap: 10 }}>
              {recs.map(({ tech, why, score }) => (
                <div key={tech.id} className="u-inline" style={{ gap: 12, alignItems: 'center' }}>
                  <Avatar name={tech.name} />
                  <div className="u-col" style={{ gap: 3, flex: 1 }}>
                    <span className="u-inline" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{tech.name}</span>
                      <Badge tone={tech.currentJobs === 0 ? 'success' : 'neutral'}>{tech.currentJobs === 0 ? 'Free now' : `${tech.currentJobs} active`}</Badge>
                    </span>
                    <TechnicianWhy why={why} score={score} />
                  </div>
                  <Button variant={tech === recs[0]?.tech ? 'primary' : 'secondary'} size="sm" disabled={phase !== 'classified'} onClick={() => assign(tech.name)}>
                    {tech === recs[0]?.tech ? 'Assign' : 'Assign anyway'}
                  </Button>
                </div>
              ))}
              {!recs.length && <Empty icon={<Icon.User size={18} />} title="No in-campus technician" sub="The facilities desk will route this to a contracted vendor." />}
            </div>
          </Card>

          <div className="u-small u-muted" style={{ textAlign: 'center' }}>
            Reported just now · a copy lands in {created.reportedBy}’s notifications and the reporter can follow progress without any follow-up calls.
          </div>
        </div>
      )}

      {phase === 'done' && created && (
        <Card>
          <div className="u-col" style={{ gap: 14, padding: '18px 6px', alignItems: 'center', textAlign: 'center' }}>
            <span style={{ width: 46, height: 46, borderRadius: 14, background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success-text, var(--accent-text))', display: 'grid', placeItems: 'center' }}><Icon.Check size={24} /></span>
            <div className="u-col" style={{ gap: 5 }}>
              <span style={{ fontWeight: 650, fontSize: 'var(--text-lg)' }}>{created.id} is on the board</span>
              <span className="u-small u-muted" style={{ maxWidth: 420 }}>
                Assigned and acknowledged. {created.reportedBy.split(' ')[0]} gets status updates automatically — no chase calls, no spreadsheet.
              </span>
            </div>
            <div className="u-inline" style={{ gap: 8 }}>
              <Button variant="secondary" onClick={() => navigate(`/maintenance/work-orders/${created.id}`)}>Open work order</Button>
              <Button variant="ghost" onClick={() => { setCreated(null); setText(''); setPhase('input'); }}>Report another</Button>
            </div>
          </div>
        </Card>
      )}

      {/* Priority override */}
      <Modal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Override priority"
        sub="Overrides are honoured immediately and recorded in the audit ledger with your name."
        footer={
          <div className="u-inline" style={{ gap: 8, justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!overrideTo} onClick={doOverride}>Apply override</Button>
          </div>
        }
      >
        <div className="u-col" style={{ gap: 8 }}>
          {(['emergency', 'critical', 'high', 'medium', 'low'] as MaintPriority[]).map(p => (
            <button
              key={p}
              onClick={() => setOverrideTo(p)}
              className="u-inline"
              style={{
                gap: 10, padding: '10px 12px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                border: overrideTo === p ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: overrideTo === p ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
                textAlign: 'left',
              }}
            >
              <PriorityBadge p={p} />
              <span className="u-small u-muted">
                {p === 'emergency' ? 'Safety risk · respond 10m · resolve 4h' :
                 p === 'critical' ? 'Core function down · respond 30m · resolve 8h' :
                 p === 'high' ? 'Learning impact today · respond 1h · resolve 24h' :
                 p === 'medium' ? 'Inconvenience, contained · respond 4h · resolve 3d' :
                 'Cosmetic or deferred · respond 8h · resolve 7d'}
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
