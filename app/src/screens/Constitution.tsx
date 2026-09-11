/* ============================================================
   Constitution — the three-layer policy manager.
   Platform floor · regulatory pack · school constitution.
   ============================================================ */
import { useMemo, useState } from 'react';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Badge, Button, Card, Empty, Modal, PageHead, Section, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate } from '../lib/format';
import type { PolicyRule } from '../types/domain';

const CATEGORIES = ['Attendance', 'Fees', 'Communication', 'Approvals', 'Safeguarding', 'Transport', 'Privacy', 'AI Governance'];
const POSTURES: PolicyRule['posture'][] = ['AUTO', 'APPROVAL REQUIRED', 'HUMAN-ONLY'];

/* Clause labels pinned to the narrative (Fees §4.2 = sibling cap,
   Transport §3.1 = delay notification, …); derived otherwise. */
const POLICY_REF: Record<string, string> = {
  pol_1: 'Attendance §1.1',
  pol_2: 'Attendance §1.4',
  pol_3: 'Fees §4.3',
  pol_4: 'Fees §4.2',
  pol_5: 'Fees §4.7',
  pol_6: 'Communication §2.4',
  pol_7: 'Communication §2.1',
  pol_8: 'Approvals §1.2',
  pol_9: 'Approvals §1.4',
  pol_10: 'Safeguarding §1.1',
  pol_11: 'Transport §3.1',
  pol_12: 'Privacy §1.2',
  pol_13: 'AI Governance §2.1',
  pol_14: 'AI Governance §2.2',
};

const postureTone = (p: PolicyRule['posture']): 'success' | 'warning' | 'danger' =>
  p === 'AUTO' ? 'success' : p === 'APPROVAL REQUIRED' ? 'warning' : 'danger';

function bumpMinor(version: string): string {
  const m = version.match(/v(\d+)\.(\d+)/);
  if (!m) return version;
  return `v${m[1]}.${Number(m[2]) + 1}`;
}

function versionPath(version: string): string[] {
  const m = version.match(/v(\d+)\.(\d+)/);
  if (!m) return [version];
  const major = Number(m[1]);
  const out: string[] = [];
  for (let i = 1; i <= major; i++) out.push(`v${i}.0`);
  out[out.length - 1] = version;
  return out;
}

export default function Constitution() {
  const { session, dispatch, actorName } = useStore();
  const toast = useToast();

  const [local, setLocal] = useState<PolicyRule[]>(() => seed.policies.map(p => ({ ...p })));
  const [edited, setEdited] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cat, setCat] = useState<string>('All');
  const [posture, setPosture] = useState<string>('All');
  const [editId, setEditId] = useState<string | null>(null);
  const [editStatement, setEditStatement] = useState('');
  const [editPosture, setEditPosture] = useState<PolicyRule['posture']>('AUTO');

  const refOf = (p: PolicyRule) => POLICY_REF[p.id] ?? `${p.category} §${CATEGORIES.indexOf(p.category) + 1}.${p.id.replace('pol_', '')}`;
  const isFloor = (p: PolicyRule) => (p.details ?? []).some(d => d.startsWith('Platform-invariant'));

  const filtered = useMemo(
    () => local.filter(p => (cat === 'All' || p.category === cat) && (posture === 'All' || p.posture === posture)),
    [local, cat, posture],
  );

  const autoCount = local.filter(p => p.posture === 'AUTO').length;
  const approvalCount = local.filter(p => p.posture === 'APPROVAL REQUIRED').length;
  const humanCount = local.filter(p => p.posture === 'HUMAN-ONLY').length;
  const lastAmended = local.reduce((a, p) => (p.effectiveFrom > a ? p.effectiveFrom : a), local[0]?.effectiveFrom ?? new Date());

  const startEdit = (p: PolicyRule) => {
    setEditId(p.id);
    setEditStatement(p.statement);
    setEditPosture(p.posture);
  };

  const saveEdit = () => {
    const p = local.find(x => x.id === editId);
    if (!p || !editStatement.trim()) return;
    const version = bumpMinor(p.version);
    setLocal(arr => arr.map(x => (x.id === editId ? { ...x, statement: editStatement.trim(), posture: editPosture, version } : x)));
    setEdited(e => ({ ...e, [p.id]: true }));
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Updated constitution entry',
        recordType: 'Policy', recordRef: `${refOf(p)} — ${p.title}`,
        reason: 'Draft edit saved from Constitution page', policyRef: refOf(p),
        aiInvolved: false, risk: 'medium',
        outcome: `Draft version ${version} saved in this workspace — resets on reload (server policy store read-only today)`,
      },
    });
    toast({
      title: 'Draft saved in this workspace',
      sub: `${refOf(p)} · ${p.title} → ${version}. Resets when you leave the page — the server policy store is read-only today (versioning door pending).`,
      tone: 'success',
    });
    setEditId(null);
  };

  const editing = local.find(p => p.id === editId) ?? null;

  return (
    <>
      <PageHead
        title="School policies"
        sub={session.roleId === 'itadmin'
          ? 'Reference policy set. The server policy store is read-only today — edits here are workspace drafts (resets on reload) with a local audit note.'
          : 'The rules every automation is designed against; runtime enforcement rolls out with the workflow runtime.'}
      />

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <Card>
          <div className="u-flex" style={{ gap: 8, marginBottom: 6 }}>
            <Icon.Lock size={15} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 620 }}>1 · Platform floor</span>
          </div>
          <div className="u-small u-muted">Set by SchoolOS. Applies to every school on the platform and cannot be edited — including by owners.</div>
        </Card>
        <Card>
          <div className="u-flex" style={{ gap: 8, marginBottom: 6 }}>
            <Icon.Shield size={15} style={{ color: 'var(--info)' }} />
            <span style={{ fontWeight: 620 }}>2 · Regulatory pack</span>
          </div>
          <div className="u-small u-muted">CBSE, IGCSE and data-protection baselines. Updated centrally; schools may tighten, never loosen.</div>
        </Card>
        <Card>
          <div className="u-flex" style={{ gap: 8, marginBottom: 6 }}>
            <Icon.Scale size={15} style={{ color: 'var(--ai)' }} />
            <span style={{ fontWeight: 620 }}>3 · School constitution</span>
          </div>
          <div className="u-small u-muted">Meridian's own rules. Edited here by the Principal; every change is versioned and audit-logged.</div>
        </Card>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 22 }}>
        <Stat label="Constitution entries" value={local.length} sub={`across ${new Set(local.map(p => p.category)).size} categories`} />
        <Stat label="AI acts" value={`${autoCount} / ${approvalCount} / ${humanCount}`} sub="AI acts: automatically / with approval / never without a human" />
        <Stat label="Last amended" value={fmtDate(lastAmended)} sub={edited && Object.keys(edited).length ? 'draft edits are undated until server versioning exists' : 'most recent effective date'} />
        <Stat label="Platform invariants" value={local.filter(isFloor).length} sub="locked for every school" />
      </div>

      <Section title="Filters" sub="Narrow the constitution by category and enforcement posture.">
        <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {['All', ...CATEGORIES].map(c => (
            <button
              key={c}
              className={`u-xs ${cat === c ? 'u-bold' : ''}`}
              style={{
                border: '1px solid ' + (cat === c ? 'var(--accent)' : 'var(--border)'),
                borderRadius: 999, padding: '4px 11px', cursor: 'pointer', minHeight: 32, display: 'inline-flex', alignItems: 'center',
                background: cat === c ? 'var(--accent-weak)' : 'var(--surface)', color: cat === c ? 'var(--accent-text)' : 'var(--text-2)',
              }}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
          <div style={{ width: 12 }} />
          <select className="select" style={{ width: 210 }} value={posture} onChange={e => setPosture(e.target.value)} aria-label="Filter by AI rule">
            <option value="All">All AI rules</option>
            {POSTURES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </Section>

      <Section title={`${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`} sub="Expand an entry for details, version history and the edit draft.">
        {filtered.length === 0 && (
          <Empty icon={<Icon.Scale size={26} />} title="No entries match" sub="Adjust the category or posture filters to see more of the constitution." />
        )}
        <div className="grid grid-2">
          {filtered.map(p => {
            const open = !!expanded[p.id];
            const floor = isFloor(p);
            return (
              <Card key={p.id}>
                <div className="u-between" style={{ gap: 8, marginBottom: 6 }}>
                  <span className="mono u-xs" style={{ color: 'var(--accent-text)', fontWeight: 650 }}>{refOf(p)}</span>
                  <span className="u-flex" style={{ gap: 6 }}>
                    {floor && <Badge tone="outline"><Icon.Lock size={10} style={{ marginRight: 4 }} />platform floor</Badge>}
                    {edited[p.id] && <Badge tone="ai">edited today</Badge>}
                    <Badge tone={postureTone(p.posture)}>{p.posture}</Badge>
                  </span>
                </div>
                <div style={{ fontWeight: 610, marginBottom: 4 }}>{p.title}</div>
                <div className="u-small u-muted" style={{ marginBottom: 8 }}>{p.statement}</div>
                <div className="u-between u-xs u-faint">
                  <span>{p.version} · effective {fmtDate(p.effectiveFrom)}</span>
                  <span>Owner: {p.owner}</span>
                </div>

                <div className="u-flex" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
                  <Button
                    variant="ghost" size="sm"
                    icon={<Icon.ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--t-fast) var(--ease)' }} />}
                    onClick={() => setExpanded(e => ({ ...e, [p.id]: !open }))}
                    aria-expanded={open}
                  >
                    {open ? 'Hide details' : 'Details'}
                  </Button>
                  <div style={{ flex: 1 }} />
                  {floor ? (
                    <Button variant="ghost" size="sm" disabled icon={<Icon.Lock size={12} />}>Edit draft</Button>
                  ) : (
                    <Button variant="secondary" size="sm" icon={<Icon.Edit size={12} />} onClick={() => startEdit(p)}>Edit draft</Button>
                  )}
                </div>

                {open && (
                  <div className="u-col" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)', gap: 10 }}>
                    {(p.details ?? []).length > 0 && (
                      <ul className="u-small u-muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
                        {(p.details ?? []).map(d => <li key={d}>{d}</li>)}
                      </ul>
                    )}
                    <div className="u-flex" style={{ gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="u-xs u-faint" style={{ marginRight: 4 }}>Version history</span>
                      {versionPath(p.version).map((v, i, arr) => (
                        <span key={v} className="u-flex" style={{ gap: 4, alignItems: 'center' }}>
                          <span className="u-xs mono" style={{ fontWeight: i === arr.length - 1 ? 650 : 400, color: i === arr.length - 1 ? 'var(--accent-text)' : 'var(--text-3)' }}>{v}</span>
                          {i < arr.length - 1 && <span style={{ width: 14, height: 1, background: 'var(--border-strong)' }} />}
                        </span>
                      ))}
                    </div>
                    <div className="u-xs u-faint">Status: {p.status} · edits here are workspace drafts (resets on reload) until the server policy store accepts versions.</div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </Section>

      <Section title="What always runs" sub="These invariants are outside every school's control — by design.">
        <Card>
          <div className="u-flex" style={{ gap: 9, marginBottom: 8 }}>
            <Icon.Lock size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
            <div className="u-small" style={{ fontWeight: 600 }}>The platform renders these entries read-only for every role, including owners and IT Admins.</div>
          </div>
          <ul className="u-small u-muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>
            <li>No student may be blocked from an exam because of fees — any eligibility decision is human (Fees §4.7).</li>
            <li>Safeguarding matters are HUMAN-ONLY: SchoolOS may assemble evidence, never decide (Safeguarding §1.1).</li>
            <li>A quiet-hours floor of 20:30–07:30 applies to non-emergency parent messages; schools may tighten it, never loosen it (Communication §2.4).</li>
            <li>Every AI read of student data is logged with its policy basis (Privacy §1.2).</li>
          </ul>
        </Card>
      </Section>

      <Modal
        open={!!editing}
        onClose={() => setEditId(null)}
        title="Edit draft — policy entry"
        sub={editing ? `${refOf(editing)} · ${editing.title} — a new version goes live immediately on save.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={13} />} onClick={saveEdit} disabled={!editStatement.trim()}>Save new version</Button>
          </>
        }
      >
        {editing && (
          <div className="u-col" style={{ gap: 12 }}>
            <div>
              <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="pol-statement">Statement</label>
              <textarea id="pol-statement" className="textarea" rows={4} value={editStatement} onChange={e => setEditStatement(e.target.value)} style={{ marginTop: 5 }} />
            </div>
            <div>
              <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="pol-posture">Posture</label>
              <select id="pol-posture" className="select" style={{ width: '100%', marginTop: 5 }} value={editPosture} onChange={e => setEditPosture(e.target.value as PolicyRule['posture'])}>
                {POSTURES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <div className="u-xs u-faint" style={{ marginTop: 6 }}>
                Raising a posture to HUMAN-ONLY pauses any automation that currently executes it; lowering one schedules a 7-day grace period.
              </div>
            </div>
            <div className="u-xs u-faint">Current version {editing.version} → next save creates {bumpMinor(editing.version)}.</div>
          </div>
        )}
      </Modal>
    </>
  );
}
