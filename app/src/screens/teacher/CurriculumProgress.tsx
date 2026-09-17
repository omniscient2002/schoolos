/* ============================================================
   CurriculumProgress — P3/A1 · coverage the teacher ticks,
   never types.

   The curriculum tree is seeded by the office (A1). Teachers
   only mark what got covered: one tick on a topic row opens
   the coverage stepper, a save rides POST /curriculum/progress.
   Pacing is plain language: "Geometry is 2 weeks behind plan".
   Topics that were covered but still show weak mastery are
   highlighted as revision needs.

   Doors (frozen §4):
     GET  /curriculum/tree?subject=&grade=
     POST /curriculum/progress {node_id, class_grade, pct, evidence?}
   ============================================================ */
import { useState } from 'react';
import { Badge, Button, Card, Empty, Progress, Section, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDate } from '../../lib/format';
import { useAsync } from './teacherKit';
import { Field, onEnter } from './teacherKit';
import {
  ClassPicker, FilterRow, InsightsPageHead, InsightsRoleGate, InsightsSkeleton,
} from './InsightsShared';
import { getCurriculumTree, saveCurriculumProgress, type CurriculumNode } from '../../services/teacherFixtures';

const CLASSES = ['8-B', '8-A', '7-A'];

const PACING: Record<string, { tone: 'success' | 'warning' | 'danger'; word: string }> = {
  ahead: { tone: 'success', word: 'ahead of plan' },
  on_track: { tone: 'success', word: 'on track' },
  behind: { tone: 'warning', word: 'behind plan' },
};

/* ---------- one topic row ---------- */

function TopicRow({ node, classGrade, onSaved }: {
  node: CurriculumNode; classGrade: string; onSaved: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [pct, setPct] = useState(node.coveredPct);
  const [saving, setSaving] = useState(false);

  const covered = node.coveredPct >= 100;
  const revision = (node.revisionNeed ?? 0) > 0 && node.coveredPct > 0;

  const save = async () => {
    setSaving(true);
    try {
      const r = await saveCurriculumProgress(node.id, classGrade, pct);
      if (r.data) onSaved();
      toast({ title: 'Coverage saved', sub: `${node.topic} — ${pct}% recorded for ${classGrade}.`, tone: 'success' });
      setEditing(false);
    } catch (e) {
      toast({ title: 'Could not save', sub: String(e).replace(/^Error:\s*/, ''), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="u-col" style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div className="u-between" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{node.topic}</span>
            {covered && <Badge tone="success" dot>Covered</Badge>}
            {revision && <Badge tone="warning" dot>Revision needed</Badge>}
          </div>
          <div className="u-xs u-faint" style={{ marginTop: 2 }}>
            {node.coveredAt
              ? <>Last marked {fmtDate(node.coveredAt)}{node.coveredBy ? ` by ${node.coveredBy}` : ''}</>
              : 'Not marked yet'}
            {node.revisionNeed ? <> · {node.revisionNeed} students still shaky on this</> : null}
          </div>
        </div>
        <div className="u-flex" style={{ gap: 10, alignItems: 'center' }}>
          <div style={{ width: 130 }} aria-hidden="true">
            <Progress value={node.coveredPct} tone={node.coveredPct >= 100 ? undefined : node.coveredPct >= 50 ? 'warn' : 'danger'} />
            <div className="u-xs u-faint" style={{ marginTop: 2, textAlign: 'right' }}>{node.coveredPct}%</div>
          </div>
          {!editing ? (
            <Button
              variant={covered ? 'ghost' : 'secondary'} size="sm"
              icon={<Icon.Check size={13} />}
              onClick={() => { setPct(node.coveredPct); setEditing(true); }}
              aria-label={`Mark coverage for ${node.topic}`}
            >
              Tick coverage
            </Button>
          ) : (
            <span className="u-xs u-faint" style={{ width: 96, textAlign: 'right' }}>Marking…</span>
          )}
        </div>
      </div>

      {editing && (
        <div
          className="u-col" style={{ gap: 8, marginTop: 8, padding: 12, border: '1px solid var(--accent-weak-2)', borderRadius: 'var(--r-md)', background: 'var(--accent-weak)' }}
          role="group" aria-label={`Mark coverage for ${node.topic}`}
        >
          <div className="u-flex" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={`How much of “${node.topic}” is covered?`} htmlFor={`cov-${node.id}`} hint="0–100. The office plan tracks pace from these ticks.">
              <input
                id={`cov-${node.id}`} className="input" type="number" min={0} max={100} step={5}
                value={pct} onChange={e => setPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                onKeyDown={onEnter(save)} style={{ width: 110 }} disabled={saving}
              />
            </Field>
            <div className="u-flex" style={{ gap: 6 }}>
              {[25, 50, 75, 100].map(v => (
                <Button key={v} variant={pct === v ? 'primary' : 'secondary'} size="sm" onClick={() => setPct(v)} disabled={saving}>
                  {v === 100 ? 'Done' : `${v}%`}
                </Button>
              ))}
            </div>
          </div>
          <div className="u-flex" style={{ gap: 8 }}>
            <Button variant="primary" size="sm" loading={saving} onClick={save} icon={<Icon.Check size={13} />}>Save coverage</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CurriculumProgress() {
  const [classGrade, setClassGrade] = useState('8-B');
  const state = useAsync(() => getCurriculumTree(classGrade), [classGrade]);
  const data = state.data?.data ?? null;

  const refresh = () => state.retry();

  const coveredCount = data ? data.units.filter(u => u.coveredPct >= 100).length : 0;
  const revisionTopics = data ? data.units.filter(u => (u.revisionNeed ?? 0) > 0 && u.coveredPct > 0) : [];
  const overallPct = data && data.units.length ? Math.round(data.units.reduce((a, u) => a + u.coveredPct, 0) / data.units.length) : 0;

  return (
    <InsightsRoleGate>
      <InsightsPageHead
        title="Curriculum coverage"
        sub="What the class has covered against the term plan — tick what you finished; the office owns the plan itself."
      />

      <FilterRow>
        <ClassPicker label="Class" value={classGrade} options={CLASSES} onChange={setClassGrade} />
      </FilterRow>

      {state.loading ? <InsightsSkeleton rows={4} />
        : state.error ? <Empty icon={<Icon.Alert size={20} />} title="The plan did not load" sub={state.error} action={<Button variant="secondary" onClick={state.retry}>Try again</Button>} />
        : !data || data.units.length === 0 ? (
          <Empty
            icon={<Icon.Layers size={20} />}
            title="No plan for this class yet"
            sub="Curriculum plans are imported by the school office. Once they publish one, topics appear here to tick off."
          />
        ) : (
          <>
            {/* pacing banner — one plain sentence */}
            <Card
              pad style={{ marginBottom: 14, borderLeft: `3px solid var(--${PACING[data.pacing].tone})` }}
            >
              <div className="u-between" style={{ gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Badge tone={PACING[data.pacing].tone} dot>{PACING[data.pacing].word}</Badge>
                    <span className="u-small" style={{ fontWeight: 620 }}>{data.subject} · {classGrade} — {overallPct}% of topics marked covered</span>
                  </div>
                  <p className="u-small u-muted" style={{ margin: '6px 0 0', lineHeight: 1.6 }}>{data.pacingNote}</p>
                </div>
                <div className="u-flex" style={{ gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 650, fontSize: 'var(--text-xl)' }}>{coveredCount}/{data.units.length}</div>
                    <div className="u-xs u-faint">topics fully covered</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 650, fontSize: 'var(--text-xl)', color: revisionTopics.length ? 'var(--warning)' : undefined }}>{revisionTopics.length}</div>
                    <div className="u-xs u-faint">need revision</div>
                  </div>
                </div>
              </div>
            </Card>

            {revisionTopics.length > 0 && (
              <Section title="Revision before moving on" sub="Covered, but mastery says a chunk of the class is still shaky — worth one more round.">
                <Card pad>
                  <div className="u-col" style={{ gap: 8 }}>
                    {revisionTopics.map(n => (
                      <div key={n.id} className="u-flex u-small" style={{ gap: 10 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 4, background: 'var(--warning)', flexShrink: 0, marginTop: 7 }} aria-hidden="true" />
                        <span style={{ color: 'var(--text-2)' }}>
                          <strong>{n.topic}</strong> — {n.revisionNeed} students still shaky (from the latest test + homework).
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              </Section>
            )}

            <Section title="Topics by unit" sub="Tick coverage as you finish — 20 seconds, no typing.">
              <Card pad>
                {['Number sense', 'Algebra', 'Geometry', 'Data handling'].map(unit => {
                  const rows = data.units.filter(u => u.unit === unit);
                  if (!rows.length) return null;
                  return (
                    <div key={unit} style={{ marginTop: 10 }}>
                      <div className="u-upper">{unit}</div>
                      {rows.map(n => <TopicRow key={n.id} node={n} classGrade={classGrade} onSaved={refresh} />)}
                    </div>
                  );
                })}
                <div className="u-xs u-faint" style={{ marginTop: 12, lineHeight: 1.6, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                  Coverage marks are recorded with your name and the date — they are part of the term record. The plan itself is authored
                  by the office; if a topic is missing or wrong, message the academic coordinator.
                </div>
              </Card>
            </Section>
          </>
        )}
    </InsightsRoleGate>
  );
}
