/* ============================================================
   InsightsShared.tsx — TU-3 (ui-insights) shared pieces.

   Only insights-lane screens import this. Reuses the TU-2 kit
   (teacherKit.tsx) for the async spine and fixture honesty, and
   adds what is unique to mastery surfaces:

   - A3Evidence: an evidence row — the heart of the A3 rule
     (kind icon, plain value, staleness, expiry note, link out).
   - EvidenceList / EvidenceDrawer: the click-through every
     mastery label owes the teacher.
   - DecayNote: the A3 expiry sentence, always present, never
     implied by the dot alone.
   - Screen states: role mirror, page skeleton, filter row.
   - ROLES: the shared teacher-role allowlist (per lane, so a
     lane editing its own list cannot break another's).
   ============================================================ */
import { useState, type ReactNode } from 'react';
import { Badge, Button, Card, Drawer, Empty, SkeletonCard } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDate } from '../../lib/format';
import { useStore } from '../../state/store';
import { DeniedState, FixtureTag } from './teacherKit';
import {
  MASTERY_LABEL, MASTERY_STYLE, TREND_INFO, evidenceLinkTarget,
  staleness, liveEvidence, type MasteryEvidence, type MasteryTopic,
} from '../../services/teacherFixtures';

/* ---------- role mirror (server still decides; UI degrades kindly) ---------- */
export const INSIGHTS_STAFF_ROLES = ['teacher', 'principal', 'owner', 'coordinator', 'itadmin'];

export function InsightsRoleGate({ children }: { children: ReactNode }) {
  const { session } = useStore();
  if (INSIGHTS_STAFF_ROLES.includes(session.roleId)) return <>{children}</>;
  return <DeniedState role={session.roleId} />;
}

/* ---------- page chrome ---------- */
export function InsightsPageHead({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        <div className="sub">{sub}</div>
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}

export function InsightsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="u-col" style={{ gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => <SkeletonCard key={i} lines={3} />)}
    </div>
  );
}

/* ---------- A3 evidence ---------- */

const EV_ICON: Record<MasteryEvidence['kind'], ReactNode> = {
  assessment: <Icon.Clipboard size={14} />,
  homework: <Icon.Book size={14} />,
  observation: <Icon.Eye size={14} />,
  intervention: <Icon.Heart size={14} />,
};

const EV_KIND_LABEL: Record<MasteryEvidence['kind'], string> = {
  assessment: 'Test', homework: 'Homework', observation: 'Observation', intervention: 'Support',
};

/** One evidence row — the A3 heart: what, what it showed, when, till when, link out. */
export function A3Evidence({ ev }: { ev: MasteryEvidence }) {
  const st = staleness(ev.observedAt);
  return (
    <div className="u-col" style={{ gap: 3, padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}>
      <div className="u-flex u-xs" style={{ gap: 6, alignItems: 'center', color: 'var(--text-3)' }}>
        {EV_ICON[ev.kind]}
        <span style={{ fontWeight: 620 }}>{EV_KIND_LABEL[ev.kind]}</span>
        <span aria-hidden="true">·</span>
        <span className={st.expired ? 'u-faint' : ''}>{st.label}</span>
      </div>
      <div className="u-small" style={{ lineHeight: 1.5 }}>{ev.title} — <span style={{ color: 'var(--text-2)' }}>{ev.value}</span></div>
      <div className="u-flex u-between u-xs" style={{ gap: 8 }}>
        <span className={st.expired ? 'u-faint' : 'u-muted'}>
          {st.expired ? `Too old to count — from ${fmtDate(ev.observedAt)}` : `Counts till ${fmtDate(ev.expiresAt)}`}
        </span>
        <a href={evidenceLinkTarget(ev.link).to} className="u-xs" style={{ color: 'var(--accent-text)', fontWeight: 600, whiteSpace: 'nowrap' }} onClick={e => e.preventDefault()}>
          {evidenceLinkTarget(ev.link).label}
        </a>
      </div>
    </div>
  );
}

export function EvidenceList({ topic, compact }: { topic: MasteryTopic; compact?: boolean }) {
  const rows = compact ? liveEvidence(topic) : topic.evidence;
  if (!rows.length) {
    return (
      <Empty
        icon={<Icon.Search size={18} />}
        title="No evidence yet"
        sub="Nothing recorded for this topic so far. Marks, homework reviews and class observations will appear here."
      />
    );
  }
  return <div className="u-col" style={{ gap: 8 }}>{rows.map(ev => <A3Evidence key={ev.id} ev={ev} />)}</div>;
}

/** The click-through every mastery label owes — a drawer of evidence. */
export function EvidenceDrawer({ topic, onClose }: { topic: MasteryTopic | null; onClose: () => void }) {
  const live = topic ? liveEvidence(topic) : [];
  const expired = topic ? topic.evidence.filter(e => staleness(e.observedAt).expired) : [];
  return (
    <Drawer
      open={topic !== null}
      onClose={onClose}
      title={topic ? `${topic.topic} — ${MASTERY_LABEL[topic.level]}` : ''}
      sub={topic ? `${topic.unit} · ${topic.confidence}% sure · ${TREND_INFO[topic.trend].label}` : undefined}
    >
      {topic && (
        <div className="u-col" style={{ gap: 14 }}>
          <p className="u-small u-muted" style={{ margin: 0, lineHeight: 1.6 }}>
            {MASTERY_STYLE[topic.level].dot} <strong>{MASTERY_LABEL[topic.level]}</strong> — this label comes only from the evidence below.
            Each piece counts for 4 weeks; after that the label drops to “developing” until fresh work arrives.
          </p>
          <div>
            <div className="u-upper" style={{ marginBottom: 6 }}>Current evidence ({live.length})</div>
            <EvidenceList topic={{ ...topic, evidence: live }} />
          </div>
          {expired.length > 0 && (
            <div>
              <div className="u-upper" style={{ marginBottom: 6 }}>Too old to count ({expired.length})</div>
              <div className="u-col" style={{ gap: 8 }}>{expired.map(ev => <A3Evidence key={ev.id} ev={ev} />)}</div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** The A3 decay sentence — shown wherever a level dot appears. */
export function DecayNote({ topic }: { topic: MasteryTopic }) {
  const live = liveEvidence(topic);
  if (!live.length) {
    return (
      <div className="u-xs u-faint" style={{ marginTop: 4 }}>
        Last check was over 4 weeks ago — this label is waiting for fresh work.
      </div>
    );
  }
  return <div className="u-xs u-faint" style={{ marginTop: 4 }}>Based on work from {staleness(live[0].observedAt).label}</div>;
}

/* ---------- mastery chip (dot + word + confidence + trend, keyboard-open) ---------- */
export function MasteryChip({ topic, onOpen }: { topic: MasteryTopic; onOpen?: () => void }) {
  const s = MASTERY_STYLE[topic.level];
  const t = TREND_INFO[topic.trend];
  const body = (
    <>
      <span aria-hidden="true">{s.dot}</span>
      <span>{MASTERY_LABEL[topic.level]}</span>
      <span className="u-faint" aria-hidden="true">·</span>
      <span className="u-faint" style={{ color: t.color }} title={t.label}>{t.glyph}</span>
    </>
  );
  if (!onOpen) return <span className="u-small u-flex" style={{ gap: 5, alignItems: 'center' }}>{body}</span>;
  return (
    <button
      className="btn btn-ghost btn-sm"
      style={{ padding: '3px 8px', background: 'transparent', border: 0, cursor: 'pointer' }}
      onClick={onOpen}
      aria-label={`${topic.topic}: ${MASTERY_LABEL[topic.level]}, ${topic.confidence}% sure, ${t.label}. Show the evidence.`}
    >
      {body}
    </button>
  );
}

/* ---------- confidence badge ---------- */
export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const tone = confidence >= 70 ? 'success' : confidence >= 45 ? 'warning' : 'danger';
  const word = confidence >= 70 ? 'Solid evidence' : confidence >= 45 ? 'Some evidence' : 'Thin evidence';
  return <Badge tone={tone} dot>{word} · {confidence}%</Badge>;
}

/* ---------- class / subject filter row (shared look) ---------- */
export function FilterRow({ children }: { children: ReactNode }) {
  return <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>{children}</div>;
}

export function ClassPicker({ value, options, onChange, label }: {
  value: string; options: string[]; onChange: (v: string) => void; label: string;
}) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label htmlFor={label}>{label}</label>
      <select id={label} className="input" value={value} onChange={e => onChange(e.target.value)} style={{ width: 'auto', minWidth: 120 }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/* ---------- small summary card used across insights screens ---------- */
export function MiniStat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <Card pad>
      <div className="u-xs u-upper">{label}</div>
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 650, color: tone ? `var(--${tone})` : undefined }}>{value}</div>
      {sub && <div className="u-xs u-muted" style={{ marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

/* ---------- refresh-with-source tag (fixture honesty) ---------- */
export function InsightsFixtureTag({ source, onRetry }: { source: 'live' | 'fixture'; onRetry?: () => void }) {
  return (
    <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
      <FixtureTag source={source} />
      {onRetry && (
        <Button variant="ghost" size="sm" icon={<Icon.Refresh size={13} />} onClick={onRetry}>Refresh</Button>
      )}
    </div>
  );
}
