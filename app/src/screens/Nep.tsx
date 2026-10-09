/* ============================================================
   NEP classroom-policy desk — 5+3+3+4 stages, Class-6 third
   language (OASIS R3), bagless/art/skill records, Holistic
   Progress Card inputs + live aggregates, FLN skill levels.

   Doors: GET /nep/profile, PUT /nep/r3, GET/POST /nep/activities,
   POST /nep/hpc, GET /nep/hpc/:id, POST /nep/fln, GET /nep/fln.
   The card is computed, never stored: teacher observations ride
   hpc_inputs; attendance, published exams and homework join live.
   ============================================================ */
import { useEffect, useState } from 'react';
import { PageHead, Card, Badge, Button, DataTable, Empty, ErrorState, Modal, Section, SkeletonCard, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { friendly } from '../lib/friendlyErrors';
import { useRoleOrGrant } from '../lib/access';
import {
  nepProfile, nepSetR3, nepActivities, nepAddActivity, nepSaveHpc, nepHpc, nepSaveFln, nepFlnBoard,
} from '../services/complianceApi';

interface Pupil { id: string; name: string; grade?: string; section?: string }
const FLN = ['oral_language', 'print_awareness', 'phonics', 'fluency', 'comprehension', 'number_sense', 'measurement', 'shapes'];
const LEVELS = ['beginner', 'developing', 'proficient'];

export default function Nep() {
  const toast = useToast();
  const canRead = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator', 'teacher'], ['GET /nep/profile']);
  const canWrite = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator', 'teacher'], ['POST /nep/hpc']);
  const canAdmin = useRoleOrGrant(['owner', 'principal', 'itadmin'], ['POST /nep/hpc']);

  const [profile, setProfile] = useState<{ stages: { grade: string; sections: string[]; stage: string }[]; r3: { language: string; academic_year: string } | null } | null>(null);
  const [acts, setActs] = useState<{ id: string; kind: string; title: string; held_on?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [pupils, setPupils] = useState<Pupil[]>([]);
  const [r3, setR3] = useState({ language: '', year: '2026-27' });
  const [actOpen, setActOpen] = useState(false);
  const [actForm, setActForm] = useState({ kind: 'bagless', title: '', detail: '', heldOn: '' });
  const [busy, setBusy] = useState(false);
  const [hpcPupil, setHpcPupil] = useState('');
  const [hpcTerm, setHpcTerm] = useState('2026-27 T1');
  const [hpc, setHpc] = useState<{ student: Record<string, unknown>; stage: string; inputs: unknown; aggregates: { attendancePct: number | null; examAvg: number | null; homeworkPending: number } } | null>(null);
  const [hpcForm, setHpcForm] = useState({ strengths: '', interests: '', goals: '', teacherRemark: '' });
  const [fln, setFln] = useState<{ skill: string; level: string }[]>([]);
  const [flnForm, setFlnForm] = useState({ skill: 'fluency', level: 'developing' });

  const reload = () => setTick(t => t + 1);
  useEffect(() => {
    if (!canRead) return;
    let dead = false;
    setLoading(true); setError(null);
    Promise.all([nepProfile(), nepActivities()]).then(([p, a]) => {
      if (dead) return;
      setProfile(p); setActs(a.activities ?? []); setLoading(false);
    }).catch(e => { if (!dead) { setError(String(e)); setLoading(false); } });
    import('../services/liveApi').then(({ apiStudents }) => apiStudents({ limit: '500' }))
      .then(r => { if (!dead) setPupils(((r.students ?? []) as Record<string, unknown>[]).map(s => ({ id: String(s.id), name: String(s.name), grade: s.grade == null ? undefined : String(s.grade), section: s.section == null ? undefined : String(s.section) }))); })
      .catch(() => { /* picker degrades */ });
    return () => { dead = true; };
  }, [tick, canRead]);

  const loadHpc = async (pid: string, term: string) => {
    if (!pid) { setHpc(null); setFln([]); return; }
    try {
      const [card, skills] = await Promise.all([
        nepHpc(pid, term).catch(() => null),
        nepFlnBoard({ studentId: pid }).catch(() => ({ skills: [] as { skill: string; level: string }[] })),
      ]);
      setHpc(card);
      setFln(skills.skills ?? []);
      if (card && !Array.isArray(card.inputs) && card.inputs) {
        const c = card.inputs as Record<string, string | null>;
        setHpcForm({ strengths: c.strengths ?? '', interests: c.interests ?? '', goals: c.goals ?? '', teacherRemark: c.teacher_remark ?? '' });
      }
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  const saveR3 = async () => {
    if (!r3.language.trim()) { toast({ title: 'Name the third language', tone: 'info' }); return; }
    setBusy(true);
    try {
      await nepSetR3(r3.language.trim(), r3.year.trim() || '2026-27');
      toast({ title: `Third language: ${r3.language.trim()}`, sub: 'The OASIS R3 source of truth.', tone: 'success' });
      reload();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const saveActivity = async () => {
    if (!actForm.title.trim()) { toast({ title: 'Name the activity', tone: 'info' }); return; }
    setBusy(true);
    try {
      await nepAddActivity({ kind: actForm.kind, title: actForm.title.trim(), ...(actForm.detail.trim() ? { detail: actForm.detail.trim() } : {}), ...(actForm.heldOn ? { heldOn: actForm.heldOn } : {}) });
      toast({ title: 'Activity recorded', tone: 'success' });
      setActForm({ kind: 'bagless', title: '', detail: '', heldOn: '' });
      setActOpen(false);
      reload();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const saveHpc = async () => {
    if (!hpcPupil || !hpcTerm.trim()) { toast({ title: 'Pick a pupil and a term', tone: 'info' }); return; }
    setBusy(true);
    try {
      await nepSaveHpc({ studentId: hpcPupil, term: hpcTerm.trim(), ...(hpcForm.strengths.trim() ? { strengths: hpcForm.strengths.trim() } : {}), ...(hpcForm.interests.trim() ? { interests: hpcForm.interests.trim() } : {}), ...(hpcForm.goals.trim() ? { goals: hpcForm.goals.trim() } : {}), ...(hpcForm.teacherRemark.trim() ? { teacherRemark: hpcForm.teacherRemark.trim() } : {}) });
      toast({ title: 'HPC observations saved', sub: 'The card recomputes from these plus live records.', tone: 'success' });
      await loadHpc(hpcPupil, hpcTerm.trim());
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const saveFln = async () => {
    if (!hpcPupil) { toast({ title: 'Pick a pupil first', tone: 'info' }); return; }
    setBusy(true);
    try {
      await nepSaveFln({ studentId: hpcPupil, skill: flnForm.skill, level: flnForm.level });
      toast({ title: `${flnForm.skill} → ${flnForm.level}`, tone: 'success' });
      await loadHpc(hpcPupil, hpcTerm.trim());
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  if (!canRead) {
    return (
      <Card>
        <Empty icon={<Icon.Shield size={24} />} title="NEP records are not for your role"
          sub="Stages, progress cards and foundational levels live with the school office and class teachers." />
      </Card>
    );
  }

  const byStage = new Map<string, string[]>();
  for (const s of profile?.stages ?? []) {
    if (!byStage.has(s.stage)) byStage.set(s.stage, []);
    byStage.get(s.stage)!.push(s.grade);
  }

  return (
    <div>
      <PageHead title="NEP classroom policy" sub="Stages, the third language, bagless days and art, progress cards and foundational levels — computed from your school's own structure and records." />

      {loading ? <div className="grid grid-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
        : error ? <ErrorState title="Could not read NEP records" sub={friendly(error)} onRetry={reload} />
        : (
          <>
            <div className="grid grid-3" style={{ marginBottom: 20 }}>
              <Stat label="Stages mapped" value={byStage.size} sub="5+3+3+4 from your class names" />
              <Stat label="Third language" value={profile?.r3 ? profile.r3.language : '—'} sub={profile?.r3 ? `${profile.r3.academic_year} · OASIS R3` : 'Not recorded yet'} />
              <Stat label="Activities" value={acts.length} sub="Bagless, art and skill records" />
            </div>

            <Section title="Stages & third language" sub="Stages derive from class names — no separate structure to maintain.">
              <div className="u-col" style={{ gap: 6, marginBottom: 12 }}>
                {[...byStage.entries()].map(([stage, grades]) => (
                  <div key={stage} className="u-flex" style={{ gap: 10, alignItems: 'baseline' }}>
                    <Badge tone="outline">{stage}</Badge>
                    <span className="u-small">{grades.join(', ') || '—'}</span>
                  </div>
                ))}
                {byStage.size === 0 && <div className="u-small u-muted">Define classes first — stages map from class names.</div>}
              </div>
              {canAdmin && (
                <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
                  <label className="u-small">Class-6 third language (R3)
                    <input className="input" value={r3.language} onChange={e => setR3(s => ({ ...s, language: e.target.value }))} placeholder="e.g. Sanskrit" style={{ display: 'block', marginTop: 4, minWidth: 200 }} />
                  </label>
                  <label className="u-small">Year
                    <input className="input" value={r3.year} onChange={e => setR3(s => ({ ...s, year: e.target.value }))} placeholder="2026-27" style={{ display: 'block', marginTop: 4, maxWidth: 130 }} />
                  </label>
                  <Button variant="secondary" disabled={busy} onClick={saveR3}>{busy ? 'Saving…' : 'Record R3'}</Button>
                </div>
              )}
            </Section>

            <Section title="Bagless days, art & skill" sub="NEP activity evidence — what happened, when, for which grades."
              actions={canWrite ? <Button variant="secondary" icon={<Icon.Plus size={14} />} onClick={() => setActOpen(true)}>Record activity</Button> : undefined}>
              {acts.length === 0 ? <Empty title="No activities yet" sub="Bagless days, art-integration projects and skill electives land here." />
                : (
                  <Card pad={false}>
                    <DataTable<{ id: string; kind: string; title: string; held_on?: string | null }>
                      columns={[
                        { key: 'kind', label: '', width: 90, render: a => <Badge tone={a.kind === 'skill' ? 'accent' : 'outline'}>{a.kind}</Badge> },
                        { key: 'title', label: 'Activity', render: a => <span style={{ fontWeight: 570 }}>{a.title}</span> },
                        { key: 'when', label: 'Held', width: 130, render: a => <span className="u-small">{a.held_on ? new Date(a.held_on).toLocaleDateString() : <span className="u-faint">—</span>}</span> },
                      ]}
                      rows={acts}
                      rowKey={a => a.id}
                    />
                  </Card>
                )}
            </Section>

            <Section title="Holistic Progress Card" sub="Teacher observations plus live aggregates — attendance, published exams, open homework. The card computes; nothing here is a stored grade.">
              <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
                <label className="u-small">Pupil
                  <select className="input" value={hpcPupil} onChange={e => { setHpcPupil(e.target.value); void loadHpc(e.target.value, hpcTerm); }} style={{ display: 'block', marginTop: 4, minWidth: 220 }} aria-label="Pupil">
                    <option value="">Choose…</option>
                    {pupils.map(p => <option key={p.id} value={p.id}>{p.name}{p.grade ? ` · ${p.grade}${p.section ? ` ${p.section}` : ''}` : ''}</option>)}
                  </select>
                </label>
                <label className="u-small">Term
                  <input className="input" value={hpcTerm} onChange={e => setHpcTerm(e.target.value)} placeholder="2026-27 T1" style={{ display: 'block', marginTop: 4, maxWidth: 140 }} />
                </label>
                <Button variant="ghost" disabled={!hpcPupil} onClick={() => { void loadHpc(hpcPupil, hpcTerm); }}>Open card</Button>
              </div>
              {hpc && (
                <div className="grid grid-2" style={{ gap: 16, alignItems: 'start', marginBottom: 12 }}>
                  <Card head="This term" pad>
                    <div className="u-col u-small" style={{ gap: 6 }}>
                      <span>Stage: <strong>{hpc.stage}</strong></span>
                      <span>Presence: <strong>{hpc.aggregates.attendancePct == null ? 'no register yet' : `${hpc.aggregates.attendancePct}%`}</strong></span>
                      <span>Published exams: <strong>{hpc.aggregates.examAvg == null ? 'nothing published yet' : `${hpc.aggregates.examAvg}%`}</strong></span>
                      <span>Homework open: <strong>{hpc.aggregates.homeworkPending}</strong></span>
                    </div>
                  </Card>
                  <Card head="Teacher observations" pad>
                    {canWrite ? (
                      <div className="u-col" style={{ gap: 8 }}>
                        {[['strengths', 'Strengths'], ['interests', 'Interests'], ['goals', 'Goals'], ['teacherRemark', 'Remark']].map(([k, l]) => (
                          <label key={k} className="u-xs">{l}
                            <input className="input" style={{ width: '100%', marginTop: 4 }} value={(hpcForm as Record<string, string>)[k] ?? ''}
                              onChange={e => setHpcForm(f => ({ ...f, [k]: e.target.value }))} />
                          </label>
                        ))}
                        <div><Button variant="primary" size="sm" disabled={busy} onClick={saveHpc}>{busy ? 'Saving…' : 'Save observations'}</Button></div>
                      </div>
                    ) : (
                      <div className="u-small u-muted">Observations are written by the pupil's own teachers.</div>
                    )}
                  </Card>
                </div>
              )}
            </Section>

            <Section title="Foundational levels (NIPUN)" sub="Reading and number skills per pupil — beginner, developing, proficient.">
              <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
                <span className="u-small u-muted">Pick the pupil above, then:</span>
                <label className="u-small">Skill
                  <select className="input" value={flnForm.skill} onChange={e => setFlnForm(f => ({ ...f, skill: e.target.value }))} style={{ display: 'block', marginTop: 4 }}>
                    {FLN.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="u-small">Level
                  <select className="input" value={flnForm.level} onChange={e => setFlnForm(f => ({ ...f, level: e.target.value }))} style={{ display: 'block', marginTop: 4 }}>
                    {LEVELS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                {canWrite && <Button variant="secondary" disabled={busy || !hpcPupil} onClick={saveFln}>{busy ? 'Saving…' : 'Record level'}</Button>}
              </div>
              {fln.length > 0 && (
                <div className="u-flex u-gap-2 u-wrap">
                  {fln.map(f => <Badge key={f.skill} tone={f.level === 'proficient' ? 'success' : f.level === 'developing' ? 'warning' : 'outline'}>{f.skill}: {f.level}</Badge>)}
                </div>
              )}
            </Section>
          </>
        )}

      <Modal
        open={actOpen}
        onClose={() => setActOpen(false)}
        title="Record NEP activity"
        sub="Bagless days, art-integration projects, skill electives."
        footer={
          <>
            <Button variant="ghost" onClick={() => setActOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" disabled={busy || !actForm.title.trim()} onClick={saveActivity}>{busy ? 'Recording…' : 'Record it'}</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div>
            <label className="u-xs" htmlFor="nep-kind">Kind</label>
            <select id="nep-kind" className="input" style={{ width: '100%', marginTop: 5 }} value={actForm.kind} onChange={e => setActForm(f => ({ ...f, kind: e.target.value }))}>
              <option value="bagless">Bagless day</option>
              <option value="art">Art integration</option>
              <option value="skill">Skill elective</option>
            </select>
          </div>
          <div>
            <label className="u-xs" htmlFor="nep-title">Title</label>
            <input id="nep-title" className="input" style={{ width: '100%', marginTop: 5 }} value={actForm.title}
              onChange={e => setActForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Pottery morning with a local artisan" />
          </div>
          <div>
            <label className="u-xs" htmlFor="nep-date">Held on (optional)</label>
            <input id="nep-date" className="input" type="date" style={{ width: '100%', marginTop: 5 }} value={actForm.heldOn}
              onChange={e => setActForm(f => ({ ...f, heldOn: e.target.value }))} />
          </div>
          <div>
            <label className="u-xs" htmlFor="nep-detail">Detail (optional)</label>
            <textarea id="nep-detail" className="input" rows={2} style={{ width: '100%', marginTop: 5 }} value={actForm.detail}
              onChange={e => setActForm(f => ({ ...f, detail: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

