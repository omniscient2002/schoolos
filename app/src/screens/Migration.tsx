/* ============================================================
   Migration — the switch (Golden Loop 1).
   A guided journey: connect → analyze → map → health → shadow →
   trust receipt → cutover → FIRST DAY. One continuous story:
   "We didn't import data into another database. We moved the
   school into an operating system."
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../state/store';
import { PageHead, Card, Badge, Button, Progress, useToast, KeyValue } from '../components/ui';
import { EvidenceChain } from '../components/Ai';
import { Icon } from '../components/Icon';
import { EventTimeline, StepRail, VerifyRow, type RailStep, type TimelineEntry } from '../components/Flow';
import { firstDayScript } from '../demo/loops';

/* ---------- seeded corpus (same numbers everywhere) ---------- */
const MIG_SOURCES = [
  { id: 'students', name: 'Students & guardians', legacy: 'Excel — "Master 2026-27.xlsx"', rows: 1472, imported: 1441, flagged: 24, skipped: 7, confidence: 0.97, icon: 'Users' as const,
    issues: [
      { row: 'row 214', field: 'guardian_phone', problem: 'Two children share one number with different spellings of the parent name', fix: 'Merged as one household after name match' },
      { row: 'row 388', field: 'class', problem: '"8-C" does not exist in the sections table', fix: 'Queued for coordinator — provisionally mapped to 8-B' },
      { row: 'row 902', field: 'dob', problem: 'Age 3.4 years for Grade 5', fix: 'Flagged — likely typing error (2013 → 2023)' },
    ] },
  { id: 'fees', name: 'Fees records Term 1 + 2', legacy: 'Tally export + bank statement PDFs', rows: 2913, imported: 2870, flagged: 31, skipped: 12, confidence: 0.93, icon: 'Money' as const,
    issues: [
      { row: 'txn 1187', field: 'amount', problem: 'PDF ledger total ≠ bank credit (₹500 short)', fix: 'Held as partial — reconciliation case opened' },
      { row: 'txn 2044', field: 'receipt_no', problem: 'Duplicate receipt number across two students', fix: 'Both flagged; registrar to reissue one' },
      { row: 'txn 2201', field: 'date', problem: 'Payment dated inside the merger window', fix: 'Imported with dual-entry note for audit' },
    ] },
  { id: 'admissions', name: 'Admissions leads', legacy: 'Excel — enquiries tracker', rows: 68, imported: 68, flagged: 0, skipped: 0, confidence: 0.99, icon: 'Graduation' as const, issues: [] },
  { id: 'transport', name: 'Routes, buses & riders', legacy: 'Transport contractor WhatsApp logs (17 chats)', rows: 418, imported: 402, flagged: 16, skipped: 0, confidence: 0.88, icon: 'Bus' as const,
    issues: [
      { row: 'route_7', field: 'stop_list', problem: 'Stops unordered, two spellings of "Sector 12"', fix: 'Normalized and ordered by GPS history' },
      { row: 'bus_14', field: 'capacity', problem: 'Contractor sheet says 45, permit says 38', fix: 'Permit wins — lower capacity enforced for safety' },
    ] },
  { id: 'assets', name: 'Assets & maintenance history', legacy: 'AMC register + vendor invoices (PDFs)', rows: 214 + 14, imported: 198 + 11, flagged: 11 + 3, skipped: 5, confidence: 0.9, icon: 'Wrench' as const,
    issues: [{ row: 'NOR-AC-04', field: 'service_history', problem: '4 repair invoices with no asset code', fix: 'Matched by make + location + invoice text (97%, human-confirmed)' }] },
];

const MIG_TOTALS = (() => {
  const rows = MIG_SOURCES.reduce((a, s) => a + s.rows, 0);
  const imported = MIG_SOURCES.reduce((a, s) => a + s.imported, 0);
  const flagged = MIG_SOURCES.reduce((a, s) => a + s.flagged, 0);
  const skipped = MIG_SOURCES.reduce((a, s) => a + s.skipped, 0);
  return { rows, imported, flagged, skipped };
})();

const STEPS = [
  { id: 'connect', label: 'Connect' }, { id: 'analyze', label: 'Analyze' }, { id: 'map', label: 'Map' },
  { id: 'health', label: 'Data health' }, { id: 'shadow', label: 'Shadow school' }, { id: 'receipt', label: 'Trust receipt' },
  { id: 'cutover', label: 'Activate' }, { id: 'firstday', label: 'First day' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const MAPPINGS = [
  { legacy: 'Student Name', field: 'person.name', confidence: 0.99, source: 'header match', status: 'accepted' },
  { legacy: 'Class / Sec', field: 'enrollment.section', confidence: 0.97, source: 'value scan vs sections', status: 'accepted' },
  { legacy: 'Guardian Ph', field: 'guardian.contact.phone', confidence: 0.98, source: 'format + duplicates scan', status: 'accepted' },
  { legacy: 'Fee Bal', field: 'fee_obligation.balance', confidence: 0.94, source: 'Tally ledger cross-check', status: 'accepted' },
  { legacy: 'Route No', field: 'transport.rider.route', confidence: 0.88, source: 'WhatsApp logs — human confirm suggested', status: 'accepted' },
  { legacy: 'DOB2', field: '— none —', confidence: 0.31, source: 'ambiguous: duplicate column, low fill rate', status: 'rejected' },
];

const SHADOW_ROWS = [
  { metric: 'Students', theirs: '1,472', ours: '1,472', state: 'matched' },
  { metric: 'Guardians', theirs: '~700', ours: '682 linked · 17 merged duplicates', state: 'changed' },
  { metric: 'Fees records', theirs: '₹4.21 Cr / 2,913 txns', ours: '₹4.21 Cr · 3 held for payment matching', state: 'matched' },
  { metric: 'Attendance (30 days)', theirs: 'paper registers (photo archive)', ours: 'not yet imported — day-1 capture replaces it', state: 'review' },
  { metric: 'Routes & riders', theirs: '418 stop pairs, 2 spellings', ours: '402 clean · 16 flagged', state: 'changed' },
  { metric: 'Documents', theirs: '4 shelf-boxes + 2 drives', ours: '198 certificates indexed, 7 expired flagged', state: 'changed' },
] as const;

export default function Migration() {
  const toast = useToast();
  const [step, setStep] = useState<StepId>('connect');
  const [mapState, setMapState] = useState(MAPPINGS);
  const [health, setHealth] = useState<Record<string, 'review' | 'fix' | 'dismiss'>>({});
  const [activated, setActivated] = useState(false);
  const [firstDay, setFirstDay] = useState<TimelineEntry[] | null>(null);
  const [progress, setProgress] = useState(0);
  const { dispatch } = useStore();
  const timers = useRef<number[]>([]);
  const stepIdx = STEPS.findIndex(s => s.id === step);

  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);

  const runAnalyze = () => {
    setStep('analyze'); setProgress(0);
    [900, 1700, 2500, 3300, 4100, 4900].forEach((ms, i) =>
      timers.current.push(window.setTimeout(() => setProgress((i + 1) / 6), ms)));
    timers.current.push(window.setTimeout(() => setStep('map'), 5400));
  };

  const activate = () => {
    setActivated(true);
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'migration', label: 'Cutover complete — Meridian is live on SchoolOS. Parallel read-only period: 30 days.', severity: 'info' } });
    dispatch({ type: 'audit/add', entry: {
      actor: 'Principal + Owner', actorRole: 'owner', action: 'Activated SchoolOS (cutover)', recordType: 'Migration',
      recordRef: `${MIG_TOTALS.imported.toLocaleString('en-IN')} records · trust receipt TR-2026-041`,
      reason: 'Dry-run verified · fix queue cleared · reconciliation ₹0',
      policyRef: 'Migration §1.1 (never overwrite; human activates)', aiInvolved: true, risk: 'medium',
      outcome: 'School live · rollback available for 30 days',
    } });
    setStep('firstday');
  };

  const runFirstDay = () => {
    const tl = firstDayScript({ dispatch, say: () => {}, tick: () => {} });
    setFirstDay(tl);
    toast({ title: 'Your school is running', sub: 'First register marked · guardians notified · audit written', tone: 'success' });
  };

  const idxOf = (id: StepId) => STEPS.findIndex(s => s.id === id);
  const rail: RailStep[] = [
    { id: 'migrate', label: 'Migrate', state: stepIdx >= idxOf('receipt') ? 'done' : stepIdx >= idxOf('map') ? 'running' : 'pending' },
    { id: 'verify', label: 'Verify', state: stepIdx >= idxOf('receipt') ? 'done' : 'pending' },
    { id: 'activate', label: 'Activate', state: firstDay || activated ? 'done' : stepIdx >= idxOf('cutover') ? 'running' : 'pending' },
    { id: 'first_attendance', label: 'First attendance', state: firstDay ? 'done' : 'pending' },
    { id: 'first_message', label: 'First message', state: firstDay ? 'done' : 'pending' },
    { id: 'first_verified', label: 'First verified event', state: firstDay ? 'done' : 'pending' },
    { id: 'live', label: 'SchoolOS is live', state: firstDay ? 'done' : 'pending' },
  ];

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <PageHead
        title="Data import"
        sub="Meridian International Academy → SchoolOS · 5 sources · switched over in one evening"
        actions={<Link to="/demo" className="btn btn-ghost">Demo launcher</Link>}
      />

      <Card style={{ marginBottom: 'var(--s-4)' }}>
        <StepRail steps={rail} title="The journey" />
      </Card>

      {/* STEP 1 — CONNECT */}
      {step === 'connect' && (
        <div className="u-col" style={{ gap: 'var(--s-4)' }}>
          <Card headAs="h2" head="Connect your sources" sub="Everything the school runs on today — spreadsheets, Tally, PDFs, WhatsApp logs. Nothing gets re-keyed.">
            <div className="grid grid-2" style={{ gap: 10 }}>
              {[
                { icon: 'File', name: 'Excel — Master 2026-27.xlsx', meta: 'students · guardians linked · classes', n: '1,472 rows' },
                { icon: 'Money', name: 'Tally export — Term 1+2', meta: 'fees records · vouchers', n: '2,913 txns' },
                { icon: 'Document', name: 'Bank statement PDFs', meta: 'credits · settlement refs', n: '3 files' },
                { icon: 'Message', name: 'WhatsApp logs — transport', meta: '17 chats → routes & riders', n: '418 pairs' },
                { icon: 'Wrench', name: 'AMC register + invoices', meta: 'assets · service history · 14 service docs', n: '228 records' },
              ].map(f => {
                const I = Icon[f.icon as keyof typeof Icon];
                return (
                  <button key={f.name} className="u-inline" style={{ gap: 12, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', cursor: 'pointer', background: 'var(--surface-1)', textAlign: 'left' }}
                    onClick={() => toast({ title: `${f.name} attached`, sub: 'Parsed locally — nothing is sent anywhere until you review it.', tone: 'info' })}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-3)', display: 'grid', placeItems: 'center' }}><I size={16} /></span>
                    <div className="u-col" style={{ gap: 1, flex: 1 }}>
                      <span style={{ fontWeight: 570, fontSize: 'var(--text-sm)' }}>{f.name}</span>
                      <span className="u-small u-muted">{f.meta}</span>
                    </div>
                    <span className="u-mono u-small u-muted">{f.n}</span>
                  </button>
                );
              })}
              <button className="u-inline" style={{ gap: 12, padding: '12px 14px', borderRadius: 'var(--r-md)', border: '1px dashed var(--accent)', color: 'var(--accent-text)', cursor: 'pointer', background: 'transparent' }}
                onClick={() => toast({ title: 'Drop files here', sub: 'XLSX · CSV · Tally XML · PDF — the importer handles the mess', tone: 'info' })}>
                <Icon.Plus size={16} />
                <span className="u-small" style={{ fontWeight: 560 }}>Add another source…</span>
              </button>
            </div>
            <div className="u-inline" style={{ gap: 10, marginTop: 14, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <Badge tone="success" dot>5 sources detected · 5,099 records visible</Badge>
              <Button variant="primary" icon={<Icon.Play size={14} />} onClick={runAnalyze}>Analyze your school</Button>
            </div>
          </Card>
          <Card headAs="h2" head="What happens to your files" sub="Plain language, because trust starts here">
            <KeyValue items={[
              { k: 'Read', v: 'Every row is parsed and source-stamped — the origin of each record is permanent' },
              { k: 'Never', v: 'No original record is overwritten, renamed, or deleted — the old system stays readable for 30 days' },
              { k: 'Human gates', v: 'Field mappings, flagged rows, and go-live are all human-approved steps' },
            ]} cols={1} />
          </Card>
        </div>
      )}

      {/* STEP 2 — ANALYZE */}
      {step === 'analyze' && (
        <Card headAs="h2" head="Analyzing your school…" sub="Reading every row — this is a dry run, nothing is committed">
          <Progress value={progress * 100} />
          <div className="u-col" style={{ gap: 8, marginTop: 14 }}>
            {[
              '5,099 records found across 5 sources',
              '1,472 students · 682 guardian households linked (17 duplicates merged)',
              '68 admissions leads · 2,913 financial transactions · ₹4.21 Cr reconcilable',
              '10 transport routes · 418 rider-stop pairs · permit capacities found',
              '214 assets · 6 service histories matched from invoice text',
              'Flags queued for review — nothing dropped silently',
            ].map((l, i) => (
              <div key={l} className="u-inline" style={{ gap: 9, opacity: progress > i ? 1 : 0.35, transition: 'opacity .4s' }}>
                {progress > i ? <Icon.Check size={14} style={{ color: 'var(--success)' }} /> : <span style={{ width: 14 }} />}
                <span style={{ fontSize: 'var(--text-sm)' }}>{l}</span>
              </div>
            ))}
          </div>
          <div className="u-xs u-faint" style={{ marginTop: 12 }}>Mock analysis on seeded Meridian data — the production importer streams the same findings live.</div>
        </Card>
      )}

      {/* STEP 3 — MAPPING */}
      {step === 'map' && (
        <Card headAs="h2" head="Field mapping" sub="SchoolOS mapped 94.7% of columns automatically — confirm the rest">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--text-3)' }}>
                <th style={{ padding: '8px 10px 8px 0', fontWeight: 560 }}>Legacy column</th>
                <th style={{ padding: '8px 10px', fontWeight: 560 }}>→ SchoolOS field</th>
                <th style={{ padding: '8px 10px', fontWeight: 560 }}>Confidence</th>
                <th style={{ padding: '8px 10px', fontWeight: 560 }}>How</th>
                <th style={{ padding: '8px 10px', fontWeight: 560 }}>Decision</th>
              </tr></thead>
              <tbody>
                {mapState.map((m, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 10px 10px 0', fontWeight: 560 }}>{m.legacy}</td>
                    <td style={{ padding: '10px' }}><span className="u-mono u-small">{m.field}</span></td>
                    <td style={{ padding: '10px' }}><Badge tone={m.confidence >= 0.9 ? 'success' : m.confidence >= 0.6 ? 'warning' : 'danger'}>{Math.round(m.confidence * 100)}%</Badge></td>
                    <td style={{ padding: '10px' }} className="u-small u-muted">{m.source}</td>
                    <td style={{ padding: '10px' }}>
                      <div className="u-inline" style={{ gap: 6 }}>
                        {m.status === 'accepted' ? <Badge tone="success" dot>Accepted</Badge> : <Badge tone="neutral" dot>Rejected</Badge>}
                        <button className="btn btn-ghost btn-sm" onClick={() => setMapState(ms => ms.map((x, j) => j === i ? { ...x, status: x.status === 'accepted' ? 'rejected' : 'accepted' } : x))}>toggle</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="u-inline" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <span className="u-small u-muted">{mapState.filter(m => m.status === 'accepted').length} of {mapState.length} mappings accepted</span>
            <Button variant="primary" onClick={() => setStep('health')}>Continue — run data health</Button>
          </div>
        </Card>
      )}

      {/* STEP 4 — DATA HEALTH */}
      {step === 'health' && (
        <Card headAs="h2" head="Data quality — fixed before they became problems" sub="17 duplicate guardians · 4 missing emergency contacts · 3 fee mismatches · 7 expired documents">
          <div className="u-col" style={{ gap: 10 }}>
            {MIG_SOURCES.flatMap(s => s.issues.map((is, k) => {
              const key = `${s.id}-${k}`;
              const st = health[key] ?? 'review';
              return (
                <div key={key} className="u-col" style={{ gap: 5, padding: '11px 13px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', opacity: st === 'dismiss' ? 0.55 : 1 }}>
                  <div className="u-between" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <span className="u-inline" style={{ gap: 8 }}>
                      <span className="u-mono u-xs u-faint">{is.row}</span>
                      <Badge tone="outline">{is.field}</Badge>
                    </span>
                    <div className="u-inline" style={{ gap: 6 }}>
                      {st === 'review' ? (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setHealth(h => ({ ...h, [key]: 'fix' })); toast({ title: 'Fix applied', sub: is.fix, tone: 'success' }); }}>Fix</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setHealth(h => ({ ...h, [key]: 'dismiss' }))}>Dismiss</button>
                        </>
                      ) : st === 'fix' ? <Badge tone="success" dot>Fixed — audited</Badge> : <Badge tone="neutral">Dismissed</Badge>}
                    </div>
                  </div>
                  <span style={{ fontSize: 'var(--text-sm)' }}>{is.problem}</span>
                  <span className="u-small" style={{ color: 'var(--accent-text)' }}>Proposed fix: {is.fix}</span>
                </div>
              );
            }))}
          </div>
          <div className="u-inline" style={{ gap: 8, marginTop: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span className="u-small u-muted">Every fix is one click with undo. Dismissed items stay listed — nothing is hidden.</span>
            <Button variant="primary" onClick={() => setStep('shadow')}>Continue — preview the shadow school</Button>
          </div>
        </Card>
      )}

      {/* STEP 5 — SHADOW SCHOOL */}
      {step === 'shadow' && (
        <Card headAs="h2" head="Shadow school" sub="Preview your school before going live — source system vs SchoolOS, side by side">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--text-3)' }}>
                <th style={{ padding: '8px 10px 8px 0', fontWeight: 560 }}>Metric</th>
                <th style={{ padding: '8px 10px', fontWeight: 560 }}>Your current system</th>
                <th style={{ padding: '8px 10px', fontWeight: 560 }}>SchoolOS</th>
                <th style={{ padding: '8px 10px', fontWeight: 560 }}>State</th>
              </tr></thead>
              <tbody>
                {SHADOW_ROWS.map(r => (
                  <tr key={r.metric} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 10px 10px 0', fontWeight: 560 }}>{r.metric}</td>
                    <td style={{ padding: '10px' }} className="u-muted">{r.theirs}</td>
                    <td style={{ padding: '10px', fontWeight: 550 }}>{r.ours}</td>
                    <td style={{ padding: '10px' }}>
                      <Badge tone={r.state === 'matched' ? 'success' : r.state === 'changed' ? 'info' : 'warning'}>
                        {r.state === 'matched' ? 'Matched' : r.state === 'changed' ? 'Improved' : 'Needs review'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="u-xs u-faint" style={{ marginTop: 10 }}>Attendance shows "not yet imported" honestly: 30 days of paper registers stay in the archive; day-one capture replaces the clipboard going forward.</div>
          <div className="u-inline" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={() => setStep('receipt')}>Issue the trust receipt</Button>
          </div>
        </Card>
      )}

      {/* STEP 6 — TRUST RECEIPT */}
      {step === 'receipt' && (
        <Card>
          <div className="u-col" style={{ gap: 14, padding: '8px 4px' }}>
            <div className="u-between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="u-col" style={{ gap: 2 }}>
                <span className="u-upper u-small" style={{ fontWeight: 640, color: 'var(--text-3)', letterSpacing: '0.08em' }}>SchoolOS trust receipt</span>
                <span style={{ fontWeight: 680, fontSize: 'var(--text-lg)' }}>TR-2026-041 · Meridian International Academy</span>
              </div>
              <Badge tone="success" dot>Reconciled to the rupee</Badge>
            </div>
            <div className="divider" />
            <div className="grid grid-2" style={{ gap: 14 }}>
              <KeyValue items={[
                { k: 'Records imported', v: `${MIG_TOTALS.imported.toLocaleString('en-IN')} of ${MIG_TOTALS.rows.toLocaleString('en-IN')} — every one source-linked` },
                { k: 'Flagged for review', v: `${MIG_TOTALS.flagged} (all resolved or listed) · ${MIG_TOTALS.skipped} skipped with reasons` },
                { k: 'Financial transactions', v: '2,913 reconciled' },
              ]} cols={1} />
              <KeyValue items={[
                { k: 'Source total (Tally + bank)', v: '₹4,21,04,318' },
                { k: 'SchoolOS total', v: '₹4,21,04,318' },
                { k: 'Difference', v: <b style={{ color: 'var(--success-text, var(--accent-text))' }}>₹0</b> },
              ]} cols={1} />
            </div>
            <div className="divider" />
            <div className="u-col" style={{ gap: 8 }}>
              <VerifyRow ok label="No original records overwritten" detail="Legacy files remain untouched; every imported row carries its source stamp" />
              <VerifyRow ok label="Rollback available for 30 days" detail="One click restores the pre-cutover state — it was never needed, but it is always there" />
              <VerifyRow ok label="Human gates honoured" detail="Mappings accepted by coordinator · fixes audited · cutover approved by principal + owner" />
            </div>
            <div className="u-inline" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="primary" onClick={() => setStep('cutover')}>Proceed to activation</Button>
            </div>
          </div>
        </Card>
      )}

      {/* STEP 7 — CUTOVER */}
      {step === 'cutover' && (
        <Card headAs="h2" head="Activate SchoolOS" sub="One decision, made with full information">
          <EvidenceChain
            title="What activation changes — in plain language"
            steps={[
              { label: 'Attendance becomes writable in SchoolOS', detail: 'Teachers mark registers here from tomorrow morning', source: 'Attendance §1.1', refType: 'migration' },
              { label: 'Your previous system becomes read-only', detail: 'Kept alongside for 30 days — lookup, not entry', source: 'Migration §1.1 (parallel period)', refType: 'migration' },
              { label: 'Notifications switch to the orchestrator', detail: 'Fee, absence and transport messages go out via WhatsApp with receipts', source: 'Communication §1.2', refType: 'migration' },
              { label: 'Rollback stays available', detail: 'One click, 30 days, no questions', source: 'Trust receipt TR-2026-041', refType: 'migration' },
            ]}
          />
          <div className="u-inline" style={{ gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <Button variant="primary" size="lg" icon={<Icon.Zap size={15} />} onClick={activate}>Activate SchoolOS — Meridian goes live</Button>
          </div>
        </Card>
      )}

      {/* STEP 8 — FIRST DAY */}
      {step === 'firstday' && (
        <div className="u-col" style={{ gap: 'var(--s-4)' }}>
          <Card>
            <div className="u-col" style={{ gap: 10, alignItems: 'center', textAlign: 'center', padding: '10px 0 4px' }}>
              <span style={{ width: 46, height: 46, borderRadius: 14, background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success-text, var(--accent-text))', display: 'grid', placeItems: 'center' }}><Icon.Check size={24} /></span>
              <div className="u-col" style={{ gap: 3 }}>
                <span style={{ fontWeight: 700, fontSize: 'var(--text-xl)' }}>Your school is ready.</span>
                <span className="u-small u-muted">Meridian moved in — history intact, receipts issued, rollback armed. Now watch the first morning.</span>
              </div>
              {!firstDay && <Button variant="primary" icon={<Icon.Play size={14} />} onClick={runFirstDay}>Run the first morning</Button>}
            </div>
          </Card>
          {firstDay && (
            <Card headAs="h2" head="First day — live" sub="Migration didn't end at data import. It became a school.">
              <EventTimeline items={firstDay} />
              <div className="divider" />
              <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Badge tone="success" dot>SchoolOS is live</Badge>
                <Badge tone="outline">2,913 txns reconciled · ₹0 difference</Badge>
                <Link to="/demo/day" className="btn btn-secondary btn-sm">Continue — run a school day</Link>
                <Link to="/demo" className="btn btn-ghost btn-sm">Demo launcher</Link>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* skip rail */}
      {stepIdx < STEPS.length - 2 && (
        <div className="u-inline" style={{ gap: 6, marginTop: 'var(--s-4)', flexWrap: 'wrap' }}>
          <span className="u-xs u-faint">Jump to:</span>
          {STEPS.slice(2).map(s => (
            <button key={s.id} className="btn btn-ghost btn-sm" onClick={() => setStep(s.id)}>{s.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
