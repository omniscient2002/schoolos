/* ============================================================
   FeePlans — Wave-2 finance invoicing UI (L4-2.1).
   Reads/writes the L1-2.2 doors:
     GET  /fee-plans
     POST /fee-plans               (template: grade-set × terms × amount)
     POST /fee-plans/:id/generate  (bulk-insert obligations, single tx)
   Generation is one honest server call — the screen quotes exactly the
   counts the server returns (inserted / skipped / students). Nothing is
   computed or pretended client-side. If the doors are not live yet the
   screen says so instead of inventing data. Voiding lives on the Fees
   ledger (owner-only, confirm modal) where the obligation rows are.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { apiFeePlans, apiCreateFeePlan, apiGenerateFeePlan, apiVoidBillingRun, apiFeeHeads, type FeePlan, type FeePlanTerm } from '../../services/liveApi';
import { friendly } from '../../lib/friendlyErrors';
import { useRoleOrGrant } from '../../lib/access';
import { apiSchoolClasses } from '../../services/onboardingApi';
import {
  PageHead, Card, Badge, Button, Empty, Modal, Stat, useToast, SkeletonCard, ErrorState,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDate } from '../../lib/format';

/* door canon: grades are grade-name strings (students.grade domain) */
/* GRADE-1: the grade scope of a fee plan must be the SCHOOL'S OWN classes, read from
   GET /school/classes — the same list the Classes & sections screen writes and every
   other class picker in the app reads. This constant hard-coded 1..10, so a school that
   named its classes "Grade 1".."Grade 8" (or UKG, or Class VIII) could not select ANY
   grade: every generated obligation silently matched zero students. */
const FALLBACK_GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

const rupeesToCents = (v: string) => {
  const n = Number.parseFloat(v.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};
const centsToRupees = (c: number) => (c / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/* local async hook — same pattern as the other owned screens */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: String(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

const emptyTerm = (): FeePlanTerm & { amountRupees: string; dueOn: string } => ({ term: 'Term 1', label: '', amount_cents: 0, amountRupees: '', dueOn: '' });

export default function FeePlans() {
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [genPlan, setGenPlan] = useState<FeePlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null); /* D7: the run just generated, voidable */
  /* the school's own classes, for the grade scope picker */
  const [schoolGrades, setSchoolGrades] = useState<string[] | null>(null);
  useEffect(() => {
    let dead = false;
    apiSchoolClasses()
      .then((r) => { if (!dead) setSchoolGrades((r.classes ?? []).map((c) => c.grade).filter(Boolean)); })
      .catch(() => { if (!dead) setSchoolGrades([]); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const GRADES = schoolGrades?.length ? schoolGrades : FALLBACK_GRADES;

  /* FEE-RBAC-2: plan authority mirrors the DOORS — a built-in role in the gate OR the caller's own
     custom-role mask explicitly ALLOWing the create/generate doors. */
  /* FEE-1: this list omitted finance_head and finance_clerk, which the server DOES
     allow on POST /fee-plans and POST /fee-plans/:id/generate
     (require('owner','principal','finance','finance_head','finance_clerk')). The effect
     was that a school's Finance head — the person whose whole job this is — saw a
     DISABLED "New plan" button captioned "Fee plans are managed by finance, the
     principal or the owner — your role can view them", and only the owner could build
     the fee structure. Read the list off the doors, not a hand copy. */
  const canManage = useRoleOrGrant(
    ['owner', 'principal', 'finance', 'finance_head', 'finance_clerk'],
    ['POST /fee-plans', 'POST /fee-plans/:id/generate'],
  );

  const [form, setForm] = useState({
    name: '',
    category: 'Tuition',
    feeHeadId: '',
    grades: [] as string[],
    terms: [emptyTerm()],
    installmentCount: 0,
    hikePct: '',
    consultationMeetingId: '',
  });
  /* SMC consultations to cite: a rise above 10% must name the meeting that approved it. */
  const [meetings, setMeetings] = useState<{ id: string; kind: string; held_on: string }[]>([]);
  useEffect(() => {
    import('../../services/complianceApi').then(({ meetingsList }) => meetingsList('SMC')
      .then(r => setMeetings(r.meetings ?? [])).catch(() => setMeetings([])));
  }, []);

  const plans = useAsync(async () => {
    const res = await apiFeePlans();
    return res.feePlans ?? [];
  }, []);

  const heads = useAsync(async () => {
    const res = await apiFeeHeads();
    return res.feeHeads ?? [];
  }, []);

  const doorMissing = useMemo(
    () => !!plans.error && /404|not found|cannot (GET|POST)|failed to fetch|networkerror/i.test(plans.error),
    [plans.error],
  );

  const totals = useMemo(() => {
    const list = plans.data ?? [];
    const perStudent = (p: FeePlan) => p.terms?.reduce((a, t) => a + (t.amount_cents ?? 0), 0) ?? 0;
    return {
      count: list.length,
      maxPerStudent: list.length ? Math.max(...list.map(perStudent)) : 0,
      gradeSet: new Set(list.flatMap(p => p.grades ?? [])).size,
    };
  }, [plans.data]);

  const formValid = useMemo(() =>
    form.name.trim().length > 1 &&
    form.grades.length > 0 &&
    form.terms.some(t => t.term.trim() && t.label.trim() && t.amount_cents > 0),
  [form]);

  const toggleGrade = (g: string) =>
    setForm(f => ({ ...f, grades: f.grades.includes(g) ? f.grades.filter(x => x !== g) : [...f.grades, g].sort((a, b) => Number(a) - Number(b)) }));

  const createPlan = async () => {
    if (!formValid) return;
    setSaving(true);
    try {
      const terms: FeePlanTerm[] = form.terms
        .filter(t => t.term.trim() && t.label.trim() && t.amount_cents > 0)
        .map((t, i) => ({ term: t.term.trim() || `Term ${i + 1}`, label: t.label.trim(), amount_cents: t.amount_cents, ...(t.dueOn ? { due_on: t.dueOn } : {}) }));
      // FEE-DAT-5b: an installment schedule splits the obligation at generation. Equal parts, no amounts.
      const installments = form.installmentCount > 1
        ? Array.from({ length: form.installmentCount }, () => ({}))
        : undefined;
      const res = await apiCreateFeePlan({
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        grades: form.grades,
        terms,
        feeHeadId: form.feeHeadId || undefined,
        installments,
        ...(form.hikePct.trim() !== '' ? { hikePct: Number(form.hikePct) } : {}),
        ...(form.consultationMeetingId ? { consultationMeetingId: form.consultationMeetingId } : {}),
      });
      toast({
        title: `Plan “${res.feePlan?.name ?? form.name.trim()}” created`,
        sub: `${res.feePlan?.terms?.length ?? terms.length} term(s) × ${res.feePlan?.grades?.length ?? form.grades.length} grade(s). Nothing has been charged yet — generate fee dues to create records.`,
        tone: 'success',
      });
      setCreateOpen(false);
      setForm({ name: '', category: 'Tuition', feeHeadId: '', grades: [], terms: [emptyTerm()], installmentCount: 0, hikePct: '', consultationMeetingId: '' });
      plans.retry();
    } catch (e) {
      toast({ title: 'Could not create the plan', sub: friendly(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const generate = async (plan: FeePlan) => {
    setGenerating(plan.id);
    try {
      const res = await apiGenerateFeePlan(plan.id);
      toast({
        title: `Generation complete — ${res.inserted} fee due(s) created`,
        sub: `${res.skipped} skipped (already on record) · ${res.students} students in scope. Every row is in the fee records below.`,
        tone: 'success',
      });
      setGenPlan(null);
      setLastRun(res.billingRunId ?? null);
      plans.retry();
    } catch (e) {
      toast({ title: 'Generation failed', sub: friendly(e), tone: 'error' });
    } finally {
      setGenerating(null);
    }
  };

  const voidRun = async () => {
    if (!lastRun) return;
    setGenerating('void');
    try {
      const r = await apiVoidBillingRun(lastRun);
      toast({ title: 'Billing run voided', sub: `${r.voidedObligations} fee due(s) voided`, tone: 'success' });
      setLastRun(null);
      plans.retry();
    } catch (e) {
      toast({ title: 'Could not void the run', sub: friendly(e), tone: 'error' });
    } finally { setGenerating(null); }
  };

  /* ---------------- render ---------------- */
  return (
    <div className="u-col" style={{ gap: 14 }}>
      <PageHead
        title="Fee plans"
        sub="Templates that generate fee dues — pick grades, terms and amounts, then generate. Charges appear in the fee records, never from this screen directly."
        actions={
          <>
            {canManage && lastRun && (
              <Button variant="secondary" icon={<Icon.Refresh size={14} />} loading={generating === 'void'} onClick={voidRun} title="Void the billing run just generated (only if no payments are against it)">Void last run</Button>
            )}
            {canManage
              ? <Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setCreateOpen(true)}>New plan</Button>
              : <Button variant="primary" disabled title="Fee plans are managed by finance, the principal or the owner — your role can view them.">New plan</Button>}
          </>
        }
      />

      {plans.loading ? (
        <Card pad><div className="u-col" style={{ gap: 10 }}><SkeletonCard /><SkeletonCard lines={2} /></div></Card>
      ) : plans.error ? (
        <Card pad>
          {doorMissing ? (
            <Empty
              icon={<Icon.Offline size={22} />}
              title="Fee plans are unavailable right now"
              sub="The server did not answer the fee-plans request (this is a network or session problem, not missing data). Nothing is faked in the meantime."
              action={<Button variant="secondary" icon={<Icon.Refresh size={13} />} onClick={plans.retry}>Retry</Button>}
            />
          ) : (
            <ErrorState title="Could not load fee plans" sub={friendly(plans.error)} onRetry={plans.retry} />
          )}
        </Card>
      ) : (
        <>
          <div className="grid grid-3">
            <Stat label="Plans" value={String(totals.count)} sub="Templates on record" />
            <Stat label="Largest per-student total" value={totals.maxPerStudent ? `₹${centsToRupees(totals.maxPerStudent)}` : '—'} sub="Sum of one plan's terms" />
            <Stat label="Grades covered" value={totals.gradeSet ? String(totals.gradeSet) : '—'} sub="Distinct grades across plans" />
          </div>

          {(plans.data ?? []).length === 0 ? (
            <Card pad>
              <Empty
                icon={<Icon.Money size={24} />}
                title="No fee plans yet"
                sub={canManage
                  ? 'Create the first plan — grades, terms and amounts — then generate fee dues for every active student in scope.'
                  : 'Finance has not created any plans yet. Plans appear here the moment they exist.'}
                action={canManage ? <Button variant="secondary" onClick={() => setCreateOpen(true)}>Create the first plan</Button> : undefined}
              />
            </Card>
          ) : (
            <div className="u-col" style={{ gap: 12 }}>
              {(plans.data ?? []).map(p => (
                <Card key={p.id} pad>
                  <div className="u-flex" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div className="u-grow" style={{ minWidth: 220 }}>
                      <div className="u-flex u-wrap" style={{ gap: 6, alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                        {p.category && <Badge tone="neutral">{p.category}</Badge>}
                        <Badge tone="outline">{(p.grades ?? []).length} grade(s)</Badge>
                        <Badge tone="outline">{(p.terms ?? []).length} term(s)</Badge>
                      </div>
                      <div className="u-small u-muted" style={{ marginTop: 4 }}>
                        Grades {(p.grades ?? []).join(', ') || '—'} · per student{' '}
                        <span className="tnum">₹{centsToRupees((p.terms ?? []).reduce((a, t) => a + (t.amount_cents ?? 0), 0))}</span>
                        {p.last_generated_at ? ` · last generated ${fmtDate(new Date(p.last_generated_at))}` : ' · never generated'}
                      </div>
                      <div className="u-xs u-faint" style={{ marginTop: 4 }}>
                        {(p.terms ?? []).map(t => `${t.label}: ₹${centsToRupees(t.amount_cents)}${t.due_on ? ` (due ${fmtDate(new Date(t.due_on))})` : ''}`).join(' · ') || 'No terms on this plan'}
                      </div>
                    </div>
                    <div className="u-flex" style={{ gap: 8 }}>
                      {canManage
                        ? <Button variant="secondary" icon={<Icon.Play size={13} />} loading={generating === p.id} onClick={() => setGenPlan(p)}>Generate fee dues</Button>
                        : <Button variant="secondary" disabled title="Generation is done by finance, the principal or the owner.">Generate fee dues</Button>}
                    </div>
                  </div>
                </Card>
              ))}
              <div className="u-xs u-faint">Generation inserts one fee due per active student per term, server-side in a single transaction. Students who already have the fee due are skipped, paid rows are never overwritten.</div>
            </div>
          )}
        </>
      )}

      {/* create-plan modal */}
      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New fee plan"
        sub="A template only — nothing is charged or created until you generate fee dues."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={14} />} loading={saving} disabled={!formValid} onClick={createPlan}>Create plan</Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="fp-name">Plan name</label>
          <input id="fp-name" className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Tuition — AY 2026-27" />
        </div>
        <div className="field">
          <label htmlFor="fp-cat">Category</label>
          <input id="fp-cat" className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Tuition / Transport / Lab…" />
        </div>
        <div className="field">
          <label htmlFor="fp-head">Fee head <span className="u-faint">(optional — groups this charge in reports)</span></label>
          <select id="fp-head" className="input" value={form.feeHeadId} onChange={e => setForm(f => ({ ...f, feeHeadId: e.target.value }))}>
            <option value="">— No head —</option>
            {(heads.data ?? []).filter(h => h.active).map(h => <option key={h.id} value={h.id}>{h.name}{h.category ? ` · ${h.category}` : ''}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="fp-inst">Installment schedule <span className="u-faint">(optional — splits the fee due into equal parts)</span></label>
          <select id="fp-inst" className="input" value={form.installmentCount} onChange={e => setForm(f => ({ ...f, installmentCount: Number(e.target.value) }))}>
            <option value={0}>One payment (no schedule)</option>
            {[2, 3, 4, 6, 12].map(n => <option key={n} value={n}>{n} installments</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="fp-hike">Rise over last year, % <span className="u-faint">(optional — above 10% needs its SMC consultation below)</span></label>
          <input id="fp-hike" className="input" type="number" min={0} max={100} value={form.hikePct}
            onChange={e => setForm(f => ({ ...f, hikePct: e.target.value }))} placeholder="e.g. 8" />
        </div>
        {Number(form.hikePct) > 10 && (
          <div className="field">
            <label htmlFor="fp-smc">SMC consultation that approved it</label>
            <select id="fp-smc" className="input" value={form.consultationMeetingId} onChange={e => setForm(f => ({ ...f, consultationMeetingId: e.target.value }))}>
              <option value="">Choose the minuted meeting…</option>
              {meetings.map(m => <option key={m.id} value={m.id}>SMC · {m.held_on}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label>Grades in scope ({form.grades.length} selected)</label>
          <div className="u-flex u-wrap" style={{ gap: 6 }}>
            {GRADES.map(g => (
              <Button
                key={g}
                size="sm"
                variant={form.grades.includes(g) ? 'primary' : 'secondary'}
                onClick={() => toggleGrade(g)}
                aria-pressed={form.grades.includes(g)}
              >{g}</Button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Terms — label, amount per student, optional due date</label>
          <div className="u-col" style={{ gap: 8 }}>
            {form.terms.map((t, i) => (
              <div key={i} className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="input" style={{ flex: 1, minWidth: 90 }} placeholder={`Term name`} aria-label="Term name"
                  value={t.term}
                  onChange={e => setForm(f => ({ ...f, terms: f.terms.map((x, j) => j === i ? { ...x, term: e.target.value } : x) }))}
                />
                <input
                  className="input" style={{ flex: 2, minWidth: 130 }} placeholder={`Term ${i + 1} label`}
                  value={t.label}
                  onChange={e => setForm(f => ({ ...f, terms: f.terms.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))}
                />
                <input
                  className="input" style={{ flex: 1, minWidth: 110 }} placeholder="₹ per student" inputMode="decimal"
                  value={t.amountRupees}
                  onChange={e => setForm(f => ({ ...f, terms: f.terms.map((x, j) => j === i ? { ...x, amountRupees: e.target.value, amount_cents: rupeesToCents(e.target.value) } : x) }))}
                />
                <input
                  className="input" style={{ flex: 1, minWidth: 130 }} type="date" aria-label="Due date (optional)"
                  value={t.dueOn ?? ''}
                  onChange={e => setForm(f => ({ ...f, terms: f.terms.map((x, j) => j === i ? { ...x, dueOn: e.target.value } : x) }))}
                />
                {form.terms.length > 1 && (
                  <Button variant="ghost" icon={<Icon.X size={13} />} onClick={() => setForm(f => ({ ...f, terms: f.terms.filter((_, j) => j !== i) }))} aria-label="Remove term" />
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6 }}>
            <Button variant="secondary" size="sm" icon={<Icon.Plus size={12} />} onClick={() => setForm(f => ({ ...f, terms: [...f.terms, { ...emptyTerm(), term: `Term ${f.terms.length + 1}` }] }))}>Add term</Button>
          </div>
        </div>
        <p className="u-xs u-faint" style={{ marginBottom: 0, lineHeight: 1.6 }}>
          Generation happens per plan, when you choose it — every active student in the selected grades gets one fee due per term, and the server skips students who already have it.
        </p>
      </Modal>

      {/* generate confirm */}
      <Modal
        open={!!genPlan}
        onClose={() => !generating && setGenPlan(null)}
        title="Generate fee dues?"
        sub={genPlan ? `${genPlan.name} · grades ${(genPlan.grades ?? []).join(', ')}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGenPlan(null)} disabled={!!generating}>Cancel</Button>
            <Button variant="primary" loading={!!generating} onClick={() => genPlan && generate(genPlan)}>Generate now</Button>
          </>
        }
      >
        <p className="u-small u-muted" style={{ margin: 0, lineHeight: 1.65 }}>
          This creates real records on the server: one fee due per active student in the plan's grades, per term
          {genPlan ? ` (${(genPlan.terms ?? []).length} term(s), ₹${centsToRupees((genPlan.terms ?? []).reduce((a, t) => a + (t.amount_cents ?? 0), 0))} per student)` : ''}.
          Students who already have these fee dues are skipped; paid rows are never touched. The server reports the exact counts when it finishes.
        </p>
      </Modal>
    </div>
  );
}
