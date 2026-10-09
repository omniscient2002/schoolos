/* ============================================================
   Constitution — the three-layer policy manager.
   Platform floor · regulatory pack · school constitution.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { apiGet, apiPost } from '../services/liveApi';
import { Badge, Button, Card, Empty, Modal, PageHead, SampleNote, Section, SkeletonCard, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate } from '../lib/format';
import { statusLabel } from '../lib/labels';
import type { PolicyRule } from '../types/domain';

/* OPP-PRD-12: the school's own policy store is live (GET/POST /policy-documents) — versioned and
   audited. The seed `policies` below remain as the labelled REFERENCE set (platform floor + pack). */
interface PolicyDoc { id: string; ref: string; title: string; category: string; body: string; version: number; updated_at: string }

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
  // OPP-PRD-12: the live school policy store.
  const [live, setLive] = useState<PolicyDoc[] | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [liveEdit, setLiveEdit] = useState<Partial<PolicyDoc> | null>(null);
  const [liveBody, setLiveBody] = useState('');
  const [liveTitle, setLiveTitle] = useState('');
  const [liveBusy, setLiveBusy] = useState(false);
  const loadLive = () => {
    apiGet<{ policies: PolicyDoc[] }>('/policy-documents')
      .then(r => { setLive(r.policies ?? []); setLiveErr(null); })
      .catch(e => { setLive([]); setLiveErr(String(e)); });
  };
  useEffect(loadLive, []);

  const openLiveEdit = (p?: PolicyDoc) => {
    setLiveEdit(p ?? { ref: '', title: '', category: 'school' });
    setLiveTitle(p?.title ?? '');
    setLiveBody(p?.body ?? '');
  };
  const saveLive = async () => {
    if (!liveEdit) return;
    if (!liveTitle.trim() || !liveBody.trim() || !String(liveEdit.ref ?? '').trim()) {
      toast({ title: 'Reference, title and body are required', tone: 'error' }); return;
    }
    setLiveBusy(true);
    try {
      await apiPost('/policy-documents', { ref: liveEdit.ref, title: liveTitle.trim(), category: liveEdit.category ?? 'school', body: liveBody.trim() });
      toast({ title: 'Policy saved — a new version is live', tone: 'success' });
      setLiveEdit(null);
      loadLive();
    } catch (e) {
      toast({ title: 'Could not save the policy', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setLiveBusy(false); }
  };

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
        actor: actorName, actorRole: session.roleId, action: 'Updated school policy entry',
        recordType: 'Policy', recordRef: `${refOf(p)} — ${p.title}`,
        reason: 'Draft edit saved from School policy page', policyRef: refOf(p),
        aiInvolved: false, risk: 'medium',
        outcome: `Reference-set draft ${version} saved in this workspace (the illustrative reference set is not persisted)`,
      },
    });
    toast({
      title: 'Reference draft saved in this workspace',
      sub: `${refOf(p)} · ${p.title} → ${version}. This is the illustrative reference set — your own rules live in the School policy section above.`,
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
          ? 'Your school policy is saved, versioned and audited on the server; the reference set below is illustrative.'
          : 'The rules every automation is designed against. Your own rules are saved, versioned and audited; the reference set below is illustrative.'}
      />

      <SampleNote>Sample policies — the reference set below is illustrative in this build. Your own school policy (top of this page) is stored live, versioned and audited.</SampleNote>

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <Card>
          <div className="u-flex" style={{ gap: 8, marginBottom: 6 }}>
            <Icon.Lock size={15} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 620 }}>1 · Platform rules</span>
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
            <span style={{ fontWeight: 620 }}>3 · School policy</span>
          </div>
          <div className="u-small u-muted">Meridian's own rules. Saved, versioned and audit-logged on the server; edit them below.</div>
        </Card>
      </div>

      {/* OPP-PRD-12 · the live school constitution */}
      <Section
        title="School policy"
        sub="Your own rules — each save creates a new version and writes an audit entry."
        style={{ marginBottom: 4 }}
      >
        {live === null ? <SkeletonCard lines={3} /> : (
          <Card pad>
            {liveErr ? <div className="u-small u-muted">Could not load the policy store — {liveErr}</div> : live.length === 0 ? (
              <Empty icon={<Icon.Scale size={22} />} title="No school policies yet" sub="Add your first rule — it is versioned and audited from the moment you save."
                action={<Button variant="secondary" onClick={() => openLiveEdit()}>Add a policy</Button>} />
            ) : (
              <div className="u-col" style={{ gap: 10 }}>
                {live.map(p => (
                  <div key={p.id} className="u-between u-wrap" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="mono u-xs" style={{ color: 'var(--accent-text)', fontWeight: 650 }}>{p.ref}</span>
                        <Badge tone="outline">{p.category}</Badge>
                        <Badge tone="neutral">v{p.version}</Badge>
                        <span className="u-xs u-faint">updated {fmtDate(new Date(p.updated_at))}</span>
                      </div>
                      <div style={{ fontWeight: 610, marginTop: 3 }}>{p.title}</div>
                      <div className="u-small u-muted">{p.body}</div>
                    </div>
                    <Button variant="secondary" size="sm" icon={<Icon.Edit size={12} />} onClick={() => openLiveEdit(p)}>Edit</Button>
                  </div>
                ))}
                <div><Button variant="ghost" size="sm" icon={<Icon.Check size={12} />} onClick={() => openLiveEdit()}>Add a policy</Button></div>
              </div>
            )}
          </Card>
        )}
      </Section>

      <div className="grid grid-4" style={{ marginBottom: 22 }}>
        <Stat label="Policy entries" value={local.length} sub={`across ${new Set(local.map(p => p.category)).size} categories`} />
        <Stat label="AI acts" value={`${autoCount} / ${approvalCount} / ${humanCount}`} sub="AI acts: automatically / with approval / never without a human" />
        <Stat label="Last amended" value={fmtDate(lastAmended)} sub={edited && Object.keys(edited).length ? 'draft edits are undated until server versioning exists' : 'most recent effective date'} />
        <Stat label="Platform rules" value={local.filter(isFloor).length} sub="locked for every school" />
      </div>

      <Section title="Filters" sub="Narrow school policy by category and enforcement posture.">
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
            {POSTURES.map(p => <option key={p} value={p}>{statusLabel(p)}</option>)}
          </select>
        </div>
      </Section>

      <Section title={`${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`} sub="Expand an entry for details, version history and the edit draft.">
        {filtered.length === 0 && (
          <Empty icon={<Icon.Scale size={26} />} title="No entries match" sub="Adjust the category or posture filters to see more of school policy." />
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
                    {floor && <Badge tone="outline"><Icon.Lock size={10} style={{ marginRight: 4 }} />platform rule</Badge>}
                    {edited[p.id] && <Badge tone="ai">edited today</Badge>}
                    <Badge tone={postureTone(p.posture)}>{statusLabel(p.posture)}</Badge>
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
                    <div className="u-xs u-faint">Status: {statusLabel(p.status)} · this is the illustrative reference set; your own rules live in the School policy section above.</div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </Section>

      <Section title="What always runs" sub="These platform rules are outside every school's control — by design.">
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
        sub={editing ? `${refOf(editing)} · ${editing.title} — saved as a draft in this workspace; the reference set is not persisted.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={13} />} onClick={saveEdit} disabled={!editStatement.trim()}>Save draft</Button>
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
                {POSTURES.map(p => <option key={p} value={p}>{statusLabel(p)}</option>)}
              </select>
              <div className="u-xs u-faint" style={{ marginTop: 6 }}>
                Raising a posture to HUMAN-ONLY pauses any automation that currently executes it; lowering one schedules a 7-day grace period.
              </div>
            </div>
            <div className="u-xs u-faint">Current version {editing.version} → this draft would become {bumpMinor(editing.version)}.</div>
          </div>
        )}
      </Modal>

      {/* OPP-PRD-12 · edit the live school policy (saved, versioned, audited) */}
      <Modal
        open={!!liveEdit}
        onClose={() => setLiveEdit(null)}
        title={liveEdit?.id ? 'Edit policy — new version' : 'Add a school policy'}
        sub={liveEdit?.id ? `${liveEdit.ref} · currently v${liveEdit.version}. Saving creates a new version.` : 'Give the rule a reference, a title and its text.'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLiveEdit(null)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={13} />} loading={liveBusy} onClick={saveLive}>Save policy</Button>
          </>
        }
      >
        {liveEdit && (
          <div className="u-col" style={{ gap: 12 }}>
            <div>
              <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="live-ref">Reference</label>
              <input id="live-ref" className="input" value={liveEdit.ref ?? ''} disabled={!!liveEdit.id} onChange={e => setLiveEdit(v => ({ ...v, ref: e.target.value }))} placeholder="e.g. Fees §4.2" style={{ marginTop: 5, width: '100%' }} />
            </div>
            <div>
              <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="live-title">Title</label>
              <input id="live-title" className="input" value={liveTitle} onChange={e => setLiveTitle(e.target.value)} placeholder="e.g. Late-fee cap" style={{ marginTop: 5, width: '100%' }} />
            </div>
            <div>
              <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="live-body">Rule</label>
              <textarea id="live-body" className="textarea" rows={4} value={liveBody} onChange={e => setLiveBody(e.target.value)} style={{ marginTop: 5 }} />
            </div>
            <div className="u-xs u-faint">Saving writes an audit entry naming you and the new version.</div>
          </div>
        )}
      </Modal>
    </>
  );
}
