/* ============================================================
   CoordHome — the coordinator command center (§1 of the plan).
   One screen answers the coordination questions for TODAY:
   who is off · where the uncovered periods are · what needs a
   decision · is the curriculum on pace · is staff load fair ·
   what is escalated. Every card deep-links to its detail screen.
   Ask box = deterministic copilot-lite v0: answers only from the
   coordinator's own door data, says so honestly when it can't.
   ============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageHead, Card, Stat, Badge, Button, Empty, ErrorState, SkeletonCard,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { friendly } from '../../lib/friendlyErrors';
import {
  getCoordHome, copilotLite, type CoordHome as CoordHomeData, type CoordCopilotAnswer,
} from '../../services/coordApi';
import { useCoordAccess, useCoordData, CoordDenied } from './shared';

const STAFF_META: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  present: { label: 'Present', tone: 'success' },
  on_leave: { label: 'On leave', tone: 'warning' },
  absent: { label: 'Absent', tone: 'danger' },
};

/* ---------- copilot-lite panel (deterministic v0 — honest by design) ---------- */
function AskBox() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [ans, setAns] = useState<CoordCopilotAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ask = async () => {
    if (!q.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      setAns(await copilotLite(q.trim()));
    } catch (e) {
      setErr(friendly(e)); setAns(null);
    } finally { setBusy(false); }
  };

  return (
    <Card pad style={{ marginBottom: 24 }}>
      <div className="u-flex" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <Icon.Sparkle size={14} style={{ color: 'var(--accent)' }} />
        <span className="u-small" style={{ fontWeight: 620 }}>Ask the coordinator desk</span>
        <Badge tone="outline">deterministic · no AI model</Badge>
      </div>
      <div className="u-flex" style={{ gap: 8 }}>
        <input
          className="input" value={q} disabled={busy}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') ask(); }}
          placeholder="e.g. which classes need intervention · curriculum delays · substitution gaps tomorrow"
          aria-label="Ask the coordinator desk — answers come from your own school data"
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button variant="ai" icon={<Icon.Send size={13} />} loading={busy} disabled={!q.trim()} onClick={ask}>Ask</Button>
      </div>
      {err && <div className="u-small" role="alert" style={{ marginTop: 10, color: 'var(--danger)' }}>{err}</div>}
      {ans && (
        <div className="u-col" style={{ gap: 8, marginTop: 12 }}>
          <div className="u-small" style={{ lineHeight: 1.65 }}>{ans.answer}</div>
          <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone="info">{ans.intent}</Badge>
            {ans.sources.map((s, i) => <Badge key={i} tone="outline">{s.ref}</Badge>)}
            <Badge tone="neutral">{ans.budget.used}/{ans.budget.cap} this month</Badge>
          </div>
          <div className="u-xs u-faint" style={{ lineHeight: 1.55 }}>
            Every answer is recomputed from your school's own records. When there is no data for a question it says so — it never guesses.
          </div>
        </div>
      )}
    </Card>
  );
}

export default function CoordHome() {
  const navigate = useNavigate();
  const { allowed } = useCoordAccess();
  const { data, loading, error, retry } = useCoordData<CoordHomeData>(getCoordHome);

  if (!allowed) return <CoordDenied what="The command center" />;

  const h = data;
  const away = (h?.staffing_today ?? []).filter(s => s.status !== 'present');
  const present = (h?.staffing_today ?? []).length - away.length;

  const cards: { to: string; icon: React.ReactNode; label: string; value: React.ReactNode; sub: string; alert?: boolean }[] = [
    {
      to: '/coord/substitutions', icon: <Icon.Users size={16} />, label: 'Staffing today',
      value: away.length ? `${away.length} away` : 'All present',
      sub: away.length ? `${present} present · ${away.map(a => a.teacher).slice(0, 3).join(', ')}${away.length > 3 ? '…' : ''}` : 'No absences recorded for today',
      alert: away.length > 0,
    },
    {
      to: '/coord/substitutions', icon: <Icon.Clock size={16} />, label: 'Substitution gaps',
      value: h?.substitution_gaps.length ?? 0,
      sub: (h?.substitution_gaps.length ?? 0) ? h!.substitution_gaps.map(g => `P${g.period ?? '?'} ${g.subject}`).slice(0, 3).join(' · ') : 'Every period on today\'s grid is covered',
      alert: (h?.substitution_gaps.length ?? 0) > 0,
    },
    {
      to: '/coord/approvals', icon: <Icon.Clipboard size={16} />, label: 'Pending approvals',
      value: h?.pending_approvals.length ?? 0,
      sub: (h?.pending_approvals.length ?? 0) ? h!.pending_approvals.slice(0, 2).map(a => a.title).join(' · ') : 'Nothing is waiting on a decision',
      alert: (h?.pending_approvals.length ?? 0) > 0,
    },
    {
      to: '/coord/curriculum', icon: <Icon.Learning size={16} />, label: 'Curriculum delays',
      value: h?.curriculum_delays.length ?? 0,
      sub: (h?.curriculum_delays.length ?? 0)
        ? h!.curriculum_delays.slice(0, 2).map(d => `${d.subject} · ${d.class_grade ?? 'class'} · ${d.weeks_behind}w behind`).join(' · ')
        : 'All tracked classes are at or ahead of term pace',
      alert: (h?.curriculum_delays.length ?? 0) > 0,
    },
    {
      to: '/coord/workload', icon: <Icon.Scale size={16} />, label: 'Teacher workload',
      value: h ? `${(h.staffing_today ?? []).length} teachers` : '—',
      sub: 'Fairness view: balance duty across the team — never a ranking',
      alert: false,
    },
    {
      to: '/coord/escalations', icon: <Icon.Flag size={16} />, label: 'Open escalations',
      value: h?.open_issues.length ?? 0,
      sub: (h?.open_issues.length ?? 0) ? h!.open_issues.slice(0, 2).map(i => i.category).join(' · ') : 'No open concerns on the desk',
      alert: (h?.open_issues.length ?? 0) > 0,
    },
  ];

  return (
    <div>
      <PageHead
        title="Command Center"
        sub={`Today at a glance — staffing, gaps, decisions, pace and escalations in one place. ${h?.date ? `Server date ${h.date}.` : ''}`}
        actions={<Button variant="secondary" size="sm" icon={<Icon.Refresh size={13} />} onClick={retry}>Refresh</Button>}
      />

      {loading && (
        <div className="grid grid-3" style={{ marginBottom: 24 }}>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
        </div>
      )}
      {!loading && error && (
        <ErrorState title="Could not load the command center" sub={friendly(error)} onRetry={retry} />
      )}
      {!loading && !error && h && (
        <>
          <AskBox />

          <div className="grid grid-3" style={{ marginBottom: 24 }}>
            {cards.map(c => (
              <Card
                key={c.label} pad className="card-click"
                onClick={() => navigate(c.to)}
                head={<span className="u-flex" style={{ gap: 7, alignItems: 'center' }}>{c.icon}{c.label}</span>}
                headAs="h2"
                actions={c.alert ? <Badge tone="warning" dot>needs you</Badge> : <Badge tone="success">clear</Badge>}
              >
                <div style={{ fontWeight: 650, fontSize: 'var(--text-2xl, 26px)', lineHeight: 1.2 }}>{c.value}</div>
                <div className="u-small u-muted" style={{ marginTop: 4, lineHeight: 1.5 }}>{c.sub}</div>
              </Card>
            ))}
          </div>

          {/* staffing strip — the people behind the numbers */}
          <Card
            head="Staffing today" sub="From approved leave and absence marks — protection and cover, in plain language."
            actions={<Button variant="ghost" size="sm" iconRight={<Icon.ArrowUpRight size={12} />} onClick={() => navigate('/coord/substitutions')}>Review cover</Button>}
          >
            {(h.staffing_today ?? []).length === 0 ? (
              <Empty title="No staffing data yet" sub="Once the timetable and leave records exist, today's roster appears here." />
            ) : (
              <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                {h.staffing_today.map(s => {
                  const m = STAFF_META[s.status] ?? { label: s.status, tone: 'neutral' as const };
                  return <Badge key={s.teacher} tone={m.tone}>{s.teacher}{s.status !== 'present' ? ` · ${m.label}` : ''}</Badge>;
                })}
              </div>
            )}
          </Card>

          <div className="u-xs u-faint" style={{ marginTop: 14, lineHeight: 1.6 }}>
            {h.grid_note} · Substitution gaps show period + subject; class sections arrive when the timetable grid grows a class column.
          </div>
        </>
      )}
    </div>
  );
}
