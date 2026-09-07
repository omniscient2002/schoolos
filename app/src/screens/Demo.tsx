/* ============================================================
   Demo launcher — the product demo entry point.
   Not a marketing page: three loops, one guided path, one
   operating system. Loop identities: Confidence · Control · Trust.
   ============================================================ */
import { Link } from 'react-router-dom';
import { PageHead, Card, Badge, Button } from '../components/ui';
import { Icon } from '../components/Icon';
import { GUIDED_PATH } from '../demo/loops';

const LOOPS = [
  {
    id: 'loop1', num: '1', feeling: 'Confidence', title: 'Migrate my school',
    sub: 'The switch from Excel, Tally and WhatsApp logs — verified to the rupee, live the same evening.',
    steps: ['Connect 5 sources', 'Analyze 5,099 records', 'Confirm mappings', 'Fix data health', 'Shadow school', 'Trust receipt', 'Activate', 'First morning'],
    to: '/migration', cta: 'Start the switch',
    icon: 'Database' as const, accent: 'var(--success)',
  },
  {
    id: 'loop2', num: '2', feeling: 'Control', title: 'Run my day',
    sub: 'A disruption morning: SchoolOS notices, explains with evidence, proposes the action — you approve it once.',
    steps: ['Simulate the day', 'Watch events flow', 'Read the briefing', 'Ask why', 'Approve', 'Watch it propagate', 'Loop closed'],
    to: '/demo/day', cta: 'Run the day',
    icon: 'Operations' as const, accent: 'var(--accent)',
  },
  {
    id: 'loop3', num: '3', feeling: 'Trust', title: 'Resolve a parent issue',
    sub: 'A fee question from WhatsApp: checked, answered from records, self-served, payment matched — and remembered.',
    steps: ['Parent message', 'Checked before shared', 'Clear, sourced answer', 'Pay now', 'Receipt + matching', 'Case resolved', 'The activity log'],
    to: '/demo/parent', cta: 'Open the parent loop',
    icon: 'Shield' as const, accent: 'var(--ai)',
  },
];

export default function Demo() {
  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <PageHead
        title="SchoolOS"
        sub="The operating loop for your school. Three journeys, one system — pick one, or run the guided 15 minutes."
        actions={<Badge tone="outline" dot>Demo environment · seeded Meridian data</Badge>}
      />

      <div className="grid grid-3" style={{ gap: 'var(--s-4)' }}>
        {LOOPS.map(l => {
          const I = Icon[l.icon];
          return (
            <Card key={l.id} onClick={() => window.location.assign(l.to)} style={{ borderTop: `3px solid ${l.accent}` }}>
              <div className="u-col" style={{ gap: 10 }}>
                <div className="u-between">
                  <span style={{ width: 38, height: 38, borderRadius: 12, background: `color-mix(in srgb, ${l.accent} 12%, transparent)`, color: l.accent, display: 'grid', placeItems: 'center' }}><I size={19} /></span>
                  <span className="u-upper u-xs" style={{ fontWeight: 660, color: l.accent, letterSpacing: '0.07em' }}>{l.feeling}</span>
                </div>
                <div>
                  <div style={{ fontWeight: 680, fontSize: 'var(--text-lg)' }}>{l.title}</div>
                  <div className="u-small u-muted" style={{ marginTop: 3, lineHeight: 1.6 }}>{l.sub}</div>
                </div>
                <ol className="u-col" style={{ gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
                  {l.steps.map((s, i) => (
                    <li key={s} className="u-inline u-small" style={{ gap: 8, color: 'var(--text-2)' }}>
                      <span className="u-mono u-xs" style={{ color: 'var(--text-3)', width: 14 }}>{String(i + 1).padStart(2, '0')}</span>{s}
                    </li>
                  ))}
                </ol>
                <span className="btn btn-secondary" style={{ marginTop: 2 }}>{l.cta} →</span>
              </div>
            </Card>
          );
        })}
      </div>

      <Card head="The 15-minute guided path" sub="Minute by minute — skip any stage, the story holds" style={{ marginTop: 'var(--s-5)' }}>
        <div className="u-col" style={{ gap: 10 }}>
          {GUIDED_PATH.map((g, i) => (
            <div key={g.id} className="u-inline" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="u-mono" style={{ width: 46, fontWeight: 660, color: 'var(--text-3)' }}>{i < 3 ? `${i + 1} / 3` : '15 min'}</span>
              <span className="u-mono u-small" style={{ width: 52, color: 'var(--text-3)' }}>min {g.minutes}</span>
              <div className="u-col" style={{ gap: 1, flex: 1, minWidth: 220 }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{g.label}</span>
                <span className="u-small u-muted">{g.blurb}</span>
              </div>
              <Link to={g.to} className="btn btn-sm btn-secondary">Open</Link>
            </div>
          ))}
        </div>
        <div className="u-inline" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Button variant="primary" icon={<Icon.Play size={14} />} onClick={() => window.location.assign('/migration')}>Start the 15 minutes — Loop 1</Button>
          <Link to="/today" className="btn btn-ghost">Explore the full product instead</Link>
        </div>
      </Card>

      <div className="u-small u-muted" style={{ marginTop: 'var(--s-4)', textAlign: 'center', lineHeight: 1.7 }}>
        Every number in these loops comes from one seeded school state — the fee total on the parent chat is the same rupee the principal sees reconciled and the auditor sees in the ledger.
        <br />SchoolOS demo · no real student data · deterministic scripts, no invented AI.
      </div>
    </div>
  );
}
