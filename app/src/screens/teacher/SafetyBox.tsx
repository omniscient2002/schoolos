/* Safety box — P10 · the anonymous student safety report queue (PRD-1).
   Designated safeguarding authority only (never the classroom teacher). An anonymous
   report carries no identity and it can never be recovered — the UI says so. */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, PageHead, Section, SkeletonCard, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtRelative } from '../../lib/format';
import { statusLabel, roleLabel, humanize } from '../../lib/labels';
import { useStore } from '../../state/store';
import {
  assignSafetyReport, closeSafetyReport, getSafetySummary, listBoxAssignees, listSafetyBox,
  type SafetyReport,
} from '../../services/teacherApi';
import { AsyncGate, DeniedState, useAsync, useTeacherAccess } from './teacherKit';

const SEV_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = { low: 'neutral', medium: 'warning', high: 'danger', serious: 'danger' };

export default function SafetyBox() {
  const toast = useToast();
  const { session } = useStore();
  const allowed = useTeacherAccess('/teacher/safety');
  const list = useAsync(() => listSafetyBox(), []);
  // OPP-PRD-9: the weekly pattern summary — counts by class/category, never identity.
  const summary = useAsync(() => getSafetySummary(), []);
  const [assignees, setAssignees] = useState<{ id: string; name: string; role: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { listBoxAssignees().then(d => setAssignees(d.assignees)).catch(() => setAssignees([])); }, []);

  const assign = async (r: SafetyReport, to: string) => {
    setBusy(r.reportId);
    try {
      await assignSafetyReport(r.reportId, to);
      toast({ title: 'Assigned for review', tone: 'success' });
      list.retry();
    } catch (e) {
      toast({ title: 'Could not assign', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setBusy(null); }
  };

  const close = async (r: SafetyReport) => {
    setBusy(r.reportId);
    try {
      await closeSafetyReport(r.reportId, 'review complete');
      toast({ title: 'Report closed', tone: 'success' });
      list.retry();
    } catch (e) {
      toast({ title: 'Could not close', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setBusy(null); }
  };

  if (!allowed) return <DeniedState role={roleLabel(session.roleId)} />;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <PageHead
        title="Safety box"
        sub="Reports from students. Anonymous reports store no name — that promise cannot be undone, by anyone."
      />
      {summary.data && summary.data.buckets.length > 0 && (
        <Section title="Weekly pattern" sub="Counts by class and category over the last 7 days — never identity, never unmasking.">
          <Card pad>
            <div className="u-col" style={{ gap: 6 }}>
              {summary.data.buckets.slice(0, 12).map((b, i) => (
                <div key={i} className="u-between u-small" style={{ gap: 10 }}>
                  <span className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
                    <Badge tone={SEV_TONE[b.severity] ?? 'neutral'} dot>{statusLabel(b.severity)}</Badge>
                    <span>Class {b.classGrade} · {humanize(b.category)}</span>
                  </span>
                  <span className="tnum">{b.count}</span>
                </div>
              ))}
            </div>
            <p className="u-xs u-faint" style={{ marginTop: 8, marginBottom: 0 }}>{summary.data.note}</p>
          </Card>
        </Section>
      )}
      <Section title="Reports" sub="Newest first.">
        <AsyncGate state={list} skeleton={<SkeletonCard lines={6} />}
          empty={<Empty icon={<Icon.Shield size={22} />} title="No safety reports" sub="Nothing has been filed recently." />}>
          {({ reports }) => reports.length === 0
            ? <Empty icon={<Icon.Shield size={22} />} title="No safety reports" sub="Nothing has been filed recently." />
            : (
              <div className="u-col" style={{ gap: 10 }}>
                {reports.map(r => (
                  <Card key={r.reportId} pad>
                    <div className="u-between u-wrap" style={{ gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Badge tone={SEV_TONE[r.severity] ?? 'neutral'} dot>{statusLabel(r.severity)}</Badge>
                          <Badge tone="outline">{humanize(r.category)}</Badge>
                          <span className="u-small u-muted">Class {r.classGrade}</span>
                          {r.anonymous && <Badge tone="neutral">Anonymous</Badge>}
                          <span className="u-xs u-faint">{fmtRelative(r.createdAt)}</span>
                        </div>
                        <p className="u-small" style={{ margin: '6px 0 0' }}>{r.detail}</p>
                        {!r.anonymous && r.assignedName && <div className="u-xs u-faint" style={{ marginTop: 4 }}>With {r.assignedName}</div>}
                      </div>
                      {r.status !== 'closed' && (
                        <span className="u-flex" style={{ gap: 8, flexShrink: 0, alignItems: 'center' }}>
                          <select className="input" style={{ width: 'auto' }} value="" disabled={busy === r.reportId}
                            onChange={e => e.target.value && assign(r, e.target.value)} aria-label={`Assign report`}>
                            <option value="">Assign…</option>
                            {assignees.map(a => <option key={a.id} value={a.id}>{a.name} ({roleLabel(a.role)})</option>)}
                          </select>
                          <Button size="sm" variant="secondary" disabled={busy === r.reportId} onClick={() => close(r)}>Close</Button>
                        </span>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
        </AsyncGate>
      </Section>
    </div>
  );
}
