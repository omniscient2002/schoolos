/* ============================================================
   AI governance — the human-control boundary. Policy posture
   table, recent AI decisions with "Why" traces, the shield log,
   model routing and AI cost & usage.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Badge, Button, Card, DataTable, PageHead, Section, Stat, useToast } from '../components/ui';
import { AiTraceCard } from '../components/Ai';
import { Sparkline } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtNum, fmtRelative } from '../lib/format';
import type { AiTrace, AuditEntry, PolicyRule } from '../types/domain';

/* ---------- posture helpers ---------- */
type Posture = PolicyRule['posture'];
const POSTURE_TONE: Record<Posture, 'success' | 'warning' | 'danger'> = {
  AUTO: 'success', 'APPROVAL REQUIRED': 'warning', 'HUMAN-ONLY': 'danger',
};
const POSTURE_SHORT: Record<Posture, string> = { AUTO: 'Runs automatically', 'APPROVAL REQUIRED': 'Needs approval', 'HUMAN-ONLY': 'Never without a human' };

/* ---------- screen ---------- */
export default function AiGovernance() {
  const { domain } = useStore();
  const toast = useToast();

  const [openTrace, setOpenTrace] = useState<string | null>(null);
  const [postureFilter, setPostureFilter] = useState<Posture | 'all'>('all');

  const aiPolicies = useMemo(() => seed.policies.filter(p => p.category === 'AI Governance'), []);
  const dist = useMemo(() => {
    const counts = { AUTO: 0, 'APPROVAL REQUIRED': 0, 'HUMAN-ONLY': 0 } as Record<Posture, number>;
    seed.policies.forEach(p => { counts[p.posture] += 1; });
    return counts;
  }, []);

  const boundaryRows = useMemo(() => {
    const rows = [...aiPolicies, ...seed.policies.filter(p => p.category !== 'AI Governance')];
    return rows.filter(p => postureFilter === 'all' || p.posture === postureFilter);
  }, [aiPolicies, postureFilter]);

  const aiAudit = useMemo(() => domain.audit.filter(a => a.aiInvolved), [domain.audit]);
  const representativeTrace = (e: AuditEntry): AiTrace => {
    const posture = seed.policies.find(p => e.policyRef?.startsWith(p.category))?.posture ?? 'APPROVAL REQUIRED';
    return {
      trigger: e.reason ? `${e.action} — ${e.reason}` : e.action,
      policy: e.policyRef ?? 'Constitution v2026.1 · role-scoped access',
      dataUsed: ['role-scoped records'],
      reasoningRole: 'Investigator (read-only) → Proposer (drafts only)',
      action: e.action,
      approvalStatus: posture === 'HUMAN-ONLY'
        ? 'Blocked from execution — human decides'
        : posture === 'APPROVAL REQUIRED'
          ? 'Awaiting named human approver'
          : 'Auto-executed within policy whitelist',
      verification: 'Every number recomputed from source records; the entry links to them',
      model: 'Fast (classification) · ap-south-1',
      latencyMs: 380,
      tokens: 620,
      cost: '₹0.04',
    };
  };

  const shield = [
    { what: 'Bulk SMS to all parents without approval', policy: 'Communication §2.1', when: '3d ago' },
    { what: 'Exam eligibility change for a fee-defaulter student', policy: 'Fees §5.1 (HUMAN-ONLY)', when: '5d ago' },
    { what: 'Fee waiver above the 10% sibling cap without principal', policy: 'Fees §4.2', when: '6d ago' },
    { what: 'Attendance overwrite attempt for an absent student', policy: 'Attendance §1.1', when: '1w ago' },
    { what: 'After-hours bulk message during quiet hours', policy: 'Communication §1.2', when: '1w ago' },
    { what: 'Cross-campus data access outside role scope', policy: 'Privacy §1.3', when: '2w ago' },
    { what: 'Grading submission without the class teacher', policy: 'AI Governance §1.1', when: '2w ago' },
    { what: 'Decision proposal on a safeguarding note', policy: 'Safeguarding §2.1 (HUMAN-ONLY)', when: '3w ago' },
  ];

  return (
    <>
      <PageHead
        title="AI rules & control"
        sub="Where the AI may act on its own, where it must wait for a human, and where it never goes."
        actions={<Badge tone="ai" dot>Constitution v2026.1</Badge>}
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="AI actions this month" value={fmtNum(1284)} sub="Across all campuses and roles" />
        <Stat label="Auto-executed" value={fmtNum(1102)} sub="86% — inside policy whitelists" />
        <Stat label="Approval-required" value="174" sub="Waiting on a named human approver" />
        <Stat label="Human-only blocks" value="8" sub="Shield stopped the proposal entirely" />
      </div>

      {/* ---------- human-control boundary ---------- */}
      <Section
        title="Where humans stay in charge"
        sub={`All ${seed.policies.length} AI rules, with the AI Governance category first. AI acts automatically for ${dist.AUTO}, with approval for ${dist['APPROVAL REQUIRED']}, and never without a human for ${dist['HUMAN-ONLY']}.`}
        actions={
          <select className="select" style={{ width: 190 }} value={postureFilter} onChange={e => setPostureFilter(e.target.value as Posture | 'all')} aria-label="Filter by AI rule">
            <option value="all">All AI rules</option>
            <option value="AUTO">AUTO only</option>
            <option value="APPROVAL REQUIRED">APPROVAL only</option>
            <option value="HUMAN-ONLY">HUMAN-ONLY only</option>
          </select>
        }
        style={{ marginBottom: 4 }}
      >
        <DataTable
          columns={[
            { key: 'title', label: 'Policy', render: r => (
              <span className="u-col" style={{ gap: 2 }}>
                <span style={{ fontWeight: 580 }}>{r.title}</span>
                <span className="u-xs u-faint">{r.category} · {r.version} · {r.owner}</span>
              </span>
            ) },
            { key: 'posture', label: 'AI acts', width: 150, render: r => <Badge tone={POSTURE_TONE[r.posture]} dot>{POSTURE_SHORT[r.posture]}</Badge> },
            { key: 'statement', label: 'Statement', render: r => <span className="u-muted u-clamp2" style={{ maxWidth: 520 }}>{r.statement}</span> },
          ]}
          rows={boundaryRows}
          rowKey={r => r.id}
        />
      </Section>

      {/* ---------- recent AI decisions ---------- */}
      <Section title="Recent AI decisions" sub="From the immutable audit trail — every AI action shows what it did, where it acted, and why." style={{ marginBottom: 4 }}>
        <Card pad>
          <div className="u-col">
            {aiAudit.slice(0, 6).map(e => (
              <div key={e.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="u-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                  <div className="u-flex" style={{ gap: 10, minWidth: 0 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--ai-weak)', color: 'var(--ai-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon.Sparkle size={14} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 580 }}>{e.action}</div>
                      <div className="u-small u-muted u-truncate">{e.actor} · {e.recordType} — {e.recordRef}</div>
                    </div>
                  </div>
                  <div className="u-flex" style={{ gap: 8 }}>
                    <Badge tone={e.risk === 'high' ? 'danger' : e.risk === 'medium' ? 'warning' : 'neutral'}>{e.risk} risk</Badge>
                    <Badge tone="outline">{fmtRelative(e.on)}</Badge>
                    <Button size="sm" variant="ghost" iconRight={<Icon.ChevronDown size={13} style={{ transform: openTrace === e.id ? 'rotate(180deg)' : 'none', transition: 'transform var(--t-fast) var(--ease)' }} />} onClick={() => setOpenTrace(o => (o === e.id ? null : e.id))} aria-expanded={openTrace === e.id}>
                      Why
                    </Button>
                  </div>
                </div>
                {openTrace === e.id && (
                  <div style={{ marginTop: 10 }}>
                    <AiTraceCard trace={representativeTrace(e)} defaultOpen compact />
                  </div>
                )}
                <div className="u-small u-muted" style={{ marginTop: 6, paddingLeft: 40 }}>Outcome: {e.outcome}</div>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* ---------- shield + cost ---------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1.3 1 380px', minWidth: 0 }}>
          <Card head={<>Shield events <span className="u-xs u-faint" style={{ marginLeft: 6 }}>this month · 8</span></>}>
            <div className="u-col">
              {shield.map((s, i) => (
                <div key={i} className="u-flex" style={{ gap: 10, padding: '9px 0', borderBottom: i < shield.length - 1 ? '1px solid var(--border-subtle)' : undefined }}>
                  <span style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--danger-weak)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon.Shield size={13} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 560, fontSize: 'var(--text-md)' }}>{s.what}</div>
                    <div className="u-xs u-faint">Blocked · {s.policy} · {s.when}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div style={{ flex: '1 1 320px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card head="AI cost & usage" actions={<Link to="/ai-usage" className="u-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minHeight: 32, padding: '0 4px' }}>Full breakdown <Icon.ArrowRight size={12} /></Link>}>
            <div className="u-col" style={{ gap: 10 }}>
              <div className="u-between">
                <div>
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 650, letterSpacing: '-0.02em' }}>₹{fmtNum(seed.aiUsage.monthSpend)}</div>
                  <div className="u-small u-muted">Month spend vs ₹{fmtNum(seed.aiUsage.budget)} budget ({Math.round((seed.aiUsage.monthSpend / seed.aiUsage.budget) * 100)}%)</div>
                </div>
                <Sparkline points={seed.aiUsage.days.map(d => d.cost)} width={110} height={34} />
              </div>
              <Button size="sm" variant="secondary" icon={<Icon.Insights size={13} />} onClick={() => toast({ title: 'Cost anomaly check ran clean', sub: 'No feature exceeded its daily envelope in 14 days.', tone: 'info' })}>
                Check anomalies
              </Button>
            </div>
          </Card>

          <Card head="Model routing">
            <div className="u-col">
              {seed.models.map((m, i) => (
                <div key={m.name} style={{ padding: '9px 0', borderBottom: i < seed.models.length - 1 ? '1px solid var(--border-subtle)' : undefined }}>
                  <div className="u-between" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 580 }}>{m.name}</span>
                    <span className="u-xs u-faint mono">{m.cost}</span>
                  </div>
                  <div className="u-small u-muted">{m.usedFor}</div>
                  <div className="u-xs u-faint" style={{ marginTop: 2 }}>{m.posture} · {m.region}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
