/* ============================================================
   People — the school directory.
   Students · Teachers · Staff · Guardians, with search,
   scoped filters and role-aware stats.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CampusId } from '../types/domain';
import { apiGet, apiPost, apiStudents, apiUpdateStudent, apiWithdrawStudent, apiPromoteStudent } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { roleLabel, statusLabel, humanize } from '../lib/labels';
import { useStore } from '../state/store';
import {
  Avatar, Badge, Button, Card, DataTable, Empty, ErrorState, Modal, PageHead, Skeleton, Stat, useToast,
} from '../components/ui';
import { Icon } from '../components/Icon';
import type { Person } from '../types/domain';

/* Local async hook (duplicated per screen per APP-SPEC §async pattern) */
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

type TabId = 'student' | 'teacher' | 'staff' | 'guardian';

const TYPE_LABEL: Record<TabId, string> = { student: 'Students', teacher: 'Teachers', staff: 'Staff', guardian: 'Guardians' };

function csvCell(v: string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

export default function People() {
  const navigate = useNavigate();
  const { session } = useStore();
  const toast = useToast();

  const [tab, setTab] = useState<TabId>('student');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [grade, setGrade] = useState('all');
  const [klass, setKlass] = useState('');
  const [visible, setVisible] = useState(15);
  const [addOpen, setAddOpen] = useState(false);
  /* P2-7: date of birth and gender were nowhere — not in the model, not in this form — even though a
     school in India cannot enrol without them (TCS, age-based admission, transport eligibility, meal
     schemes, statutory returns). Both are optional here, and the school may set its own admission
     number; the door validates all three and answers with a plain 400 rather than a constraint error. */
  const [form, setForm] = useState({ name: '', phone: '', grade: '', section: '', guardianName: '', dob: '', gender: '', admissionNo: '' });
  const [saving, setSaving] = useState(false);
  /* Directory creation authority — POST /students allows owner, principal,
     coordinator and admissions. Everyone else gets an honest disabled button. */
  const canAddStudent = ['owner', 'principal', 'coordinator', 'admissions'].includes(session.roleId);
  /* The wider people directory door (manage teachers/staff/guardians) is
     owner/IT-admin only — we never call it from this screen for other roles. */
  const canManagePeople = ['owner', 'itadmin'].includes(session.roleId);

  /* L4-3.2 — student lifecycle row actions (live roster rows only) */
  const [editRow, setEditRow] = useState<{ id: string; name: string; guardianName: string; guardianPhone: string; busRoute: string } | null>(null);
  const [withdrawRow, setWithdrawRow] = useState<{ id: string; name: string } | null>(null);
  const [wdReason, setWdReason] = useState('');
  const [wdDate, setWdDate] = useState('');
  const [wdSchool, setWdSchool] = useState('');
  const [promoteRow, setPromoteRow] = useState<{ id: string; name: string; grade: string; section: string } | null>(null);
  const [promoteGrade, setPromoteGrade] = useState('');
  const [promoteSection, setPromoteSection] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  /* debounced search query */
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  /* reset dependent filters when the tab changes */
  useEffect(() => { setGrade('all'); setKlass(''); setVisible(15); }, [tab]);
  useEffect(() => { setVisible(15); }, [debounced, grade, klass]);

  const results = useAsync<Person[]>(
    () => {
      // The students roster door (staff surface; 403s the student role by design).
      // Teacher/staff/guardian roster doors do not exist yet — those tabs say so.
      if (tab !== 'student') return Promise.resolve([]);
      return apiStudents({
        ...(debounced.trim() ? { search: debounced.trim() } : {}),
        ...(grade !== 'all' ? { grade } : {}),
        limit: '200',
      }).then(res => (res.students ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        name: String(r.name ?? ''),
        type: 'student' as const,
        campus: session.campusScope as CampusId, // Person requires the field; the UI no longer shows it (no campuses exist)
        email: '',
        phone: String(r.guardian_phone ?? ''),
        grade: (Number.isFinite(Number(r.grade)) ? Number(r.grade) : String(r.grade)) as unknown as number,
        section: r.section ? String(r.section) : undefined,
        rollNo: r.admission_no ? String(r.admission_no) : undefined,
        admissionNo: r.admission_no ? String(r.admission_no) : undefined,
        busRoute: r.bus_route ? String(r.bus_route) : undefined,
        status: 'active' as const,
        guardianName: r.guardian_name ? String(r.guardian_name) : undefined,
      } as Person)));
    },
    [debounced, tab, grade],
  );

  /* Grade choices are derived from the roster already loaded — no invented list. */
  const gradeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of results.data ?? []) {
      if (p.grade != null && String(p.grade).trim()) set.add(String(p.grade));
    }
    return Array.from(set).sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
  }, [results.data]);

  const rows = useMemo(() => {
    const data = results.data ?? [];
    const q = klass.trim().toLowerCase();
    if (!q) return data;
    return data.filter(p => `${p.grade ?? ''}-${p.section ?? ''}`.toLowerCase().includes(q));
  }, [results.data, klass]);
  const shown = rows.slice(0, visible);

  /* P3-2 · two of the three "Not connected" cards had their data all along.
     Staff/teachers come from `GET /school/staff` (office roles — a role that cannot read it keeps the
     honest card rather than a fabricated number), and guardian CONTACTS are already on the roster rows
     this screen loaded. Only the attendance rollup stays unavailable, because one day's register is not
     an average and inventing one is what the "unavailable" prop exists to prevent. */
  const staffQ = useAsync(() => apiGet<{ staff: { id: string; role: string }[] }>('/school/staff')
    .then(r => (r.staff ?? []).map(u => ({ id: u.id, role: u.role })))
    .catch(() => null as { id: string; role: string }[] | null), []);

  const counts = useMemo(() => {
    const staff = staffQ.data;
    const guardianContacts = new Set(
      rows.map(p => (p.guardianName ?? '').trim().toLowerCase() || (p.phone ?? '').trim()).filter(Boolean)).size;
    return {
      student: rows.length,
      teacher: staff ? staff.filter(u => u.role === 'teacher').length : 0,
      staff: staff ? staff.filter(u => u.role !== 'teacher').length : 0,
      guardian: guardianContacts,
    };
  }, [rows, staffQ.data]);
  const staffKnown = staffQ.data != null;

  const detailOf = (p: Person) => {
    if (p.type === 'student') return `${p.grade}-${p.section} · ${p.admissionNo ?? ''}`;
    return p.role ? roleLabel(p.role) : '';
  };

  const exportCsv = () => {
    try {
      const head = 'Name,Type,Email,Phone,Detail';
      const lines = rows.map(p => [p.name, humanize(p.type), p.email, p.phone, detailOf(p)].map(csvCell).join(','));
      const blob = new Blob([`${head}\n${lines.join('\n')}`], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `directory-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Exported ${rows.length} records`, sub: 'CSV downloaded — opens in any spreadsheet.', tone: 'success' });
    } catch {
      toast({ title: 'Export failed', sub: 'The browser blocked the file download.', tone: 'error' });
    }
  };

  const submitPerson = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    if (!form.grade || !form.section) {
      setSaving(false);
      toast({ title: 'Grade and section are required', sub: 'The server needs a class to enrol the student into.', tone: 'error' });
      return;
    }
    try {
      const res = await apiPost<{ student: { admission_no: string | null; name: string; grade: string; section: string } }>('/students', {
        name: form.name.trim(),
        grade: form.grade,
        section: form.section,
        ...(form.phone.trim() ? { guardianPhone: form.phone.trim() } : {}),
        ...(form.guardianName.trim() ? { guardianName: form.guardianName.trim() } : {}),
        ...(form.dob.trim() ? { dob: form.dob.trim() } : {}),
        ...(form.gender ? { gender: form.gender } : {}),
        ...(form.admissionNo.trim() ? { admissionNo: form.admissionNo.trim() } : {}),
        reason: 'Front-office intake',
      });
      toast({
        title: `${res.student.name} enrolled`,
        sub: `Admission no ${res.student.admission_no ?? 'auto'} · ${res.student.grade}-${res.student.section} · audited with your name and role.`,
        tone: 'success',
      });
      setAddOpen(false);
      setForm({ name: '', phone: '', grade: '', section: '', guardianName: '', dob: '', gender: '', admissionNo: '' });
      results.retry();
    } catch (e) {
      toast({ title: 'Could not enrol the student', sub: friendly(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const canEdit = ['owner', 'principal', 'coordinator'].includes(session.roleId);
  const canWithdraw = ['owner', 'principal'].includes(session.roleId);
  /* GRADE-1: grades are free text ("Grade 1", "LKG", "6", "Class VIII"). These two
     helpers used Number(), which yields NaN for every named grade — the promote
     dialog never pre-filled a next class and sorting the roster by grade was a
     no-op that pushed every named grade to 999. Read the number out of the label. */
  const gradeNumber = (g: string): number | null => {
    const m = /(\d+)/.exec(g ?? '');
    return m ? Number(m[1]) : null;
  };
  const nextGradeOf = (g: string): string => {
    if (g === 'LKG') return 'UKG';
    if (g === 'UKG') return '1';
    const n = gradeNumber(g);
    if (n != null && n >= 1 && n < 10) return String(n + 1);
    return '';
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setRowBusy('edit');
    try {
      const patch: Record<string, string> = {};
      if (editRow.name.trim()) patch.name = editRow.name.trim();
      if (editRow.guardianName.trim() || editRow.guardianPhone.trim() || editRow.busRoute.trim()) {
        if (editRow.guardianName.trim()) patch.guardian_name = editRow.guardianName.trim();
        if (editRow.guardianPhone.trim()) patch.guardian_phone = editRow.guardianPhone.trim();
        if (editRow.busRoute.trim()) patch.bus_route = editRow.busRoute.trim();
      }
      await apiUpdateStudent(editRow.id, patch);
      toast({ title: 'Record updated', sub: `${editRow.name} — the change is on the student's school records with an audit entry.`, tone: 'success' });
      setEditRow(null);
      results.retry();
    } catch (e) {
      toast({ title: 'Could not update the record', sub: friendly(e), tone: 'error' });
    } finally {
      setRowBusy(null);
    }
  };

  const submitWithdraw = async () => {
    if (!withdrawRow || wdReason.trim().length < 2) return;
    setRowBusy('withdraw');
    try {
      const res = await apiWithdrawStudent(withdrawRow.id, {
        reason: wdReason.trim(),
        ...(wdDate ? { effective_date: wdDate } : {}),
        ...(wdSchool.trim() ? { last_school: wdSchool.trim() } : {}),
      });
      toast({ title: `${res.student.name ?? withdrawRow.name} withdrawn`, sub: res.note ?? 'The record is kept — the bus seat is released.', tone: 'success' });
      setWithdrawRow(null); setWdReason(''); setWdDate(''); setWdSchool('');
      results.retry();
    } catch (e) {
      toast({ title: 'Withdrawal refused', sub: friendly(e), tone: 'error' });
    } finally {
      setRowBusy(null);
    }
  };

  const submitPromote = async () => {
    if (!promoteRow) return;
    setRowBusy('promote');
    try {
      const res = await apiPromoteStudent(promoteRow.id, {
        ...(promoteGrade.trim() ? { to_grade: promoteGrade.trim() } : {}),
        ...(promoteSection.trim() ? { to_section: promoteSection.trim() } : {}),
      });
      toast({ title: `${res.student.name ?? promoteRow.name} promoted`, sub: `Class ${res.from.grade}-${res.from.section} → ${res.to.grade}-${res.to.section} — the move is on the student's history.`, tone: 'success' });
      setPromoteRow(null); setPromoteGrade(''); setPromoteSection('');
      results.retry();
    } catch (e) {
      toast({ title: 'Promotion refused', sub: friendly(e), tone: 'error' });
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <>
      <PageHead
        title="Directory"
        sub="Students, teachers, staff and guardians — one record per person, verified contacts first."
        actions={
          <>
            <Button variant="secondary" icon={<Icon.Download size={14} />} onClick={exportCsv}>Export CSV</Button>
            <Button
              variant="primary" icon={<Icon.Plus size={14} />}
              disabled={!canAddStudent}
              title={canAddStudent ? undefined : 'Enrolling students is done by the owner, principal, coordinator or admissions desk — your role can view and export the directory.'}
              onClick={() => setAddOpen(true)}
            >Add person</Button>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Total students" value={counts.student.toLocaleString('en-IN')} sub={`${counts.student} student${counts.student === 1 ? '' : 's'} in the roster`} onClick={() => setTab('student')} />
        <Stat label="Staff & teachers" value={staffKnown ? String(counts.teacher + counts.staff) : '—'}
          sub={staffKnown ? `${counts.teacher} teaching · ${counts.staff} other roles` : 'The staff roster is visible to the office roles'}
          onClick={() => setTab('teacher')} />
        <Stat label="Guardian contacts" value={counts.guardian.toLocaleString('en-IN')}
          sub={`${counts.guardian} famil${counts.guardian === 1 ? 'y' : 'ies'} with a contact on this roster`} />
        <Stat label="Avg attendance" unavailable="Not connected" sub="A day's register is on the Attendance screen; a term average is not read yet" />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Card pad>
          <div className="u-flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            <div className="searchbox u-grow" style={{ minWidth: 230 }}>
              <Icon.Search size={15} />
              <input
                id="people-search"
                className="input"
                placeholder={`Search ${TYPE_LABEL[tab].toLowerCase()} by name, email or roll no…`}
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Search the directory"
              />
            </div>
            {tab === 'student' && (
              <>
                <select className="select" style={{ width: 140 }} value={grade} onChange={e => setGrade(e.target.value)} aria-label="Filter by grade">
                  <option value="all">All grades</option>
                  {gradeOptions.map(g => <option key={g} value={g}>Grade {g}</option>)}
                </select>
                <input
                  className="input"
                  style={{ width: 170 }}
                  value={klass}
                  onChange={e => setKlass(e.target.value)}
                  placeholder="Filter by class, e.g. 6-A"
                  aria-label="Filter by class"
                />
              </>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <TabsRow tab={tab} counts={counts} onChange={setTab} />
          </div>
        </Card>
      </div>

      <Card pad={false} className="u-col">
        <div className="card-head">
          <h3>{TYPE_LABEL[tab]}</h3>
          <span className="u-small u-faint">
            {results.loading
              ? 'Searching…'
              : `Showing ${shown.length} of ${rows.length}${rows.length >= 60 ? ' · showing first 60 — refine the search to narrow it' : ''}`}
          </span>
        </div>
        <div>
          {results.loading ? (
            <div className="u-col" style={{ gap: 12, padding: 20 }}>
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="u-flex" style={{ gap: 12 }}>
                  <Skeleton w={30} h={30} r={15} />
                  <Skeleton w={`calc(${100 - (i % 4) * 9}% - 42px)`} h={14} />
                </div>
              ))}
            </div>
          ) : results.error ? (
            <ErrorState
              title="Could not load the directory"
              sub="The people service did not respond. Nothing was changed — try again."
              onRetry={results.retry}
            />
          ) : tab !== 'student' ? (
            <Empty
              icon={<Icon.Users size={22} />}
              title={`${TYPE_LABEL[tab]} directory`}
              sub={
                canManagePeople
                  ? 'Directory management for teachers, staff and guardians lives under Manage people. Open it to view and maintain those records.'
                  : 'Teacher, staff and guardian directories are not available to your role yet. The student roster is live here — ask an owner or IT administrator for the wider directory.'
              }
              action={
                canManagePeople
                  ? <Button variant="secondary" icon={<Icon.Users size={14} />} onClick={() => navigate('/people-admin')}>Open Manage people</Button>
                  : undefined
              }
            />
          ) : rows.length === 0 ? (
            <Empty
              icon={<Icon.Search size={26} />}
              title={debounced || klass.trim() ? 'No people match your filters' : `No ${TYPE_LABEL[tab].toLowerCase()} in the roster`}
              sub="Try a shorter name, or clear the grade and class filters."
              action={
                <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={() => { setQuery(''); setDebounced(''); setGrade('all'); setKlass(''); }}>
                  Clear search & filters
                </Button>
              }
            />
          ) : (
            <>
              <DataTable<Person>
                caption="Student directory — search and filter the roster"
                rows={shown}
                rowKey={p => p.id}
                onRowClick={p => navigate(`/people/${p.id}`)}
                columns={[
                  {
                    key: 'name', label: 'Person', sortable: true, sortValue: p => p.name,
                    render: p => (
                      <div className="u-flex" style={{ gap: 10, minWidth: 0 }}>
                        <Avatar name={p.name} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div className="u-truncate" style={{ fontWeight: 560 }}>{p.name}</div>
                          <div className="u-xs u-faint u-truncate">{p.admissionNo ? `Adm ${p.admissionNo}` : ''}</div>
                        </div>
                      </div>
                    ),
                  },
                  ...(tab === 'student' ? [
                    { key: 'grade', label: 'Grade · Sec', sortable: true, sortValue: (p: Person) => gradeNumber(String(p.grade ?? '')) ?? 999, render: (p: Person) => <span className="tnum">{p.grade != null ? String(p.grade) : '—'} · {p.section ?? '—'}</span> },
                    { key: 'guardian', label: 'Guardian', render: (p: Person) => <span className="u-truncate" style={{ maxWidth: 180, display: 'inline-block' }}>{(p as unknown as { guardianName?: string }).guardianName ?? '—'}{p.phone ? <span className="u-xs u-faint"> · {p.phone}</span> : null}</span> },
                    { key: 'bus', label: 'Bus route', render: (p: Person) => p.busRoute ? <Badge tone="info">{p.busRoute}</Badge> : <span className="u-faint">—</span> },
                    { key: 'adm', label: 'Admission no.', render: (p: Person) => <span className="mono u-small">{p.admissionNo ?? '—'}</span> },
                  ] : []),
                  ...(tab === 'student' ? [{
                    key: 'actions', label: '', align: 'right' as const, render: (p: Person) => (
                      <span className="u-flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="ghost" icon={<Icon.Edit size={12} />} disabled={!canEdit}
                          title={canEdit ? 'Edit the record' : 'Editing is done by the owner, principal or coordinator'}
                          onClick={e => { e.stopPropagation(); if (canEdit) setEditRow({ id: p.id, name: p.name, guardianName: String((p as unknown as { guardianName?: string }).guardianName ?? ''), guardianPhone: p.phone ?? '', busRoute: '' }); }}>Edit</Button>
                        <Button size="sm" variant="ghost" icon={<Icon.ArrowUpRight size={12} />} disabled={!canEdit}
                          title={canEdit ? 'Promote to the next class' : 'Promotion is done by the owner, principal or coordinator'}
                          onClick={e => { e.stopPropagation(); if (canEdit) { setPromoteRow({ id: p.id, name: p.name, grade: String((p as unknown as { grade?: string | number }).grade ?? ''), section: String((p as unknown as { section?: string }).section ?? '') }); setPromoteGrade(nextGradeOf(String((p as unknown as { grade?: string | number }).grade ?? ''))); setPromoteSection(''); } }}>Promote</Button>
                        <Button size="sm" variant="ghost" disabled={!canWithdraw}
                          title={canWithdraw ? 'Withdraw / transfer out' : 'Withdrawal is done by the owner or principal'}
                          onClick={e => { e.stopPropagation(); if (canWithdraw) { setWithdrawRow({ id: p.id, name: p.name }); setWdReason(''); setWdDate(''); setWdSchool(''); } }}>Withdraw</Button>
                      </span>
                    ),
                  }] : []),
                ]}
              />
              {shown.length < rows.length && (
                <div className="u-center" style={{ padding: '12px 20px 16px' }}>
                  <Button variant="secondary" icon={<Icon.ChevronDown size={14} />} onClick={() => setVisible(v => v + 15)}>
                    Load more · {Math.min(15, rows.length - shown.length)} more of {rows.length - shown.length}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Enrol a student"
        sub="Creates the student record immediately via the server (owner, principal, coordinator or admissions). It is audited with your name and role."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={14} />} loading={saving} disabled={!form.name.trim()} onClick={submitPerson}>
              Enrol student
            </Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="np-name">Full name</label>
          <input id="np-name" className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Meera Nair" />
        </div>
        <>
          <div className="u-flex" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="field u-grow" style={{ minWidth: 120 }}>
              <label htmlFor="np-grade">Grade</label>
              <input id="np-grade" className="input" value={form.grade} onChange={e => setForm(f => ({ ...f, grade: e.target.value }))} placeholder="e.g. 6" />
            </div>
            <div className="field u-grow" style={{ minWidth: 120 }}>
              <label htmlFor="np-section">Section</label>
              <input id="np-section" className="input" value={form.section} onChange={e => setForm(f => ({ ...f, section: e.target.value }))} placeholder="e.g. A" />
            </div>
          </div>
          <div className="u-flex" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="field u-grow" style={{ minWidth: 150 }}>
              <label htmlFor="np-dob">Date of birth</label>
              <input id="np-dob" type="date" className="input" value={form.dob} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} />
              <span className="hint">Optional, but the register needs it — and it drives age-based admission and transport eligibility.</span>
            </div>
            <div className="field u-grow" style={{ minWidth: 140 }}>
              <label htmlFor="np-gender">Gender</label>
              <select id="np-gender" className="input" value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                <option value="">Not stated</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="np-admno">Admission number (optional)</label>
            <input id="np-admno" className="input" value={form.admissionNo} onChange={e => setForm(f => ({ ...f, admissionNo: e.target.value }))} placeholder="e.g. 2026-0147" />
            <span className="hint">Leave blank and the school gets a generated number. Your own series is what appears on report cards and receipts.</span>
          </div>
          <div className="field">
            <label htmlFor="np-guardian">Guardian name (optional)</label>
            <input id="np-guardian" className="input" value={form.guardianName} onChange={e => setForm(f => ({ ...f, guardianName: e.target.value }))} placeholder="e.g. Ramesh Nair" />
          </div>
        </>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="np-phone">Guardian phone (optional)</label>
          <input id="np-phone" className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 98…" />
          <span className="hint">Numbers are WhatsApp-verified before absence alerts are enabled (Attendance §1.1).</span>
        </div>
        <p className="u-xs u-faint" style={{ marginBottom: 0, lineHeight: 1.6 }}>
          Only student records can be created here. Teacher, staff and guardian records come from onboarding and migration.
        </p>
      </Modal>

      {/* ---- L4-3.2 lifecycle modals (live rows) ---- */}
      <Modal
        open={!!editRow}
        onClose={() => !rowBusy && setEditRow(null)}
        title="Edit student record"
        sub={editRow?.name}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditRow(null)} disabled={!!rowBusy}>Cancel</Button>
            <Button variant="primary" loading={rowBusy === 'edit'} onClick={saveEdit}>Save changes</Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="ed-name">Full name</label>
          <input id="ed-name" className="input" value={editRow?.name ?? ''} onChange={e => setEditRow(f => f ? { ...f, name: e.target.value } : f)} />
        </div>
        <div className="field">
          <label htmlFor="ed-gn">Guardian name</label>
          <input id="ed-gn" className="input" value={editRow?.guardianName ?? ''} onChange={e => setEditRow(f => f ? { ...f, guardianName: e.target.value } : f)} />
        </div>
        <div className="field">
          <label htmlFor="ed-gp">Guardian phone</label>
          <input id="ed-gp" className="input" value={editRow?.guardianPhone ?? ''} onChange={e => setEditRow(f => f ? { ...f, guardianPhone: e.target.value } : f)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="ed-br">Bus route</label>
          <input id="ed-br" className="input" value={editRow?.busRoute ?? ''} onChange={e => setEditRow(f => f ? { ...f, busRoute: e.target.value } : f)} placeholder="e.g. Route 7" />
          <span className="hint">Class and section changes are not edits — they go through Promote so the move lands in the student's history.</span>
        </div>
      </Modal>

      <Modal
        open={!!promoteRow}
        onClose={() => !rowBusy && setPromoteRow(null)}
        title="Promote student"
        sub={promoteRow ? `${promoteRow.name} · class ${promoteRow.grade}-${promoteRow.section}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPromoteRow(null)} disabled={!!rowBusy}>Cancel</Button>
            <Button variant="primary" loading={rowBusy === 'promote'} onClick={submitPromote}>Promote</Button>
          </>
        }
      >
        <p className="u-small u-muted" style={{ marginTop: 0, lineHeight: 1.65 }}>
          The server advances the class automatically (LKG → UKG → 1 … 10). Override only if the school's move differs —
          leaving both fields as suggested promotes by the book. Academic-year-scoped bulk promotion pairs with the AY engine when it lands.
        </p>
        <div className="u-flex" style={{ gap: 12 }}>
          <div className="field u-grow">
            <label htmlFor="pr-grade">To class (prefilled with the next class)</label>
            <input id="pr-grade" className="input" value={promoteGrade} onChange={e => setPromoteGrade(e.target.value)} />
          </div>
          <div className="field u-grow">
            <label htmlFor="pr-section">To section (optional)</label>
            <input id="pr-section" className="input" value={promoteSection} onChange={e => setPromoteSection(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!withdrawRow}
        onClose={() => !rowBusy && setWithdrawRow(null)}
        title="Withdraw this student?"
        sub={withdrawRow?.name}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawRow(null)} disabled={!!rowBusy}>Cancel</Button>
            <Button variant="danger" loading={rowBusy === 'withdraw'} disabled={wdReason.trim().length < 2} onClick={submitWithdraw}>Withdraw</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="wd-reason">Reason (goes on the record)</label>
            <input id="wd-reason" className="input" value={wdReason} onChange={e => setWdReason(e.target.value)} placeholder="e.g. family relocated to Pune" />
          </div>
          <div className="u-flex" style={{ gap: 12 }}>
            <div className="field u-grow" style={{ marginBottom: 0 }}>
              <label htmlFor="wd-date">Effective date (optional)</label>
              <input id="wd-date" className="input" type="date" value={wdDate} onChange={e => setWdDate(e.target.value)} />
            </div>
            <div className="field u-grow" style={{ marginBottom: 0 }}>
              <label htmlFor="wd-school">Last school (optional)</label>
              <input id="wd-school" className="input" value={wdSchool} onChange={e => setWdSchool(e.target.value)} />
            </div>
          </div>
          <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>
            What happens on the server: status becomes <b>{statusLabel('transferred')}</b> (effective the chosen date), the bus seat is released,
            and attendance, fee records and guardian links are kept. This cannot be undone from the app — re-admission creates a fresh record.
          </div>
        </div>
      </Modal>
    </>
  );
}

/* Tab strip with per-type counts (kept outside the main render for readability) */
function TabsRow({ tab, counts, onChange }: { tab: TabId; counts: Record<TabId, number>; onChange: (t: TabId) => void }) {
  const tabs: { id: TabId; label: string }[] = [
    { id: 'student', label: 'Students' },
    { id: 'teacher', label: 'Teachers' },
    { id: 'staff', label: 'Staff' },
    { id: 'guardian', label: 'Guardians' },
  ];
  return (
    <div className="tabs" role="tablist" aria-label="Directory type">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
          <span className="u-faint" style={{ marginLeft: 5 }}>{counts[t.id]}</span>
        </button>
      ))}
    </div>
  );
}
