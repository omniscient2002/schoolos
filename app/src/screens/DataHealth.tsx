/* ============================================================
   Data Health — the trust console for records and integrations.
   Score animates locally as issues are fixed (+2.6 per verified
   fix, baseline 94). Issues group by category; Review opens a
   drawer with the affected seed records; Fix/Ignore write
   immutable audit entries and update local status (seed stays
   untouched). Integration status + recent fixes close the loop.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { PageHead, Card, Badge, Button, Empty, Skeleton, SkeletonCard, DataTable, Drawer, useToast, Progress, Section, SampleNote } from '../components/ui';
import { friendly } from '../lib/friendlyErrors';
import { Icon } from '../components/Icon';
import { fmtDateShort, fmtRelative } from '../lib/format';
import type { HealthIssue, Person } from '../types/domain';

/* ---------- local async pattern (per APP-SPEC) ---------- */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => live && setState({ data: d, loading: false, error: null }))
      .catch(e => live && setState({ data: null, loading: false, error: friendly(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'accent' | 'outline';

const CATEGORY_LABEL: Record<HealthIssue['category'], string> = {
  guardian: 'Guardian records',
  enrollment: 'Enrollment',
  fees: 'Fees records',
  attendance: 'Attendance',
  documents: 'Documents',
  integrations: 'Integrations',
};
const CATEGORY_ORDER: HealthIssue['category'][] = ['guardian', 'enrollment', 'fees', 'attendance', 'documents', 'integrations'];
const SEVERITY_TONE: Record<HealthIssue['severity'], BadgeTone> = { high: 'danger', medium: 'warning', low: 'neutral' };

/* ---------- affected-records builders (all derived from seed) ---------- */
interface ReviewTable { columns: { key: string; label: string }[]; rows: Record<string, string>[]; note: string }

function duplicateGuardianRows(): ReviewTable {
  const byPhone = new Map<string, Person[]>();
  seed.guardians.forEach(g => {
    const key = g.phone.replace(/\s/g, '');
    byPhone.set(key, [...(byPhone.get(key) ?? []), g]);
  });
  const clusters = [...byPhone.entries()].filter(([, gs]) => gs.length > 1);
  const rows = clusters
    .slice(0, 8)
    .map(([phone, gs]) => {
      const students = gs.map(g => seed.guardianLinks.filter(l => l.guardianId === g.id).length).reduce((a, b) => a + b, 0);
      return {
        phone,
        names: gs.map(g => g.name).join('  /  '),
        ids: gs.map(g => g.id).join(', '),
        students: String(students),
        action: gs.length > 1 ? 'Merge — keep stronger contact trail' : '—',
      };
    });
  return {
    columns: [ { key: 'names', label: 'Name variants' }, { key: 'phone', label: 'Shared phone' }, { key: 'ids', label: 'Record ids' }, { key: 'students', label: 'Links' }, { key: 'action', label: 'Suggested' } ],
    rows,
    note: `${rows.length} of ${clusters.length} duplicate clusters shown. Merge preserves both guardian roles and keeps the verified contact trail.`,
  };
}

function missingEmergencyRows(): ReviewTable {
  const rows = seed.students
    .map(st => ({ st, links: seed.guardianLinks.filter(l => l.studentId === st.id) }))
    .filter(x => x.links.length === 1)
    .slice(0, 8)
    .map(x => {
      const g = seed.guardians.find(g => g.id === x.links[0].guardianId);
      return {
        student: `${x.st.name} (${x.st.grade}-${x.st.section})`,
        guardian: g?.name ?? '—',
        verified: x.links[0].verified ? 'Verified' : 'Unverified',
        gap: 'No second reachable guardian',
        action: 'Collect at PTM (6 days away)',
      };
    });
  return {
    columns: [ { key: 'student', label: 'Student' }, { key: 'guardian', label: 'Only guardian' }, { key: 'verified', label: 'WhatsApp' }, { key: 'gap', label: 'Gap' }, { key: 'action', label: 'Fix path' } ],
    rows,
    note: 'Class teachers get a collection task ahead of the Parent-Teacher Meeting; the absent-guardian workflow pauses until then.',
  };
}

function feeMismatchRows(): ReviewTable {
  const rows = seed.payments.filter(p => p.status === 'failed').slice(0, 8).map(p => ({
    reference: p.reference,
    student: seed.students.find(s => s.id === p.studentId)?.name ?? p.studentId,
    amount: `₹${p.amount.toLocaleString('en-IN')}`,
    method: p.method,
    on: fmtDateShort(p.on),
    action: 'Match settlement row on import',
  }));
  return {
    columns: [ { key: 'reference', label: 'Gateway ref' }, { key: 'student', label: 'Payer' }, { key: 'amount', label: 'Amount' }, { key: 'method', label: 'Method' }, { key: 'on', label: 'Attempted' }, { key: 'action', label: 'Resolution' } ],
    rows,
    note: 'Includes the 23 timeout batch from case_3. Importing the bank file re-matches payments automatically; payment records are never edited by hand.',
  };
}

function expiredDocRows(): ReviewTable {
  const rows = seed.documents
    .filter(d => d.status === 'expired' || d.status === 'expiring')
    .slice(0, 10)
    .map(d => ({
      title: d.title,
      owner: d.ownerName,
      category: d.category,
      expires: d.expiresOn ? fmtDateShort(d.expiresOn) : '—',
      status: d.status,
    }));
  return {
    columns: [ { key: 'title', label: 'Document' }, { key: 'owner', label: 'Owner' }, { key: 'category', label: 'Category' }, { key: 'expires', label: 'Expires' }, { key: 'status', label: 'Status' } ],
    rows,
    note: 'Renewal tasks go to class teachers (bulk) per workflow wf_5; school compliance certificates route to the Admin Officer.',
  };
}

function rollGapRows(): ReviewTable {
  const rows: Record<string, string>[] = [];
  seed.sections.forEach(sec => {
    const sts = seed.studentsOfSection(sec.id)
      .map(s => Number(s.rollNo ?? 0))
      .filter(n => n > 0)
      .sort((a, b) => a - b);
    if (!sts.length) return;
    const gaps: number[] = [];
    for (let n = 1; n < sts[sts.length - 1]; n++) if (!sts.includes(n)) gaps.push(n);
    if (gaps.length) {
      rows.push({ section: `${sec.grade}-${sec.name} · ${sec.campus}`, rolls: `${sts[0]}–${sts[sts.length - 1]}`, gaps: gaps.slice(0, 6).join(', ') + (gaps.length > 6 ? ` +${gaps.length - 6}` : ''), count: String(gaps.length) });
    }
  });
  return {
    columns: [ { key: 'section', label: 'Section' }, { key: 'rolls', label: 'Roll range' }, { key: 'gaps', label: 'Missing rolls' }, { key: 'count', label: 'Gaps' } ],
    rows: rows.slice(0, 9),
    note: 'Gaps come from mid-year exits. Auto-renumbering applies effective-dating so historical registers keep their original rolls.',
  };
}

function unverifiedGuardianRows(): ReviewTable {
  const rows = seed.guardianLinks.filter(l => !l.verified).slice(0, 8).map(l => {
    const g = seed.guardians.find(g => g.id === l.guardianId);
    const st = seed.students.find(s => s.id === l.studentId);
    return {
      guardian: g?.name ?? l.guardianId,
      student: st ? `${st.name} (${st.grade}-${st.section})` : l.studentId,
      relation: l.relation,
      status: '≥3 WhatsApp delivery failures',
      action: 'SMS fallback + verification request',
    };
  });
  return {
    columns: [ { key: 'guardian', label: 'Guardian' }, { key: 'student', label: 'Linked student' }, { key: 'relation', label: 'Relation' }, { key: 'status', label: 'Delivery' }, { key: 'action', label: 'Fix path' } ],
    rows,
    note: 'Absence alerts for these guardians fall back to SMS so Attendance §1.1 notification SLAs still hold.',
  };
}

function reviewFor(issue: HealthIssue): ReviewTable {
  switch (issue.id) {
    case 'hl_1': return duplicateGuardianRows();
    case 'hl_2': return missingEmergencyRows();
    case 'hl_3': return feeMismatchRows();
    case 'hl_4': return expiredDocRows();
    case 'hl_5': return rollGapRows();
    case 'hl_6': return unverifiedGuardianRows();
    default: return { columns: [], rows: [], note: 'No sample rows are exposed for this category in the demo dataset; the fix path still records an audited bulk action.' };
  }
}

/* ---------- issue row ---------- */
function IssueRow({ issue, onReview, onFix, onIgnore }: {
  issue: HealthIssue;
  onReview: () => void;
  onFix: () => void;
  onIgnore: () => void;
}) {
  const done = issue.status !== 'open';
  return (
    <div className="u-between" style={{ gap: 14, padding: '13px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0 }} className="u-col">
        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Badge tone={SEVERITY_TONE[issue.severity]} dot={issue.severity === 'high'}>{issue.severity}</Badge>
          <span style={{ fontWeight: 600 }}>{issue.title}</span>
          <Badge tone="outline">{issue.count} record{issue.count === 1 ? '' : 's'}</Badge>
          {issue.status === 'fixed' && <Badge tone="success"><Icon.Check size={10} style={{ marginRight: 3, verticalAlign: '-1px' }} />fixed</Badge>}
          {issue.status === 'ignored' && <Badge tone="neutral">ignored</Badge>}
        </div>
        <div className="u-small u-muted" style={{ marginTop: 3, lineHeight: 1.55 }}>{issue.detail}</div>
        <div className="u-xs u-faint" style={{ marginTop: 3 }}>
          Suggested fix — {issue.suggestedFix}
        </div>
      </div>
      <div className="u-flex" style={{ gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Button size="sm" variant="secondary" icon={<Icon.Eye size={13} />} onClick={onReview}>Review</Button>
        <Button size="sm" variant="primary" icon={<Icon.Wrench size={13} />} onClick={onFix} disabled={done}>Fix</Button>
        <Button size="sm" variant="ghost" icon={<Icon.Offline size={13} />} onClick={onIgnore} disabled={done}>Ignore</Button>
      </div>
    </div>
  );
}

/* ---------- main ---------- */

/* ---------- Bulk grid — spreadsheet-grade paste-fix (docs/06 §6, V1 requirement) ---------- */
type GridRow = { phone: string; name: string; patch: string; state: 'pending' | 'valid' | 'invalid' | 'applied'; reason?: string };

function BulkGrid({ onApplied }: { onApplied: (n: number) => void }) {
  const toast = useToast();
  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState<GridRow[]>([]);
  const [applied, setApplied] = useState(false);

  const parse = () => {
    const parsed: GridRow[] = raw.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [phone, name, patch] = l.split(/[\t,;]/).map(x => (x ?? '').trim());
      const validPhone = /^\+?[0-9 ()-]{10,15}$/.test(phone ?? '');
      const validName = (name ?? '').length >= 3;
      return {
        phone: phone ?? '', name: name ?? '', patch: patch ?? '',
        state: validPhone && validName ? 'valid' : 'invalid',
        reason: validPhone ? (validName ? undefined : 'Name too short') : 'Phone not parseable',
      };
    });
    setRows(parsed);
    setApplied(false);
    const bad = parsed.filter(r => r.state === 'invalid').length;
    toast({ title: `${parsed.length} rows parsed`, sub: bad ? `${bad} row${bad === 1 ? '' : 's'} invalid — fix or drop them before apply` : 'All rows validate. Preview looks right? Apply.', tone: bad ? 'error' : 'success' });
  };

  const apply = () => {
    const good = rows.filter(r => r.state === 'valid').length;
    setRows(rs => rs.map(r => (r.state === 'valid' ? { ...r, state: 'applied' as const } : r)));
    setApplied(true);
    onApplied(good);
    /* T305 (§9.5): rows were validated in this preview only — no door writes
       corrections to school records, and no audit entry is recorded anywhere. */
    toast({ title: `Preview applied — ${good} row${good === 1 ? '' : 's'} marked in this view`, sub: 'Client-only: no records were changed in school records, and no audit entry was written (bulk fixes require server support).', tone: 'info' });
  };

  return (
    <div className="u-col" style={{ gap: 10 }}>
      <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>
        Paste straight from Excel — one record per line: <span className="u-mono">phone, name, corrected-value</span>. Rows validate before anything is shown;
        this is a client-only preview — applying marks rows in this view only and writes nothing to school records.
      </div>
      <textarea
        value={raw}
        onChange={e => setRaw(e.target.value)}
        rows={4}
        aria-label="Bulk paste area"
        placeholder={'+91 98204 41130, Meera Sharma, +91 98204 41131\n+91 99303 41118, R. Iyer, +91 99303 41119'}
        style={{ font: 'var(--font-mono, monospace)', fontSize: 12.5, width: '100%', padding: '10px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', resize: 'vertical' }}
      />
      <div className="u-inline" style={{ gap: 8 }}>
        <Button size="sm" variant="secondary" disabled={!raw.trim()} onClick={parse}>Validate</Button>
        <Button size="sm" variant="primary" disabled={!rows.some(r => r.state === 'valid') || applied} onClick={apply}>
          Apply {rows.filter(r => r.state === 'valid').length || ''} valid rows
        </Button>
        {applied && <Button size="sm" variant="ghost" onClick={() => { setRows([]); setRaw(''); setApplied(false); toast({ title: 'Preview cleared', sub: 'Nothing was written to school records, so there is nothing to undo.', tone: 'info' }); }}>Clear preview</Button>}
      </div>
      {rows.length > 0 && (
        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <div key={i} className="u-between" style={{ gap: 10, padding: '7px 12px', borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : undefined, fontSize: 'var(--text-sm)' }}>
              <span className="u-inline" style={{ gap: 10 }}>
                <span className="u-mono u-small">{r.phone || '—'}</span>
                <span>{r.name || '—'}</span>
                {r.patch && <span className="u-small u-muted">→ {r.patch}</span>}
              </span>
              <Badge tone={r.state === 'valid' || r.state === 'applied' ? 'success' : r.state === 'invalid' ? 'danger' : 'neutral'}>
                {r.state}{r.reason ? ` · ${r.reason}` : ''}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DataHealth() {
  const { domain, dispatch, actorName, session } = useStore();
  const toast = useToast();
  const navigate = useNavigate();

  /* local copy — seed data is immutable; fixes live in this state */
  const [issues, setIssues] = useState<HealthIssue[]>(() => seed.healthIssues.map(i => ({ ...i })));
  /* score starts at the verified baseline 94 (policy-model floor via seed.healthScore) and +2.6 per fix */
  const [score, setScore] = useState(() => Math.max(94, seed.healthScore(seed.healthIssues)));

  const [reviewId, setReviewId] = useState<string | null>(null);

  const { data: reviewData, loading: reviewLoading, error: reviewError, retry: reviewRetry } = useAsync<ReviewTable>(
    () => new Promise<ReviewTable>((resolve, reject) => {
      setTimeout(() => {
        try {
          const issue = seed.healthIssues.find(i => i.id === reviewId);
          resolve(reviewFor(issue ?? ({ id: '' } as HealthIssue)));
        } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
      }, 420);
    }),
    [reviewId],
  );

  const grouped = useMemo(() => {
    const g = new Map<HealthIssue['category'], HealthIssue[]>();
    issues.forEach(i => g.set(i.category, [...(g.get(i.category) ?? []), i]));
    return g;
  }, [issues]);

  const openCount = issues.filter(i => i.status === 'open').length;
  const fixedCount = issues.filter(i => i.status === 'fixed').length;
  const ignoredCount = issues.filter(i => i.status === 'ignored').length;
  const scorePct = Math.max(0, Math.min(100, score));

  const recentFixes = domain.audit.filter(a => a.recordType === 'Data health' || a.action.startsWith('Bulk action')).slice(0, 6);

  const reviewIssue = issues.find(i => i.id === reviewId) ?? null;

  const fix = (issue: HealthIssue) => {
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName,
        actorRole: session.roleId,
        action: `Marked fix (preview) — ${issue.title}`,
        recordType: 'Data health',
        recordRef: `${issue.count} records · ${CATEGORY_LABEL[issue.category]}`,
        reason: issue.suggestedFix,
        policyRef: 'Data governance §1.2 — fixes are bulk, audited, reversible',
        aiInvolved: false,
        risk: issue.severity === 'high' ? 'medium' : 'low',
        outcome: 'Marked fixed in this preview only — no records changed (fixes not connected)',
      },
    });
    setIssues(list => list.map(i => (i.id === issue.id ? { ...i, status: 'fixed' } : i)));
    setScore(s => Math.min(100, Math.round((s + 2.6) * 10) / 10));
    /* T305 (§9.5): the old toast claimed "N records processed" — nothing
       touches school records; even the score is this screen's local model. */
    toast({ title: `Marked fixed in this preview — ${issue.count} records were NOT changed.`, sub: 'Client-only: the fix needs server support to touch school records; the score is this screen\'s local model.', tone: 'info' });
  };

  const ignore = (issue: HealthIssue) => {
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName,
        actorRole: session.roleId,
        action: `Ignored issue — ${issue.title}`,
        recordType: 'Data health',
        recordRef: `${issue.count} records · ${CATEGORY_LABEL[issue.category]}`,
        reason: 'Reviewed and consciously deferred',
        policyRef: 'Data governance §1.2',
        aiInvolved: false,
        risk: 'low',
        outcome: 'Ignored · remains visible in the audit trail',
      },
    });
    setIssues(list => list.map(i => (i.id === issue.id ? { ...i, status: 'ignored' } : i)));
    toast({ title: 'Issue ignored.', sub: 'It stays out of the open list; the score does not change for ignored items.', tone: 'info' });
  };

  const maintenanceVehicles = seed.busRoutes.filter(r => r.status === 'maintenance');

  return (
    <>
      <PageHead
        title="Data quality"
        sub="The state of the records every decision stands on — duplicates, gaps, mismatches and expiries, each with an audited fix path."
        actions={<Button variant="secondary" size="sm" icon={<Icon.Database size={13} />} onClick={() => navigate('/audit')}>Open the audit trail</Button>}
      />

      <SampleNote>Sample data quality — the health score and issue list are this screen&rsquo;s illustrative model in this build; nothing here is read from your school&rsquo;s records and no fix is written to the server.</SampleNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 24, alignItems: 'start' }}>
        {/* ---------- issues ---------- */}
        <div className="u-col" style={{ gap: 16 }}>
          {CATEGORY_ORDER.filter(cat => grouped.has(cat)).map(cat => (
            <Section
              key={cat}
              title={<span style={{ fontSize: 'var(--text-xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 650 }}>{CATEGORY_LABEL[cat]}</span>}
              sub={`${grouped.get(cat)!.filter(i => i.status === 'open').length} open of ${grouped.get(cat)!.length} issue${grouped.get(cat)!.length === 1 ? '' : 's'}`}
            >
              <Card pad>
                {grouped.get(cat)!.map(issue => (
                  <IssueRow key={issue.id} issue={issue} onReview={() => setReviewId(issue.id)} onFix={() => fix(issue)} onIgnore={() => ignore(issue)} />
                ))}
                {grouped.get(cat)!.every(i => i.status !== 'open') && (
                  <div className="u-xs u-faint" style={{ paddingTop: 10 }}>
                    All clear in this category — fixes and ignored items are recorded in the audit trail.
                  </div>
                )}
              </Card>
            </Section>
          ))}

          {issues.every(i => i.status !== 'open') && (
            <Card pad>
              <Empty icon={<Icon.Check size={22} />} title="Every issue is handled" sub="Fixed and ignored items remain listed above with their audit trail. The seed dataset is untouched — a reset restores the original state." />
            </Card>
          )}
        </div>

        {/* ---------- score + integrations + fixes ---------- */}
        <div className="u-col" style={{ gap: 16, position: 'sticky', top: 16 }}>
          <Card pad>
            <div className="u-xs" style={{ fontWeight: 650, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Data health score</div>
            <div className="u-flex" style={{ gap: 12, alignItems: 'flex-end', marginTop: 4 }}>
              <span style={{ fontSize: 'var(--text-3xl)', fontWeight: 660, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{score.toFixed(1)}</span>
              <Badge tone={scorePct >= 97 ? 'success' : scorePct >= 90 ? 'warning' : 'danger'} dot>
                {scorePct >= 97 ? 'healthy' : scorePct >= 90 ? 'needs attention' : 'at risk'}
              </Badge>
            </div>
            <div style={{ marginTop: 10 }}><Progress value={scorePct} tone={scorePct >= 97 ? undefined : 'warn'} /></div>
            <div className="u-xs u-faint" style={{ marginTop: 8, lineHeight: 1.6 }}>
              Baseline 94 · each verified fix adds +2.6. Ignored items do not move the score — they stay visible here and in the audit trail.
            </div>
            <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <Badge tone="warning">{openCount} open</Badge>
              <Badge tone="success">{fixedCount} fixed</Badge>
              <Badge tone="neutral">{ignoredCount} ignored</Badge>
            </div>
          </Card>

          <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Zap size={14} /> Integration status</span>} pad>
            <div className="u-col" style={{ gap: 10 }}>
              {[
                /* L5-4.2: the fabricated "Connected · healthy / last export 06:00 /
                   0 failures" Tally row is gone — no gateway is wired, say so. */
                { name: 'Tally gateway', tone: 'neutral' as BadgeTone, status: 'Not connected', detail: 'No gateway is wired yet — voucher exports are planned, not scheduled.' },
                { name: 'Payment gateway', tone: 'warning' as BadgeTone, status: 'Import pending · manual', detail: 'Settlement mismatches await the bank-file import (issue case_3 below) — no live gateway is connected.' },
                { name: 'GPS tracking', tone: maintenanceVehicles.length ? 'warning' as BadgeTone : 'success' as BadgeTone, status: maintenanceVehicles.length ? `${maintenanceVehicles.length} vehicle${maintenanceVehicles.length > 1 ? 's' : ''} offline` : 'All vehicles reporting', detail: maintenanceVehicles.length ? maintenanceVehicles.map(r => `${r.name.split('—')[0].trim()} · ${r.vehicle} in workshop`).join(' · ') : 'Heartbeats nominal' },
              ].map(row => (
                <div key={row.name} className="u-between u-small" style={{ gap: 10 }}>
                  <span className="u-col" style={{ gap: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{row.name}</span>
                    <span className="u-xs u-faint u-truncate">{row.detail}</span>
                  </span>
                  <Badge tone={row.tone} dot>{row.status}</Badge>
                </div>
              ))}
            </div>
            <div className="u-xs u-faint" style={{ marginTop: 10, lineHeight: 1.55 }}>
              Integrations never edit records directly — mismatches land here as issues with an audited fix path.
            </div>
          </Card>


          <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Grid size={14} /> Bulk grid — fix from Excel</span>} pad>
            <BulkGrid onApplied={(n) => setScore(sc => Math.min(100, sc + Math.min(2, n * 0.1)))} />
          </Card>

          <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Clipboard size={14} /> Recent fixes</span>} pad>
            {recentFixes.length === 0 ? (
              <Empty icon={<Icon.Wrench size={20} />} title="No fixes yet" sub="Fixing an issue records an immutable audit entry here — actor, scope, reason and outcome." />
            ) : (
              <div className="u-col" style={{ gap: 9 }}>
                {recentFixes.map(a => (
                  <div key={a.id} className="u-col" style={{ gap: 1, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                    <div className="u-flex u-small" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{a.action}</span>
                      <span className="u-faint mono" style={{ marginLeft: 'auto', flexShrink: 0 }}>{fmtRelative(a.on)}</span>
                    </div>
                    <div className="u-xs u-faint">{a.recordRef} · {a.actor} · {a.outcome}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ---------- review drawer ---------- */}
      <Drawer
        open={!!reviewIssue}
        onClose={() => setReviewId(null)}
        title={reviewIssue?.title ?? ''}
        sub={reviewIssue ? `${CATEGORY_LABEL[reviewIssue.category]} · ${reviewIssue.count} affected records · severity ${reviewIssue.severity}` : undefined}
        footer={reviewIssue && reviewIssue.status === 'open' ? (
          <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => ignore(reviewIssue)}>Ignore</Button>
            <Button variant="primary" icon={<Icon.Wrench size={13} />} onClick={() => fix(reviewIssue)}>Fix — {reviewIssue.count} records</Button>
          </div>
        ) : undefined}
      >
        {reviewIssue && (
          <div className="u-col" style={{ gap: 12 }}>
            <p className="u-small" style={{ margin: 0, lineHeight: 1.65 }}>{reviewIssue.detail}</p>
            <div className="u-small" style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.04em', fontSize: 'var(--text-xs)', textTransform: 'uppercase', marginRight: 6 }}>Suggested fix</span>
              {reviewIssue.suggestedFix}
            </div>
            {reviewLoading && (
              <div className="u-col" style={{ gap: 8 }}>
                <Skeleton w="40%" h={12} />
                <SkeletonCard lines={4} />
              </div>
            )}
            {reviewError && (
              <div className="u-col" style={{ gap: 8 }}>
                <Empty icon={<Icon.Alert size={20} />} title="Records could not load" sub="The query against affected rows failed." action={<Button variant="secondary" size="sm" onClick={reviewRetry}>Try again</Button>} />
              </div>
            )}
            {!reviewLoading && !reviewError && reviewData && (
              <>
                {reviewData.rows.length ? (
                  <DataTable
                    columns={reviewData.columns}
                    rows={reviewData.rows}
                    rowKey={r => Object.values(r).join('|')}
                    empty={<Empty title="No rows" />}
                  />
                ) : (
                  <Empty icon={<Icon.Database size={20} />} title="No sample rows" sub={reviewData.note} />
                )}
                {reviewData.rows.length > 0 && <div className="u-xs u-faint" style={{ lineHeight: 1.6 }}>{reviewData.note}</div>}
              </>
            )}
            <div className="u-xs u-faint" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, lineHeight: 1.6 }}>
              Preview scope: fixes apply to this workspace view only — no records were changed on the server. Real bulk fixes with your identity and an audited undo path land with the data-quality doors (L3-4.x).
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
