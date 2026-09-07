/* ============================================================
   AI usage & cost — spend vs budget, daily cost and request
   volume, per-feature split, latency, model mix and the
   cost-guardrails note.
   ============================================================ */
import { useMemo } from 'react';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Badge, Card, DataTable, PageHead, Section, Stat } from '../components/ui';
import { BarChart, Donut, LineChart, Sparkline } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtNum } from '../lib/format';

const FEATURE_COLORS = ['var(--accent)', 'var(--ai)', 'var(--info)', 'var(--warning)', 'var(--text-3)'];

export default function AiUsage() {
  const { session } = useStore();
  const isFinanceView = ['finance', 'owner', 'principal'].includes(session.roleId);

  const { days, byFeature, latency, failureRate, monthSpend, budget } = seed.aiUsage;

  const totalRequests = useMemo(() => byFeature.reduce((a, f) => a + f.requests, 0), [byFeature]);
  const totalFeatureCost = useMemo(() => byFeature.reduce((a, f) => a + f.cost, 0), [byFeature]);
  const budgetPct = Math.round((monthSpend / budget) * 100);

  const donutSegments = byFeature.map((f, i) => ({ label: f.label, value: f.cost, color: FEATURE_COLORS[i % FEATURE_COLORS.length] }));
  const barData = byFeature.map((f, i) => ({ label: f.label, value: f.requests, color: FEATURE_COLORS[i % FEATURE_COLORS.length] }));

  return (
    <>
      <PageHead
        title="AI usage & cost"
        sub={isFinanceView
          ? 'Model spend for the group — every rupee mapped to the feature that incurred it.'
          : 'Token and rupee spend across the AI features, with guardrails that keep it predictable.'}
        actions={<Badge tone={budgetPct >= 90 ? 'danger' : budgetPct >= 70 ? 'warning' : 'success'} dot>{budgetPct}% of monthly budget</Badge>}
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Month spend" value={`₹${fmtNum(monthSpend)}`} sub={`Budget ₹${fmtNum(budget)} · ₹${fmtNum(budget - monthSpend)} remaining`} />
        <Stat label="Requests · 30d" value={fmtNum(totalRequests)} sub={`${fmtNum(days.reduce((a, d) => a + d.requests, 0))} in the last 14 days`} />
        <Stat label="Avg latency" value={`${latency.p50}ms`} sub={`p95 ${latency.p95}ms · fast model carries classification`} />
        <Stat label="Failure rate" value={`${failureRate}%`} sub="Retries included · 0 dead-lettered" />
      </div>

      {/* ---------- daily charts ---------- */}
      <Section title="Daily spend & volume" sub="Last 14 school days. Digest batching keeps the overnight lines flat." style={{ marginBottom: 4 }}>
        <div className="grid grid-2">
          <Card head="Cost per day (₹)" pad>
            <LineChart
              series={[{ name: 'Cost', color: 'var(--accent)', points: days.map(d => d.cost) }]}
              labels={days.map(d => d.label)}
              yFormat={v => `₹${fmtNum(Math.round(v))}`}
              area
              height={190}
            />
          </Card>
          <Card head="Requests per day" pad>
            <LineChart
              series={[{ name: 'Requests', color: 'var(--ai)', points: days.map(d => d.requests) }]}
              labels={days.map(d => d.label)}
              yFormat={v => fmtNum(Math.round(v))}
              area
              height={190}
            />
          </Card>
        </div>
      </Section>

      {/* ---------- by feature ---------- */}
      <Section title="Split by feature" sub="Where the budget actually goes — cost on the left, request volume on the right." style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 340px', minWidth: 300 }}>
            <Card head="Cost share" pad>
              <Donut segments={donutSegments} centerLabel={`₹${fmtNum(totalFeatureCost)}`} centerSub="this month" size={148} thickness={16} />
            </Card>
          </div>
          <div style={{ flex: '1 1 340px', minWidth: 300 }}>
            <Card head="Requests by feature" pad>
              <BarChart data={barData} horizontal format={v => fmtNum(v)} height={170} />
            </Card>
          </div>
        </div>
      </Section>

      {/* ---------- per-feature table ---------- */}
      <Section title="Cost per feature" sub="Sorted by spend. Avg cost per request flags anything drifting from its envelope." style={{ marginBottom: 4 }}>
        <DataTable
          columns={[
            { key: 'label', label: 'Feature', render: r => (
              <span className="u-flex" style={{ gap: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: r.color }} />
                <span style={{ fontWeight: 570 }}>{r.label}</span>
              </span>
            ) },
            { key: 'cost', label: 'Cost', align: 'right', render: r => <span className="tnum">₹{fmtNum(r.cost)}</span> },
            { key: 'requests', label: 'Requests', align: 'right', render: r => <span className="tnum">{fmtNum(r.requests)}</span> },
            { key: 'avg', label: 'Avg / request', align: 'right', render: r => <span className="tnum u-muted">₹{(r.cost / r.requests).toFixed(3)}</span> },
            { key: 'share', label: 'Share', align: 'right', width: 170, render: r => (
              <span className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <span className="u-small u-muted tnum" style={{ width: 38, textAlign: 'right' }}>{Math.round((r.cost / totalFeatureCost) * 100)}%</span>
                <span style={{ width: 70 }}><span className="progress" style={{ display: 'block' }}><span style={{ display: 'block', width: `${(r.cost / totalFeatureCost) * 100}%`, height: 6, borderRadius: 999, background: r.color }} /></span></span>
              </span>
            ) },
          ]}
          rows={byFeature.map((f, i) => ({ ...f, color: FEATURE_COLORS[i % FEATURE_COLORS.length] }))}
          rowKey={r => r.label}
        />
      </Section>

      {/* ---------- latency + model mix ---------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
        <div style={{ flex: '1 1 300px', minWidth: 280 }}>
          <Card head="Latency & reliability" pad>
            <div className="u-col" style={{ gap: 12 }}>
              <div className="u-between">
                <div>
                  <div className="u-xs u-faint" style={{ fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' }}>p50 latency</div>
                  <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 650 }} className="tnum">{latency.p50}<span className="u-small u-faint" style={{ fontWeight: 500 }}>ms</span></div>
                </div>
                <div>
                  <div className="u-xs u-faint" style={{ fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' }}>p95 latency</div>
                  <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 650 }} className="tnum">{latency.p95}<span className="u-small u-faint" style={{ fontWeight: 500 }}>ms</span></div>
                </div>
              </div>
              <div className="u-flex" style={{ gap: 10 }}>
                <Sparkline points={days.map(d => d.cost)} width={120} height={30} color="var(--accent)" />
                <span className="u-small u-muted">Latency tracks cost — the fast model absorbs spikes.</span>
              </div>
            </div>
          </Card>
        </div>

        <div style={{ flex: '1.4 1 380px', minWidth: 300 }}>
          <Card head="Model mix">
            <div className="u-col">
              {seed.models.map((m, i) => (
                <div key={m.name} className="u-between" style={{ gap: 10, padding: '10px 0', borderBottom: i < seed.models.length - 1 ? '1px solid var(--border-subtle)' : undefined }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="u-flex" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 580 }}>{m.name}</span>
                      <Badge tone="outline">{m.provider}</Badge>
                    </div>
                    <div className="u-small u-muted u-truncate">{m.usedFor}</div>
                  </div>
                  <span className="u-small tnum" style={{ flexShrink: 0, fontWeight: 600 }}>{m.cost}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ---------- guardrails note ---------- */}
      <div className="card" style={{ marginTop: 16, background: 'var(--accent-weak)', borderColor: 'var(--accent-weak-2)' }}>
        <div style={{ padding: 'var(--s-5)' }}>
          <div className="u-flex" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Icon.Shield size={16} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} />
            <div className="u-small" style={{ lineHeight: 1.65 }}>
              <strong>Cost guardrails</strong> — digests are batched nightly on the batch model, classification runs on the fast
              model, and a hard budget alert fires at <strong>90% of the monthly envelope</strong> before any overage.
              Requests are rate-shaped per feature, so one screen can never spike the bill.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
