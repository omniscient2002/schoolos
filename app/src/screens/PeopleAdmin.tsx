/* ============================================================
   PeopleAdmin — the school office console for PEOPLE (live).
   Every operation here is a real server door (people.admin):
   - Provision a user (owner/itadmin) — temp password shown ONCE
   - Suspend / re-activate an account (login refuses while off)
   - Reset a password (new temp password shown ONCE)
   - Move a student to another class (writes enrollment history)
   - Import students from a CSV file with a per-row report
   Non-technical-first: plain-language labels, one action per card,
   every destructive step asks for confirmation, every secret is
   shown once with a copy button.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import {
  PageHead, Card, Badge, Button, useToast, Empty, ErrorState, SkeletonCard, DataTable,
} from '../components/ui';
import { friendly } from '../lib/friendlyErrors';
import { useSession } from '../App';
import {
  adminListUsers, adminCreateUser, adminSuspendUser, adminActivateUser,
  adminResetPassword, adminTransferStudent, adminImportStudents,
  type AdminUser, type ImportReport, type ImportOkRow, type ImportFailRow,
} from '../services/adminApi';

const ROLE_OPTIONS = ['principal', 'coordinator', 'finance', 'admissions', 'transport', 'facilities', 'technician', 'teacher', 'itadmin', 'parent'];
const ROLE_LABEL: Record<string, string> = {
  principal: 'Principal', coordinator: 'Coordinator', finance: 'Accounts (Finance)',
  admissions: 'Admissions desk', transport: 'Transport in-charge', facilities: 'Facilities',
  technician: 'Technician', teacher: 'Teacher', itadmin: 'IT admin', parent: 'Parent',
};
const GRADES = Array.from({ length: 12 }, (_, i) => String(i + 1));
const SECTIONS = ['A', 'B', 'C'];

type Pane = 'accounts' | 'transfer' | 'import';

export default function PeopleAdmin() {
  const toast = useToast();
  const live = useSession();
  const canAdmin = ['owner', 'itadmin'].includes(live.role);

  const [pane, setPane] = useState<Pane>('accounts');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /* create-account form */
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('teacher');
  const [creating, setCreating] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  /* transfer form */
  const [studentId, setStudentId] = useState('');
  const [toGrade, setToGrade] = useState('');
  const [toSection, setToSection] = useState('');
  const [reason, setReason] = useState('');
  const [transferring, setTransferring] = useState(false);

  /* import */
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  useEffect(() => {
    let dead = false;
    setLoading(true); setError(null);
    adminListUsers()
      .then(r => { if (!dead) { setUsers(r.users); setLoading(false); } })
      .catch(e => { if (!dead) { setError(friendly(e)); setLoading(false); } });
    return () => { dead = true; };
  }, [tick]);

  const create = async () => {
    if (!name.trim() || !email.trim()) { toast({ title: 'Name and email are both needed', tone: 'info' }); return; }
    setCreating(true);
    try {
      const r = await adminCreateUser({ name: name.trim(), email: email.trim(), role });
      setTempPassword({ email: r.user.email ?? email.trim(), password: r.tempPassword });
      setName(''); setEmail('');
      toast({ title: 'Account created', sub: `${ROLE_LABEL[role] ?? role} · share the one-time password now`, tone: 'success' });
      setTick(t => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setCreating(false); }
  };

  const toggleActive = async (u: AdminUser) => {
    if (u.active && !window.confirm(`Suspend ${u.name}'s account? They will not be able to sign in until re-activated.`)) return;
    try {
      if (u.active) await adminSuspendUser(u.id, 'suspended from People console');
      else await adminActivateUser(u.id);
      toast({ title: u.active ? `${u.name} suspended` : `${u.name} re-activated`, tone: 'success' });
      setTick(t => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  const resetPw = async (u: AdminUser) => {
    if (!window.confirm(`Generate a new password for ${u.name}? Their current password stops working immediately.`)) return;
    try {
      const r = await adminResetPassword(u.id);
      setTempPassword({ email: u.email, password: r.tempPassword });
      toast({ title: 'New one-time password issued', tone: 'success' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  const transfer = async () => {
    if (!studentId.trim() || !toGrade || !toSection) { toast({ title: 'Student ID, new class and section are all needed', tone: 'info' }); return; }
    if (!window.confirm(`Move student ${studentId} to Class ${toGrade}-${toSection}? The change is recorded in their history.`)) return;
    setTransferring(true);
    try {
      const r = await adminTransferStudent(studentId.trim(), { toGrade, toSection, reason: reason.trim() || undefined });
      toast({ title: `${r.student.name} moved to ${toGrade}-${toSection}`, sub: 'History entry saved', tone: 'success' });
      setStudentId(''); setToGrade(''); setToSection(''); setReason('');
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setTransferring(false); }
  };

  const runImport = async (file: File) => {
    setImporting(true); setReport(null);
    try {
      const text = await file.text();
      const r = await adminImportStudents(text);
      setReport(r);
      toast({ title: `Import finished: ${r.ok.length} added, ${r.failed.length} skipped`, tone: r.failed.length ? "info" : "success" });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <PageHead
        title="People console"
        sub="Create accounts, suspend or restore access, move students between classes, and bring in students from a spreadsheet"
        actions={<Badge tone="accent" dot>people.admin</Badge>}
      />

      <div className="seg" role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 'var(--s-4)' }}>
        {([['accounts', 'Accounts'], ['transfer', 'Change a class'], ['import', 'Import students']] as [Pane, string][])
          .map(([id, label]) => (
            <button key={id} role="tab" aria-selected={pane === id}
              onClick={() => setPane(id)}
              style={{
                padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${pane === id ? 'var(--accent)' : 'var(--line)'}`,
                background: pane === id ? 'var(--accent-soft, rgba(0,0,0,0.04))' : 'transparent',
                fontWeight: pane === id ? 600 : 400,
              }}>{label}</button>
          ))}
      </div>

      {pane === 'accounts' && (
        <>
          <Card headAs="h2" head="Create an account" sub="A one-time password is generated — share it in person. The person changes it at first sign-in.">
            {!canAdmin ? (
              <Empty title="Owner or IT admin only" sub="Ask the owner or IT admin to create accounts." />
            ) : (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>Full name</span>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sunita Rao" aria-label="Full name" />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>Email (used to sign in)</span>
                  <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="sunita@school.edu" aria-label="Email" />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>Role in the school</span>
                  <select value={role} onChange={e => setRole(e.target.value)} aria-label="Role">
                    {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </label>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <Button onClick={create} disabled={creating}>{creating ? 'Creating…' : 'Create account'}</Button>
                </div>
              </div>
            )}
            {tempPassword && (
              <div style={{ marginTop: 14, padding: 14, borderRadius: 10, border: '1px solid var(--warning)', background: 'var(--warning-soft, rgba(255,190,0,0.08))' }}>
                <strong>One-time password for {tempPassword.email}</strong>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                  <code style={{ fontSize: 16, letterSpacing: 1 }}>{tempPassword.password}</code>
                  <Button variant="ghost" onClick={() => { navigator.clipboard?.writeText(tempPassword.password); toast({ title: 'Copied', tone: 'info' }); }}>Copy</Button>
                  <Button variant="ghost" onClick={() => setTempPassword(null)}>Dismiss (it will not be shown again)</Button>
                </div>
              </div>
            )}
          </Card>

          <Card headAs="h2" head="All accounts" sub="Suspension blocks sign-in instantly; the person's data is kept.">
            {loading ? <SkeletonCard /> : error ? <ErrorState title="Could not load" sub={error?.replace('Error: ', '')} onRetry={() => setTick(t => t + 1)} /> :
              !users?.length ? <Empty title="No accounts yet" /> : (
                <DataTable
                  columns={[
                    { key: 'name', label: 'Name' },
                    { key: 'role', label: 'Role' },
                    { key: 'email', label: 'Sign-in email' },
                    { key: 'status', label: 'Status', render: (u: AdminUser) => u.active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge> },
                    { key: 'actions', label: 'Actions', render: (u: AdminUser) => (
                      <span style={{ display: 'flex', gap: 8 }}>
                        {canAdmin && (
                          <>
                            <Button variant="ghost" onClick={() => toggleActive(u)}>{u.active ? 'Suspend' : 'Re-activate'}</Button>
                            {u.active && <Button variant="ghost" onClick={() => resetPw(u)}>Reset password</Button>}
                          </>
                        )}
                      </span>
                    ) },
                  ]}
                  rows={users}
                  rowKey={(u: AdminUser) => u.id}
                />
              )}
          </Card>
        </>
      )}

      {pane === 'transfer' && (
        <Card headAs="h2" head="Change a student's class" sub="Use when a student moves to a different class or section. Past attendance, fees and results stay untouched; the move is recorded in the student's history.">
          {!['owner', 'principal', 'coordinator'].includes(live.role) ? (
            <Empty title="Owner, Principal or Coordinator only" sub="Class changes are a school-office decision." />
          ) : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 13, opacity: 0.75 }}>Student ID (from the People screen)</span>
                <input value={studentId} onChange={e => setStudentId(e.target.value)} placeholder="STU-…" aria-label="Student ID" />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 13, opacity: 0.75 }}>New class</span>
                <select value={toGrade} onChange={e => setToGrade(e.target.value)} aria-label="New class">
                  <option value="">Select…</option>
                  {GRADES.map(g => <option key={g} value={g}>Class {g}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 13, opacity: 0.75 }}>New section</span>
                <select value={toSection} onChange={e => setToSection(e.target.value)} aria-label="New section">
                  <option value="">Select…</option>
                  {SECTIONS.map(s => <option key={s} value={s}>Section {s}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 13, opacity: 0.75 }}>Reason (optional)</span>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. section balancing" aria-label="Reason" />
              </label>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <Button onClick={transfer} disabled={transferring}>{transferring ? 'Moving…' : 'Move student'}</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {pane === 'import' && (
        <Card headAs="h2" head="Bring in students from a spreadsheet" sub="CSV with a header row: name,grade,section,admission_no,guardian_name,guardian_phone — only the first three are required. You get a line-by-line report; nothing half-lands.">
          {!['owner', 'principal', 'coordinator', 'admissions'].includes(live.role) ? (
            <Empty title="School office roles only" />
          ) : (
            <>
              <input
                ref={fileRef} type="file" accept=".csv,text/csv"
                onChange={e => { const f = e.target.files?.[0]; if (f) void runImport(f); }}
                disabled={importing} aria-label="CSV file with students"
                style={{ display: 'block', margin: '10px 0' }}
              />
              {importing && <SkeletonCard />}
              {report && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                    <Badge tone="success">Added: {report.ok.length}</Badge>
                    <Badge tone={report.failed.length ? 'danger' : 'neutral'}>Skipped: {report.failed.length}</Badge>
                    <Badge tone="info">Read: {report.total}</Badge>
                  </div>
                  {report.ok.length > 0 && (
                    <DataTable
                      columns={[
                        { key: 'row', label: 'Row' },
                        { key: 'name', label: 'Name' },
                        { key: 'adm', label: 'Admission no.' },
                      ]}
                      rows={report.ok}
                      rowKey={(r: ImportOkRow) => `ok-${r.row}`}
                    />
                  )}
                  {report.failed.length > 0 && (
                    <DataTable
                      columns={[
                        { key: 'row', label: 'Row' },
                        { key: 'err', label: 'Problem' },
                      ]}
                      rows={report.failed}
                      rowKey={(r: ImportFailRow) => `fail-${r.row}`}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
