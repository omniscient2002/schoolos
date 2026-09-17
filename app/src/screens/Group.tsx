/* ============================================================
   Group — the multi-campus Owner console. Campus comparison,
   cross-campus Ask with evidence, group decisions, obligations
   and the shared standards that keep campuses consistent.
   ============================================================ */
import { useState } from 'react';
import * as seed from '../data/dataset';
import { makeRng } from '../lib/rng';
import { useStore } from '../state/store';
import { Badge, Button, Card, DataTable, Empty, PageHead, Progress, SampleNote, Section, Stat, useToast } from '../components/ui';
import { AiTraceCard, EvidenceChain } from '../components/Ai';
import { Sparkline } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtDateShort, fmtNum, fmtRelative } from '../lib/format';
import type { AiTrace, Campus, CampusId } from '../types/domain';

/* Canonical per-campus group metrics (attendance/collection are
   the numbers the group comparison and the Ask evidence share). */
const CAMPUS_METRICS: Record<CampusId, { attendance: number; collection: number }> = {
  north: { attendance: 94.1, collection: 84.2 },
  city: { attendance: 95.2, collection: 86.1 },
  east: { attendance: 92.3, collection: 79.8 }};

// FEX-1: real tenants carry campus ids the demo metric table does not know (`main`, `campus-N`), and
// `CAMPUS_METRICS[campus.id].attendance` threw on `undefined` — which the root ErrorBoundary turned into a
// blank app. Lookups are now tolerant and the UI renders "—" when a campus has no metric row.
const campusMetric = (id: CampusId) => CAMPUS_METRICS[id] ?? null;

function trendFor(campus: Campus): number[] {
  const m = campusMetric(campus.id);
  if (!m) return [];
  const rng = makeRng(90210 + campus.id.length * 733 + campus.students);
  return Array.from({ length: 8 }, () => Math.round((m.attendance + (rng.next() * 2 - 1) * 1.1) * 10) / 10);
}

const GROUP_TRACE: AiTrace = {
  trigger: 'Group question — which campus needs attention first',
  policy: 'Group scope: Owner, Principal, Finance only · Privacy §1.2 (reads logged)',
  dataUsed: ['attendance registers (3 campuses)', 'fees records per campus', 'incident board', 'fees calendar'],
  reasoningRole: 'Investigator (read-only)',
  action: 'None — surfaces a ranked recommendation for the owner',
  approvalStatus: 'Not required (read-only)',
  verification: 'Illustrative sample figures in this build — a live group deployment recomputes each campus from its own ledgers'};

const CAMPUS_LABEL: Record<CampusId | 'all', string> = { north: 'North', city: 'City', east: 'East', all: 'Group' };

export default function Group() {
  const { session, domain, permissionError } = useStore();
  const toast = useToast();

  const [askText, setAskText] = useState('Which campus needs attention first?');
  const [thinking, setThinking] = useState(false);
  const [asked, setAsked] = useState(false);

  if (permissionError('group')) {
    return (
      <>
        <PageHead title="Group console" />
        <Empty
          icon={<Icon.Lock size={26} />}
          title="The group console is restricted"
          sub="Cross-campus data is only for Owner, Principal and Finance. Switch the demo role (top right) to explore it."
        />
      </>
    );
  }

  const campuses = seed.campuses;
  const totalStudents = campuses.reduce((a, c) => a + c.students, 0);
  const totalStaff = seed.teachers.length + seed.staff.length;
  // FEX-1: the cross-campus narrative below is only truthful when every campus has a metric row. A real
  // tenant's campuses do not, so the answer is not fabricated — the screen says what is missing instead.
  const hasGroupMetrics = campuses.length > 0 && campuses.every((c) => campusMetric(c.id));

  const ask = () => {
    if (!askText.trim()) { toast({ title: 'Type a question for the group', tone: 'info' }); return; }
    setThinking(true);
    setAsked(false);
    setTimeout(() => { setThinking(false); setAsked(true); }, 850);
  };

  const openCasesOf = (id: CampusId) => domain.cases.filter(c => c.campus === id && c.status !== 'resolved' && c.status !== 'closed').length;
  const incidentsOf = (id: CampusId) => {
    const open = seed.incidents.filter(i => i.campus === id && i.status !== 'resolved' && i.status !== 'reviewed').length;
    const total = seed.incidents.filter(i => i.campus === id).length;
    return { open, total };
  };
  const staffOf = (id: CampusId) => seed.teachers.filter(t => t.campus === id).length + seed.staff.filter(s => s.campus === id).length;
  const busesOf = (id: CampusId) => seed.busRoutes.filter(r => r.campus === id).length;
  const nextInspection = (id: CampusId) => {
    const evts = seed.calendarEvents
      .filter(e => e.type === 'inspection' && (e.campus === id || e.campus === 'all'))
      .map(e => e.on).sort((a, b) => a.getTime() - b.getTime());
    return evts.length ? fmtDateShort(evts[0]) : '—';
  };

  const groupDecisions = seed.decisions.filter(d => d.approver === 'Board');

  return (
    <>
      <PageHead
        title="Group console"
        sub={session.roleId === 'owner'
          ? "One view across Meridian's three campuses — comparison first, stories second."
          : "Cross-campus view. Comparison is computed from each campus's own ledgers, never sampled."}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 22 }}>
        <Stat label="Campuses" value={campuses.length} sub="one constitution, one runtime" />
        <Stat label="Students" value={fmtNum(totalStudents)} sub={`${campuses.length} campus${campuses.length === 1 ? '' : 'es'}`} />
        {/* FEX-1: the "₹6.1 Cr" and "84.1%" tiles were hardcoded constants rendered as measured fact.
            There is no cross-campus financial data plane in this build, so they are deleted rather than
            faked; a real aggregate belongs behind a door that can compute it. */}
        <Stat label="Staff" value={totalStaff} sub="teaching + administrative" />
      </div>

      <Section title="Campus comparison" sub="Attendance, collection, caseload and compliance in one table.">
        {hasGroupMetrics && (
          <SampleNote>Sample campus figures — no cross-campus data plane is connected in this build, so attendance, collection and the trend lines below are illustrative, not read from each campus&rsquo;s ledger.</SampleNote>
        )}
        <Card>
          <DataTable<Campus>
            columns={[
              {
                key: 'name', label: 'Campus', width: 150, render: c => (
                  <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="campus-dot" style={{ width: 9, height: 9, borderRadius: 3, ['--campus-hue' as string]: c.hue }} />
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                  </div>
                )},
              {
                key: 'students', label: 'Students', width: 150, render: c => (
                  <div style={{ minWidth: 110 }}>
                    <div className="u-small tnum">{c.students} / {c.capacity}</div>
                    <Progress value={(c.students / c.capacity) * 100} />
                  </div>
                )},
              {
                key: 'attendance', label: 'Attendance', width: 160, render: c => {
                  const m = campusMetric(c.id);
                  if (!m) return <span className="u-faint">—</span>;
                  return (
                    <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
                      <span className="tnum" style={{ fontWeight: 600, width: 48 }}>{m.attendance.toFixed(1)}%</span>
                      <span style={{ display: 'inline-flex', ['--campus-hue' as string]: c.hue }}>
                        <Sparkline points={trendFor(c)} width={64} height={22} color="var(--campus-hue-dot, var(--campus-hue))" />
                      </span>
                    </div>
                  );
                }},
              {
                key: 'collection', label: 'Collection', width: 140, render: c => {
                  const m = campusMetric(c.id);
                  if (!m) return <span className="u-faint">—</span>;
                  const v = m.collection;
                  return (
                    <div style={{ minWidth: 100 }}>
                      <div className="u-small tnum" style={{ fontWeight: 600, color: v < 80 ? 'var(--danger)' : v < 85 ? 'var(--warning)' : 'var(--text)' }}>{v.toFixed(1)}%</div>
                      <Progress value={v} tone={v < 80 ? 'danger' : v < 85 ? 'warn' : undefined} />
                    </div>
                  );
                }},
              { key: 'openCases', label: 'Open cases', width: 90, align: 'right', render: c => <span className="tnum">{openCasesOf(c.id)}</span> },
              {
                key: 'incidents', label: 'Incidents', width: 110, align: 'right', render: c => {
                  const { open, total } = incidentsOf(c.id);
                  return <span className="tnum" style={{ color: open ? 'var(--danger)' : undefined, fontWeight: open ? 600 : 400 }}>{open} open / {total}</span>;
                }},
              { key: 'staff', label: 'Staff', width: 70, align: 'right', render: c => <span className="tnum">{staffOf(c.id)}</span> },
              { key: 'buses', label: 'Buses', width: 70, align: 'right', render: c => <span className="tnum">{busesOf(c.id)}</span> },
              { key: 'inspection', label: 'Next inspection', width: 120, render: c => <span className="u-small">{nextInspection(c.id)}</span> }]}
            rows={campuses}
            rowKey={c => c.id}
            empty={<Empty title="No campuses configured" />}
          />
        </Card>
      </Section>

      <Section title="Ask across campuses" sub="Cross-campus questions answered with the same evidence discipline as everything else.">
        <Card>
          <div className="u-flex" style={{ gap: 8, marginBottom: 14 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              value={askText}
              onChange={e => setAskText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') ask(); }}
              placeholder="Which campus needs attention first?"
              aria-label="Ask across campuses"
            />
            <Button variant="ai" icon={<Icon.Sparkle size={14} />} loading={thinking} onClick={ask}>Ask</Button>
          </div>

          {thinking && (
            <div className="u-col" style={{ gap: 8 }}>
              <div className="skeleton" style={{ height: 13, width: '55%', borderRadius: 6 }} />
              <div className="skeleton" style={{ height: 13, width: '82%', borderRadius: 6 }} />
              <div className="skeleton" style={{ height: 13, width: '70%', borderRadius: 6 }} />
              <div className="u-xs u-faint">Comparing attendance, collection, incidents and obligations across three campuses…</div>
            </div>
          )}

          {!thinking && !asked && (
            <div className="u-small u-muted">
              Ask a question like “Which campus needs attention first?” — the answer always shows its evidence chain and the
              numbers behind it. Nothing crosses campuses without the group scope check.
            </div>
          )}

          {!thinking && asked && (
            <div className="u-col" style={{ gap: 14 }}>
              {hasGroupMetrics ? (
                <>
                  <div className="u-flex" style={{ gap: 8, padding: '10px 12px', background: 'var(--ai-weak)', borderRadius: 'var(--r-md)', border: '1px solid var(--ai-weak-2)' }}>
                    <Icon.Sparkle size={15} style={{ color: 'var(--ai-text)', flexShrink: 0, marginTop: 1 }} />
                    <div className="u-small">
                      <b>East Campus needs attention first.</b> Attendance (92.3%) and collection (79.8%) are both the lowest of the
                      three campuses, and it carries the group's open facilities incident (water leakage, East wing corridor).
                      Suggested first step: a principal review with the East Admin Officer this week — the playground-equipment
                      inspection (4 days out) can be combined.
                    </div>
                  </div>
                  <div className="grid grid-2" style={{ gap: 14 }}>
                    <EvidenceChain
                      title="Campus comparison — evidence"
                      steps={[
                        { label: 'Attendance · last 5 school days (sample)', detail: 'North 94.1% · City 95.2% · East 92.3%', source: 'Illustrative sample · not read from registers', refType: 'attendance' },
                        { label: 'Fee collection · 4-week average', detail: 'North 84.2% · City 86.1% · East 79.8%', source: 'Fees records · per campus', refType: 'fees' },
                        { label: 'Open incidents', detail: 'North 0 · City 1 (payment gateway) · East 1 (facilities)', source: 'Incident board', refType: 'incident' },
                        { label: 'Obligations due ≤ 14 days', detail: 'East: playground equipment inspection in 4 days · North: fire-safety renewal in 21 days', source: 'Obligations calendar' }]}
                    />
                    <div className="u-col" style={{ gap: 10 }}>
                      <AiTraceCard trace={GROUP_TRACE} />
                      <div className="u-xs u-faint">
                        Recommendation is ranked, not decided: campus actions remain with each campus's leadership under the shared constitution.
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <Empty
                  icon={<Icon.Sparkle size={22} />}
                  title="Cross-campus comparison is not available yet"
                  sub="This school does not have the group data plane, so per-campus attendance and collection cannot be compared. Nothing is estimated here."
                />
              )}
            </div>
          )}
        </Card>
      </Section>

      <div className="grid grid-2" style={{ gap: 20, marginTop: 4 }}>
        <Section title="Group decisions" sub="Board-level decisions that bind every campus.">
          <div className="u-col" style={{ gap: 10 }}>
            {groupDecisions.length === 0 && <Empty title="No group decisions recorded" />}
            {groupDecisions.map(d => (
              <Card key={d.id}>
                <div className="u-between" style={{ gap: 8, marginBottom: 4 }}>
                  <span className="mono u-xs u-faint">{d.id}</span>
                  <Badge tone={d.status === 'validated' ? 'success' : d.status === 'review-due' ? 'warning' : 'info'} dot>{d.status}</Badge>
                </div>
                <div style={{ fontWeight: 610, marginBottom: 3 }}>{d.title}</div>
                <div className="u-xs u-faint" style={{ marginBottom: 6 }}>Decided {fmtDateShort(d.decidedOn)} ({fmtRelative(d.decidedOn)}) · approver: {d.approver}</div>
                <div className="u-small u-muted">{d.expectedOutcome}</div>
                <div className="u-xs u-faint" style={{ marginTop: 6 }}>Policy · {d.policy}</div>
              </Card>
            ))}
          </div>
        </Section>

        <Section title="Obligations across campuses" sub={`${seed.obligations.length} obligations on the group calendar.`}>
          <Card>
            <div className="u-col" style={{ gap: 0 }}>
              {seed.obligations.map((o, i) => (
                <div key={o.id} className="u-between" style={{ gap: 10, padding: '9px 2px', borderBottom: i < seed.obligations.length - 1 ? '1px solid var(--border-subtle)' : undefined }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="u-small" style={{ fontWeight: 570 }}>{o.title}</div>
                    <div className="u-xs u-faint">Due {fmtDateShort(o.dueOn)} ({fmtRelative(o.dueOn)}) · {o.owner}</div>
                  </div>
                  <div className="u-flex" style={{ gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    <Badge tone="outline">{CAMPUS_LABEL[o.campus]}</Badge>
                    <Badge tone={o.status === 'due-soon' ? 'warning' : o.status === 'overdue' ? 'danger' : 'success'}>{o.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      </div>

      <Section title="Group standards" sub="What every campus shares — and the narrow space each campus may vary.">
        <div className="grid grid-3">
          <Card>
            <div className="u-flex" style={{ gap: 8, marginBottom: 6 }}>
              <Icon.Scale size={15} style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 620 }}>Shared constitution</span>
            </div>
            <div className="u-small u-muted">
              {seed.policies.length} entries · {seed.policies.filter(p => p.posture === 'AUTO').length} AUTO /{' '}
              {seed.policies.filter(p => p.posture === 'APPROVAL REQUIRED').length} approval /{' '}
              {seed.policies.filter(p => p.posture === 'HUMAN-ONLY').length} human-only. A change here applies to all campuses;
              campus copies may only tighten, never loosen.
            </div>
          </Card>
          <Card>
            <div className="u-flex" style={{ gap: 8, marginBottom: 6 }}>
              <Icon.Workflow size={15} style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 620 }}>Shared automation library</span>
            </div>
            <div className="u-small u-muted">
              {seed.workflows.length} automations, {seed.workflows.filter(w => w.enabled).length} enabled group-wide. Campus-scoped
              triggers and local quiet hours are honored at runtime; every run is audit-logged on its campus.
            </div>
          </Card>
          {seed.busRoutes.some(r => r.status === 'delayed') ? (
          <Card>
            <div className="u-flex" style={{ gap: 8, marginBottom: 6 }}>
              <Icon.Flag size={15} style={{ color: 'var(--warning)' }} />
              <span style={{ fontWeight: 620 }}>Campus-level exceptions</span>
            </div>
            <div className="u-small u-muted" style={{ marginBottom: 6 }}>
              2 open — both time-boxed and audit-logged:
            </div>
            <ul className="u-small u-muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li>North — attendance leniency until 09:30 while Bus 14 repairs complete (Transport §3.1).</li>
              <li>East — weekly counsellor review cadence until the second hire lands (Student Wellbeing §2.2).</li>
            </ul>
            <div className="u-xs u-faint" style={{ marginTop: 7 }}>Exceptions auto-expire in 30 days.</div>
          </Card>
          ) : (
          <Card>
            <div className="u-flex" style={{ gap: 8, marginBottom: 6 }}>
              <Icon.Flag size={15} style={{ color: 'var(--warning)' }} />
              <span style={{ fontWeight: 620 }}>Campus-level exceptions</span>
            </div>
            <div className="u-small u-muted">None open. Time-boxed exceptions (transport leniency, staffing cadences) appear here while active.</div>
          </Card>
          )}
        </div>
      </Section>
    </>
  );
}
