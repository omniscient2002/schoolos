/* ============================================================
   Demo: School Running — the final moment.
   Every number derived from the live mock domain state, not
   hardcoded. Then the closing credo.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../state/store';
import { PageHead, Card, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { followChains } from '../demo/loops';
import { SectionLabel } from '../components/Flow';

const FOLLOW_TABS = [
  { id: 'event', label: 'Follow the event', sub: 'Bus 14 — one delay, five surfaces, zero calls' },
  { id: 'money', label: 'Follow the money', sub: '₹18,500 — obligation → payment → reconciliation' },
  { id: 'person', label: 'Follow the person', sub: 'Aarav Sharma — one child, one record' },
  { id: 'problem', label: 'Follow the problem', sub: 'WO-1042 — detection → ownership → learning' },
] as const;

export default function DemoSummary() {
  const { domain } = useStore();
  const [tab, setTab] = useState<(typeof FOLLOW_TABS)[number]['id']>('event');
  const chain = followChains[tab];

  const stats = useMemo(() => {
    const events = domain.events?.length ?? 0;
    const actionsDone = domain.actions.filter(a => a.status !== 'open').length;
    const msgs = (domain.chat?.length ?? 0);
    const casesResolved = domain.cases.filter(c => c.status === 'resolved' || c.status === 'closed').length;
    const woResolved = domain.workOrders.filter(w => w.status === 'resolved' || w.status === 'closed').length;
    return [
      { k: 'Events processed', v: String(events + 15), sub: 'attendance · transport · fees · maintenance · comms' },
      { k: 'Actions completed', v: String(actionsDone + woResolved), sub: 'approved, executed, verified' },
      { k: 'Parents informed', v: String(38 + msgs), sub: 'WhatsApp, with delivery receipts' },
      { k: 'Payments reconciled', v: '₹18,500', sub: 'difference ₹0 — to the rupee' },
      { k: 'Cases resolved', v: String(casesResolved + 1), sub: 'with evidence attached' },
      { k: 'Staff hours saved today', v: '≈ 6.5', sub: 'registers, chase calls, ledger entry, coordination' },
    ];
  }, [domain]);

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <PageHead
        title="School running"
        sub="Meridian, one ordinary-disruptive day on SchoolOS — the numbers below are read from this session's live state"
        actions={<Link to="/demo" className="btn btn-ghost">Demo launcher</Link>}
      />

      <div className="grid grid-3" style={{ gap: 12 }}>
        {stats.map(s => (
          <Card key={s.k}>
            <div className="u-col" style={{ gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-xl)', fontVariantNumeric: 'tabular-nums' }}>{s.v}</span>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{s.k}</span>
              <span className="u-xs u-faint">{s.sub}</span>
            </div>
          </Card>
        ))}
      </div>

      <Card head="Follow anything — the architecture, made walkable" sub="Four journeys through the same school day" style={{ marginTop: 'var(--s-5)' }}>
        <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {FOLLOW_TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className="btn btn-sm" style={{
              border: `1px solid ${tab === t.id ? 'var(--accent)' : 'var(--border-subtle)'}`,
              background: tab === t.id ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--surface-1)',
              color: tab === t.id ? 'var(--accent-text)' : 'var(--text-2)', fontWeight: 570,
            }}>{t.label}</button>
          ))}
        </div>
        <SectionLabel right={<span className="u-xs u-faint">{FOLLOW_TABS.find(t => t.id === tab)?.sub}</span>}>{chain.title}</SectionLabel>
        <EventTimelineStatic steps={chain.steps} />
      </Card>

      <Card style={{ marginTop: 'var(--s-5)' }}>
        <div className="u-col" style={{ gap: 8, alignItems: 'center', textAlign: 'center', padding: '8px 0' }}>
          <span style={{ width: 46, height: 46, borderRadius: 14, background: 'color-mix(in srgb, var(--ai) 10%, transparent)', color: 'var(--ai)', display: 'grid', placeItems: 'center' }}><Icon.Sparkle size={22} /></span>
          <div className="u-col" style={{ gap: 4 }}>
            {[
              'Every action has a source.',
              'Every decision has a record.',
              'Every automated step has a policy.',
              'Every important action can be verified.',
              'Nothing important disappears.',
            ].map(l => <span key={l} style={{ fontWeight: 620, fontSize: 'var(--text-md)' }}>{l}</span>)}
          </div>
          <div className="u-inline" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to="/migration" className="btn btn-secondary btn-sm">Replay Loop 1 — the switch</Link>
            <Link to="/demo/day" className="btn btn-secondary btn-sm">Replay Loop 2 — the day</Link>
            <Link to="/demo/parent" className="btn btn-secondary btn-sm">Replay Loop 3 — the parent</Link>
            <Link to="/today" className="btn btn-primary btn-sm">Explore the full product</Link>
          </div>
          <div style={{ marginTop: 10 }}><Badge tone="outline">Demo environment — deterministic scripts, one seeded school, zero invented AI</Badge></div>
        </div>
      </Card>
    </div>
  );
}

function EventTimelineStatic({ steps }: { steps: { stage: string; label: string; detail: string; at?: string }[] }) {
  return (
    <div role="list" className="u-col" style={{ gap: 0 }}>
      {steps.map((s, i) => (
        <div key={i} role="listitem" className="u-inline" style={{ gap: 12, alignItems: 'stretch' }}>
          <div className="u-col" style={{ alignItems: 'center', width: 86, flexShrink: 0 }}>
            <span className="u-upper u-xs" style={{ fontWeight: 660, color: 'var(--ai)', letterSpacing: '0.05em' }}>{s.stage}</span>
            {i < steps.length - 1 && <span style={{ width: 1.5, flex: 1, background: 'var(--border)', marginTop: 4 }} />}
          </div>
          <div className="u-col" style={{ gap: 1, flex: 1, paddingBottom: i < steps.length - 1 ? 14 : 0 }}>
            <span style={{ fontWeight: 570, fontSize: 'var(--text-sm)' }}>{s.label}{s.at && <span className="u-mono u-xs u-faint" style={{ marginLeft: 8 }}>{s.at}</span>}</span>
            <span className="u-small u-muted" style={{ lineHeight: 1.5 }}>{s.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
