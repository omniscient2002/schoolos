/* ============================================================
   People — the school directory.
   Students · Teachers · Staff · Guardians, with search,
   scoped filters and role-aware stats.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as seed from '../data/dataset';
import { peopleService } from '../services';
import { useStore } from '../state/store';
import {
  Avatar, Badge, Button, Card, DataTable, Empty, ErrorState, Modal, PageHead, Skeleton, Stat, useToast,
} from '../components/ui';
import { Sparkline } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtDate, fmtMoneyShort, fmtPct } from '../lib/format';
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
const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const campusShort = (id: string) => seed.campuses.find(c => c.id === id)?.shortName ?? id;

function classTeacherName(p: Person) {
  const sec = seed.sectionOfStudent(p);
  return sec ? seed.findPerson(sec.classTeacherId)?.name ?? '—' : '—';
}

function attendanceBadge(p: Person) {
  const r = seed.studentAttendanceRate(p.id);
  const label = fmtPct(r.rate, 1);
  if (r.rate >= 95) return <Badge tone="success">{label}</Badge>;
  if (r.rate >= 85) return <Badge tone="neutral">{label}</Badge>;
  if (r.rate >= 75) return <Badge tone="warning">{label}</Badge>;
  return <Badge tone="danger">{label}</Badge>;
}

function feeBadge(p: Person) {
  const f = seed.studentFeeSummary(p.id);
  if (f.hasFailed) return <Badge tone="danger">Failed</Badge>;
  if (f.overdue > 0) return <Badge tone="warning">Overdue {fmtMoneyShort(f.overdue)}</Badge>;
  if (f.due > 0) return <Badge tone="info">Due {fmtMoneyShort(f.due)}</Badge>;
  return <Badge tone="success">Paid</Badge>;
}

function csvCell(v: string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

export default function People() {
  const navigate = useNavigate();
  const { session, dispatch, actorName } = useStore();
  const toast = useToast();

  const scopeLocked = session.campusScope !== 'all';
  const [tab, setTab] = useState<TabId>('student');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [campus, setCampus] = useState<string>(session.activeCampus);
  const [grade, setGrade] = useState('all');
  const [klass, setKlass] = useState('all');
  const [visible, setVisible] = useState(15);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'student', campus: session.activeCampus as string, phone: '' });
  const [saving, setSaving] = useState(false);

  /* keep campus in sync with role scope */
  useEffect(() => { if (scopeLocked) setCampus(session.campusScope); }, [scopeLocked, session.campusScope]);

  /* debounced search query */
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  /* reset dependent filters when the tab or scope changes */
  useEffect(() => { setGrade('all'); setKlass('all'); setVisible(15); }, [tab]);
  useEffect(() => { setVisible(15); }, [debounced, campus, grade, klass]);

  const results = useAsync<Person[]>(
    () => peopleService.search(debounced, { campus, type: tab, grade }),
    [debounced, campus, tab, grade],
  );

  const rows = useMemo(() => {
    const data = results.data ?? [];
    return klass === 'all' ? data : data.filter(p => p.classes?.includes(klass));
  }, [results.data, klass]);
  const shown = rows.slice(0, visible);

  const counts = useMemo(() => {
    const inScope = (arr: Person[]) => arr.filter(p => campus === 'all' || p.campus === campus);
    return {
      student: inScope(seed.students).length,
      teacher: inScope(seed.teachers).length,
      staff: inScope(seed.staff).length,
      guardian: inScope(seed.guardians).length,
    };
  }, [campus]);

  const presence = useMemo(() => {
    const ids = new Set(seed.students.filter(p => campus === 'all' || p.campus === campus).map(p => p.id));
    const daily = seed.TERM_DAYS.map(d => {
      const t = d.getTime();
      let non = 0;
      seed.attendance.forEach(a => {
        if (a.date.getTime() === t && ids.has(a.studentId) && (a.status === 'absent' || a.status === 'late')) non++;
      });
      return ids.size ? ((ids.size - non) / ids.size) * 100 : 0;
    });
    const avg = daily.length ? daily.reduce((a, b) => a + b, 0) / daily.length : 0;
    return { daily, avg };
  }, [campus]);

  const classOptions = useMemo(() => {
    const set = new Set<string>();
    seed.teachers.filter(t => campus === 'all' || t.campus === campus).forEach(t => t.classes?.forEach(c => set.add(c)));
    return [...set].sort((a, b) => (Number(a.split('-')[0]) || 0) - (Number(b.split('-')[0]) || 0) || a.localeCompare(b));
  }, [campus]);

  const wardsOf = (gid: string) =>
    seed.guardianLinks.filter(l => l.guardianId === gid)
      .map(l => seed.findPerson(l.studentId)?.name)
      .filter((w): w is string => Boolean(w))
      .slice(0, 2)
      .join(', ');

  const guardianVerified = (gid: string) => {
    const links = seed.guardianLinks.filter(l => l.guardianId === gid);
    if (!links.length) return null;
    return links.every(l => l.verified);
  };

  const detailOf = (p: Person) => {
    if (p.type === 'student') return `${p.grade}-${p.section} · ${p.admissionNo ?? ''}`;
    return p.role ?? '';
  };

  const exportCsv = () => {
    try {
      const head = 'Name,Type,Campus,Email,Phone,Detail';
      const lines = rows.map(p => [p.name, p.type, campusShort(p.campus), p.email, p.phone, detailOf(p)].map(csvCell).join(','));
      const blob = new Blob([`${head}\n${lines.join('\n')}`], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meridian-directory-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Exported ${rows.length} records`, sub: 'CSV downloaded — opens in any spreadsheet.', tone: 'success' });
    } catch {
      toast({ title: 'Export failed', sub: 'The browser blocked the file download.', tone: 'error' });
    }
  };

  const submitPerson = () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setTimeout(() => {
      dispatch({
        type: 'audit/add',
        entry: {
          actor: actorName, actorRole: session.roleId, action: 'Requested new directory record',
          recordType: 'Person', recordRef: `${form.name.trim()} (${form.type})`, reason: 'Front-office intake',
          aiInvolved: false, risk: 'low', outcome: 'Queued for verification',
        },
      });
      toast({ title: 'Record request logged', sub: `${form.name.trim()} appears after office verification — demo data is read-only.`, tone: 'success' });
      setSaving(false);
      setAddOpen(false);
      setForm({ name: '', type: 'student', campus: session.activeCampus as string, phone: '' });
    }, 420);
  };

  const scopeWord = campus === 'all' ? 'all campuses' : campusShort(campus);

  return (
    <>
      <PageHead
        title="Directory"
        sub={`Students, teachers, staff and guardians across ${scopeWord} — one record per person, verified contacts first.`}
        actions={
          <>
            <Button variant="secondary" icon={<Icon.Download size={14} />} onClick={exportCsv}>Export CSV</Button>
            <Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setAddOpen(true)}>Add person</Button>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Total students" value={counts.student.toLocaleString('en-IN')} sub={`${counts.student} in ${scopeWord}`} onClick={() => setTab('student')} />
        <Stat label="Staff & teachers" value={counts.teacher + counts.staff} sub={`${counts.teacher} teaching · ${counts.staff} administrative`} onClick={() => setTab('teacher')} />
        <Stat label="Guardians" value={counts.guardian.toLocaleString('en-IN')} sub={`${Math.round((counts.guardian / Math.max(1, counts.student)) * 10) / 10} per student on average`} onClick={() => setTab('guardian')} />
        <Stat label="Avg attendance" value={fmtPct(presence.avg, 1)} sub="Last 30 school days" spark={<Sparkline points={presence.daily} width={84} height={26} />} />
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
            <select
              className="select" style={{ width: 180 }} value={campus}
              onChange={e => setCampus(e.target.value)} aria-label="Filter by campus"
              disabled={scopeLocked}
              title={scopeLocked ? `Your role is scoped to ${campusShort(session.campusScope)}` : undefined}
            >
              {scopeLocked
                ? <option value={session.campusScope}>{campusShort(session.campusScope)} · your scope</option>
                : <>
                    <option value="all">All campuses</option>
                    {seed.campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </>}
            </select>
            {tab === 'student' && (
              <select className="select" style={{ width: 140 }} value={grade} onChange={e => setGrade(e.target.value)} aria-label="Filter by grade">
                <option value="all">All grades</option>
                {GRADES.map(g => <option key={g} value={String(g)}>Grade {g}</option>)}
              </select>
            )}
            {tab === 'teacher' && classOptions.length > 0 && (
              <select className="select" style={{ width: 140 }} value={klass} onChange={e => setKlass(e.target.value)} aria-label="Filter by class">
                <option value="all">All classes</option>
                {classOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <TabsRow tab={tab} counts={counts} onChange={setTab} />
          </div>
        </Card>
      </div>

      <Card pad={false} className="u-col">
        <div className="card-head">
          <h3>{TYPE_LABEL[tab]} · {scopeWord}</h3>
          <span className="u-small u-faint">
            {results.loading ? 'Searching…' : `Showing ${shown.length} of ${rows.length} · search returns up to 60`}
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
          ) : rows.length === 0 ? (
            <Empty
              icon={<Icon.Search size={26} />}
              title={debounced ? `No people match “${debounced}”` : `No ${TYPE_LABEL[tab].toLowerCase()} in ${scopeWord}`}
              sub="Try a shorter name, or clear the campus, grade and class filters."
              action={
                <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={() => { setQuery(''); setDebounced(''); setGrade('all'); setKlass('all'); }}>
                  Clear search & filters
                </Button>
              }
            />
          ) : (
            <>
              <DataTable<Person>
                caption="Student and staff directory — filter by campus or grade"
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
                          <div className="u-xs u-faint u-truncate">{p.email}</div>
                        </div>
                      </div>
                    ),
                  },
                  ...(tab === 'student' ? [
                    { key: 'grade', label: 'Grade · Sec', sortable: true, sortValue: (p: Person) => p.grade ?? 999, render: (p: Person) => <span className="tnum">{p.grade} · {p.section}</span> },
                    { key: 'ct', label: 'Class teacher', render: (p: Person) => <span className="u-truncate" style={{ maxWidth: 140, display: 'inline-block' }}>{classTeacherName(p)}</span> },
                    { key: 'att', label: 'Attendance', render: (p: Person) => attendanceBadge(p) },
                    { key: 'fee', label: 'Fees', render: (p: Person) => feeBadge(p) },
                  ] : []),
                  ...(tab === 'teacher' ? [
                    { key: 'role', label: 'Role', render: (p: Person) => p.role ?? '—' },
                    { key: 'subjects', label: 'Subjects', render: (p: Person) => <span className="u-truncate" style={{ maxWidth: 180, display: 'inline-block' }}>{p.subjects?.join(' · ') ?? '—'}</span> },
                    { key: 'classes', label: 'Classes', render: (p: Person) => <span className="tnum">{p.classes?.join(', ') ?? '—'}</span> },
                    { key: 'joined', label: 'Joined', render: (p: Person) => <span className="u-small u-muted">{p.joinedOn ? fmtDate(p.joinedOn) : '—'}</span> },
                  ] : []),
                  ...(tab === 'staff' ? [
                    { key: 'role', label: 'Role', render: (p: Person) => p.role ?? '—' },
                    { key: 'phone', label: 'Phone', render: (p: Person) => <span className="mono u-small">{p.phone}</span> },
                    { key: 'joined', label: 'Joined', render: (p: Person) => <span className="u-small u-muted">{p.joinedOn ? fmtDate(p.joinedOn) : '—'}</span> },
                  ] : []),
                  ...(tab === 'guardian' ? [
                    { key: 'relation', label: 'Relation', render: (p: Person) => p.role ?? 'Guardian' },
                    { key: 'wards', label: 'Ward(s)', render: (p: Person) => <span className="u-truncate" style={{ maxWidth: 170, display: 'inline-block' }}>{wardsOf(p.id) || '—'}</span> },
                    { key: 'phone', label: 'Phone', render: (p: Person) => <span className="mono u-small">{p.phone}</span> },
                    {
                      key: 'verified', label: 'WhatsApp',
                      render: (p: Person) => {
                        const v = guardianVerified(p.id);
                        if (v === null) return <span className="u-faint">—</span>;
                        return v ? <Badge tone="success" dot>Verified</Badge> : <Badge tone="warning" dot>Unverified</Badge>;
                      },
                    },
                  ] : []),
                  { key: 'campus', label: 'Campus', render: (p: Person) => <span className="u-small u-muted">{campusShort(p.campus)}</span> },
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
        title="Add a person to the directory"
        sub="Requests are logged to the audit trail and completed by the front office after verification."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={14} />} loading={saving} disabled={!form.name.trim()} onClick={submitPerson}>
              Log request
            </Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="np-name">Full name</label>
          <input id="np-name" className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Meera Nair" />
        </div>
        <div className="u-flex" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="field u-grow" style={{ minWidth: 150 }}>
            <label htmlFor="np-type">Record type</label>
            <select id="np-type" className="select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              <option value="staff">Staff</option>
              <option value="guardian">Guardian</option>
            </select>
          </div>
          <div className="field u-grow" style={{ minWidth: 150 }}>
            <label htmlFor="np-campus">Campus</label>
            <select id="np-campus" className="select" value={form.campus} onChange={e => setForm(f => ({ ...f, campus: e.target.value }))} disabled={scopeLocked}>
              {seed.campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="np-phone">Phone (optional)</label>
          <input id="np-phone" className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 98…" />
          <span className="hint">Numbers are WhatsApp-verified before absence alerts are enabled (Attendance §1.1).</span>
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
