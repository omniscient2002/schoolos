/* ============================================================
   ExamMarks — Wave-3 exam depth (L4-3.1).
   Doors (exams.assessment plugin):
     GET  /plugins/exams.assessment/exams
     POST /plugins/exams.assessment/exams/:id/marks/bulk   (≤300 rows/batch)
     POST /plugins/exams.assessment/exams/:id/publish      (raises approval)
     POST /plugins/exams.assessment/exams/:id/publish/execute (SoD: a second person)
     GET  /plugins/exams.assessment/board-policy
   The grid surfaces per-student validation errors — client checks
   (numbers, marks ≤ max) AND every server failedRow (attendance
   floor, unknown student, DB rejects) renders against its row.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { apiGet, apiExams, apiExamBulkMarks, apiExamPublish, apiExamPublishExecute, apiBoardPolicy, type ExamSummary, type BulkMarkFailure } from '../../services/liveApi';
import { friendly } from '../../lib/friendlyErrors';
import {
  PageHead, Card, Badge, Button, Empty, Stat, useToast, SkeletonCard, ErrorState, KeyValue, Modal,
} from '../../components/ui';
import { Icon } from '../../components/Icon';

/* local async hook */
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

interface RosterStudent { id: string; name: string; admissionNo: string | null; section: string | null }

/* server cap: 300 rows per bulk batch — the UI quotes it, never hides it */
const DOOR_BATCH_CAP = 300;

export default function ExamMarks() {
  const { session } = useStore();
  const toast = useToast();
  const [examId, setExamId] = useState<string | null>(null);
  const [grid, setGrid] = useState<Record<string, { marks: string; max: string }>>({});
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failures, setFailures] = useState<BulkMarkFailure[]>([]);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  const exams = useAsync(async () => {
    const res = await apiExams();
    return res.exams ?? [];
  }, []);
  const policy = useAsync(async () => {
    try { return await apiBoardPolicy(); } catch { return null; }
  }, []);

  const exam: ExamSummary | null = (exams.data ?? []).find(e => e.id === examId) ?? null;
  const isAdmin = ['owner', 'principal', 'itadmin', 'coordinator'].includes(session.roleId);

  /* roster for the exam's class */
  const roster = useAsync(async () => {
    if (!exam) return [] as RosterStudent[];
    const res = await apiGet<{ students: Record<string, unknown>[] }>(`/students?grade=${encodeURIComponent(exam.classGrade ?? '')}&limit=300`);
    return (res.students ?? []).map(s => ({
      id: String(s.id),
      name: String(s.name ?? ''),
      admissionNo: (s.admission_no as string) ?? null,
      section: (s.section as string) ?? null,
    }));
  }, [exam?.id]);

  useEffect(() => { setFailures([]); setLastSaved(null); }, [examId]);

  const rowError = (marks: string, max: string): string | null => {
    if (!marks.trim()) return null;
    const m = Number(marks);
    if (!Number.isFinite(m) || m < 0) return 'marks must be a number from 0 up';
    const mm = Number(max || 100);
    if (!Number.isFinite(mm) || mm <= 0) return 'max marks must be positive';
    if (m > mm) return `marks (${m}) can't exceed the maximum (${mm})`;
    return null;
  };

  const pendingRows = useMemo(() => {
    if (!roster.data) return [];
    return roster.data
      .filter(st => (grid[st.id]?.marks ?? '').trim() !== '')
      .map(st => ({
        studentId: st.id,
        marks: Number(grid[st.id].marks),
        maxMarks: grid[st.id].max.trim() ? Number(grid[st.id].max) : undefined,
        student: st,
        error: rowError(grid[st.id].marks, grid[st.id].max),
      }));
  }, [grid, roster.data]);

  const invalidCount = pendingRows.filter(r => r.error).length;

  const submitBulk = async () => {
    if (!exam) return;
    const valid = pendingRows.filter(r => !r.error).map(r => ({ studentId: r.studentId, marks: r.marks, maxMarks: r.maxMarks }));
    if (valid.length === 0) {
      toast({ title: 'Nothing valid to save', sub: 'Fix the highlighted rows first.', tone: 'error' });
      return;
    }
    setBusy('bulk');
    try {
      const res = await apiExamBulkMarks(exam.id, valid);
      setFailures(res.failedRows ?? []);
      setLastSaved(res.saved ?? 0);
      toast({
        title: `${res.saved} mark(s) saved`,
        sub: (res.failedRows?.length ?? 0) > 0
          ? `${res.failedRows.length} row(s) rejected by the server — every reason is listed against its row.`
          : 'The server validated attendance eligibility and recorded each mark with an audit entry.',
        tone: (res.failedRows?.length ?? 0) > 0 ? 'info' : 'success',
      });
      // reflect server truth: re-fetch nothing (marks are write-only here), but keep grid state
    } catch (e) {
      toast({ title: 'Bulk save refused', sub: friendly(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  /* paste import: "admissionNo | studentId, marks[, max]" per line */
  const parsedPaste = useMemo(() => {
    const byAdm = new Map((roster.data ?? []).map(s => [s.admissionNo?.toLowerCase(), s]));
    const byId = new Map((roster.data ?? []).map(s => [s.id, s]));
    return pasteText.split('\n').map((line, i) => {
      const t = line.trim();
      if (!t) return { row: i, ok: false as const, error: 'empty line' };
      const parts = t.split(',').map(x => x.trim());
      const key = parts[0]?.toLowerCase();
      const st = byAdm.get(key) ?? byId.get(parts[0] ?? '');
      if (!st) return { row: i, ok: false as const, error: `no roster student matches “${parts[0]}”` };
      const marks = Number(parts[1]);
      if (!Number.isFinite(marks) || marks < 0) return { row: i, ok: false as const, error: 'marks must be a number from 0 up' };
      const max = parts[2] ? Number(parts[2]) : 100;
      if (!Number.isFinite(max) || max <= 0) return { row: i, ok: false as const, error: 'max marks must be positive' };
      if (marks > max) return { row: i, ok: false as const, error: `marks (${marks}) can't exceed the maximum (${max})` };
      return { row: i, ok: true as const, st, marks, max };
    });
  }, [pasteText, roster.data]);

  const applyPaste = () => {
    const good = parsedPaste.filter(p => p.ok);
    if (good.length === 0) return;
    setGrid(g => {
      const next = { ...g };
      good.forEach(p => { if (p.ok) next[p.st.id] = { marks: String(p.marks), max: p.max === 100 ? '' : String(p.max) }; });
      return next;
    });
    toast({ title: `${good.length} row(s) filled into the grid`, sub: 'Nothing is saved yet — review and submit.', tone: 'info' });
    setPasteOpen(false);
    setPasteText('');
  };

  const requestPublish = async () => {
    if (!exam) return;
    setBusy('publish');
    try {
      const res = await apiExamPublish(exam.id);
      toast({ title: 'Approval raised', sub: `Kernel action ${res.actionId?.slice(0, 8)}… is waiting in the Action Center — publication proceeds only after it is approved.`, tone: 'success' });
      exams.retry();
    } catch (e) {
      toast({ title: 'Could not raise the approval', sub: friendly(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const executePublish = async () => {
    if (!exam) return;
    setBusy('execute');
    try {
      const res = await apiExamPublishExecute(exam.id);
      toast({ title: `Published — ${res.reports} report card(s) assembled`, sub: `Snapshot digest ${res.digest?.slice(0, 12)}… · marks are now frozen read-only.`, tone: 'success' });
      exams.retry();
    } catch (e) {
      toast({ title: 'Publication did not execute', sub: friendly(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="u-col" style={{ gap: 14 }}>
      <PageHead
        title="Exam marks"
        sub="Pick an exam, enter or paste marks, surface every validation error per student, then take publication through approval."
      />

      {/* ---- exam picker ---- */}
      {exams.loading ? (
        <Card pad><SkeletonCard lines={3} /></Card>
      ) : exams.error ? (
        <Card pad><ErrorState title="Could not load exams" sub={friendly(exams.error)} onRetry={exams.retry} /></Card>
      ) : (exams.data ?? []).length === 0 ? (
        <Card pad>
          <Empty icon={<Icon.Book size={24} />} title="No exams yet" sub="Exams are created by the assessment coordinator (owner/principal/itadmin/coordinator). They appear here the moment they exist." />
        </Card>
      ) : (
        <div className="u-flex u-wrap" style={{ gap: 8 }}>
          {(exams.data ?? []).map(e => (
            <Button
              key={e.id}
              size="sm"
              variant={examId === e.id ? 'primary' : 'secondary'}
              onClick={() => setExamId(e.id)}
            >
              {e.name} · {e.classGrade ? `Class ${e.classGrade}` : '—'}
              <Badge tone={e.status === 'published' ? 'success' : 'neutral'}>{e.status ?? 'draft'}</Badge>
            </Button>
          ))}
        </div>
      )}

      {exam && (
        <>
          <div className="grid grid-3">
            <Stat label="Roster" value={roster.loading ? '…' : String((roster.data ?? []).length)} sub={`Class ${exam.classGrade ?? '—'}`} />
            <Stat label="Filled" value={String(pendingRows.length)} sub={`${invalidCount} with validation errors`} />
            <Stat label="Saved (last batch)" value={lastSaved != null ? String(lastSaved) : '—'} sub={failures.length ? `${failures.length} rejected by the server` : 'server-validated'} />
          </div>

          {/* ---- publish panel ---- */}
          <Card pad>
            <div className="u-between u-wrap" style={{ gap: 10, alignItems: 'center' }}>
              <div className="u-col" style={{ gap: 3 }}>
                <span style={{ fontWeight: 620 }}>Publication — approval before publish</span>
                <span className="u-small u-muted">
                  Request raises a kernel approval in the Action Center; executing assembles deterministic report cards and freezes marks.
                  The person who raised it cannot execute it — a second admin must.
                </span>
              </div>
              {isAdmin && exam.status !== 'published' ? (
                <div className="u-flex" style={{ gap: 8 }}>
                  <Button size="sm" variant="secondary" loading={busy === 'publish'} disabled={!!busy} onClick={requestPublish}>Request publication</Button>
                  <Button size="sm" variant="primary" loading={busy === 'execute'} disabled={!!busy} onClick={executePublish}>Execute publication</Button>
                </div>
              ) : (
                <Badge tone={exam.status === 'published' ? 'success' : 'neutral'} dot>{exam.status === 'published' ? 'Published — marks frozen' : 'Admin authority required'}</Badge>
              )}
            </div>
          </Card>

          {/* ---- grid ---- */}
          {roster.loading ? (
            <Card pad><SkeletonCard lines={5} /></Card>
          ) : roster.error ? (
            <Card pad><ErrorState title="Could not load the class roster" sub={friendly(roster.error)} onRetry={roster.retry} /></Card>
          ) : (roster.data ?? []).length === 0 ? (
            <Card pad><Empty icon={<Icon.People size={22} />} title="No students in this class" sub="Enrol students from the Directory — the grid fills from the live roster." /></Card>
          ) : (
            <Card pad={false}>
              <div className="card-head">
                <h3>Marks grid — {exam.name}</h3>
                <div className="u-flex" style={{ gap: 8 }}>
                  <Button size="sm" variant="secondary" icon={<Icon.Grid size={12} />} onClick={() => setPasteOpen(true)}>Paste / import</Button>
                  <Button size="sm" variant="primary" icon={<Icon.Check size={12} />} loading={busy === 'bulk'} disabled={!!busy || pendingRows.filter(r => !r.error).length === 0} onClick={submitBulk}>
                    Save {pendingRows.filter(r => !r.error).length} mark(s)
                  </Button>
                </div>
              </div>
              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>Student</th>
                      <th style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-3)', width: 110 }}>Marks</th>
                      <th style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-3)', width: 110 }}>Max</th>
                      <th style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>Validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(roster.data ?? []).map(st => {
                      const cell = grid[st.id] ?? { marks: '', max: '' };
                      const err = rowError(cell.marks, cell.max);
                      const serverFail = failures.find(f => f.studentId === st.id);
                      return (
                        <tr key={st.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '7px 12px' }}>
                            <div style={{ fontWeight: 570 }}>{st.name}</div>
                            <div className="u-xs u-faint">{st.admissionNo ?? st.id.slice(0, 8)}{st.section ? ` · ${st.section}` : ''}</div>
                          </td>
                          <td style={{ padding: '7px 12px' }}>
                            <input
                              className="input" inputMode="decimal" aria-label={`Marks for ${st.name}`}
                              value={cell.marks}
                              onChange={e => setGrid(g => ({ ...g, [st.id]: { ...cell, marks: e.target.value } }))}
                              style={{ borderColor: err ? 'var(--danger)' : undefined }}
                            />
                          </td>
                          <td style={{ padding: '7px 12px' }}>
                            <input
                              className="input" inputMode="decimal" placeholder="100" aria-label={`Max marks for ${st.name}`}
                              value={cell.max}
                              onChange={e => setGrid(g => ({ ...g, [st.id]: { ...cell, max: e.target.value } }))}
                            />
                          </td>
                          <td style={{ padding: '7px 12px' }}>
                            {err
                              ? <span className="u-small" style={{ color: 'var(--danger-text)' }}>{err}</span>
                              : serverFail
                                ? <span className="u-small" style={{ color: 'var(--danger-text)' }}>Server: {serverFail.error}</span>
                                : cell.marks.trim() ? <Badge tone="success" dot>Valid</Badge> : <span className="u-faint u-xs">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="u-xs u-faint" style={{ padding: '10px 12px' }}>
                The server caps bulk saves at {DOOR_BATCH_CAP} rows per batch and applies the attendance eligibility floor per student — every rejection comes back with its reason and is shown against the row. Marks overwrite on re-save until the exam is published; then they freeze.
              </div>
            </Card>
          )}

          {/* ---- board policy ---- */}
          {policy.data && (
            <Card pad>
              <div className="card-head"><h3>Board policy</h3><span className="u-small u-faint">GET /board-policy</span></div>
              <div className="card-body">
                <KeyValue
                  cols={1}
                  items={Object.entries(policy.data.policy ?? policy.data).slice(0, 8).map(([k, v]) => ({
                    k,
                    v: typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—'),
                  }))}
                />
              </div>
            </Card>
          )}
        </>
      )}

      {/* ---- paste import modal ---- */}
      <Modal
        open={pasteOpen}
        onClose={() => !busy && setPasteOpen(false)}
        title="Paste marks"
        sub="One student per line: admission no (or student id), marks[, max]. Example: ADM-2F9K, 87, 100"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={parsedPaste.filter(p => p.ok).length === 0} onClick={applyPaste}>
              Fill {parsedPaste.filter(p => p.ok).length} valid row(s)
            </Button>
          </>
        }
      >
        <textarea
          className="input" rows={8} value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          placeholder={'ADM-2F9K, 87, 100\nADM-3T1P, 92'}
          style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12.5 }}
        />
        {pasteText.trim() && (
          <div className="u-col" style={{ gap: 4, marginTop: 8, maxHeight: 160, overflowY: 'auto' }}>
            {parsedPaste.filter(p => !p.ok).map(p => (
              <div key={p.row} className="u-small" style={{ color: 'var(--danger-text)' }}>Line {p.row + 1}: {p.error}</div>
            ))}
          </div>
        )}
        <p className="u-xs u-faint" style={{ marginBottom: 0 }}>The server accepts {DOOR_BATCH_CAP} rows per batch — split larger classes. Nothing is saved until you submit the grid.</p>
      </Modal>
    </div>
  );
}
