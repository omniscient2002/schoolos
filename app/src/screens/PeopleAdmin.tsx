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
import { apiOnboardStatus, type OnboardStatus } from '../services/onboardingApi';
import { apiUpdateStudent, apiWithdrawStudent } from '../services/liveApi';

const ROLE_OPTIONS = ['principal', 'coordinator', 'finance', 'admissions', 'transport', 'facilities', 'technician', 'teacher', 'itadmin', 'parent'];
const ROLE_LABEL: Record<string, string> = {
  principal: 'Principal', coordinator: 'Coordinator', finance: 'Accounts (Finance)',
  admissions: 'Admissions desk', transport: 'Transport in-charge', facilities: 'Facilities',
  technician: 'Technician', teacher: 'Teacher', itadmin: 'IT admin', parent: 'Parent',
};
const GRADES = Array.from({ length: 12 }, (_, i) => String(i + 1));
const SECTIONS = ['A', 'B', 'C'];

type Pane = 'accounts' | 'transfer' | 'import' | 'lifecycle';

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

  /* owner setup checklist (Platform §1.1) — a fresh school shows what's left */
  const [setup, setSetup] = useState<OnboardStatus | null>(null);
  useEffect(() => {
    if (live.role !== 'owner') return;
    let dead = false;
    apiOnboardStatus()
      .then(r => { if (!dead) setSetup(r); })
      .catch(() => { /* checklist is optional sugar — never blocks the console */ });
    return () => { dead = true; };
  }, [live.role, tick]);

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

  /* L4-3.2 — edit + withdraw against people.admin doors (admins) */
  const [lcId, setLcId] = useState('');
  const [lcName, setLcName] = useState('');
  const [lcGuardian, setLcGuardian] = useState('');
  const [lcPhone, setLcPhone] = useState('');
  const [lcBus, setLcBus] = useState('');
  const [wdId, setWdId] = useState('');
  const [wdReason, setWdReason] = useState('');
  const [wdDate, setWdDate] = useState('');
  const [wdSchool, setWdSchool] = useState('');
  const [lcBusy, setLcBusy] = useState(false);

  const lcEdit = async () => {
    if (!lcId.trim()) { toast({ title: 'Student ID is needed', tone: 'info' }); return; }
    if (!lcName.trim() && !lcGuardian.trim() && !lcPhone.trim() && !lcBus.trim()) { toast({ title: 'Give at least one field to change', tone: 'info' }); return; }
    setLcBusy(true);
    try {
      const patch: Record<string, string> = {};
      if (lcName.trim()) patch.name = lcName.trim();
      if (lcGuardian.trim()) patch.guardian_name = lcGuardian.trim();
      if (lcPhone.trim()) patch.guardian_phone = lcPhone.trim();
      if (lcBus.trim()) patch.bus_route = lcBus.trim();
      const r = await apiUpdateStudent(lcId.trim(), patch);
      toast({ title: `${r.student.name ?? 'Student'} updated`, sub: 'The change is on the student ledger with an audit entry.', tone: 'success' });
      setLcName(''); setLcGuardian(''); setLcPhone(''); setLcBus('');
    } catch (e) { toast({ title: 'Could not update', sub: friendly(e), tone: 'error' }); }
    finally { setLcBusy(false); }
  };

  const lcWithdraw = async () => {
    if (!wdId.trim() || wdReason.trim().length < 2) { toast({ title: 'Student ID and a reason (2+ characters) are needed', tone: 'info' }); return; }
    setLcBusy(true);
    try {
      const r = await apiWithdrawStudent(wdId.trim(), {
        reason: wdReason.trim(),
        ...(wdDate ? { effective_date: wdDate } : {}),
        ...(wdSchool.trim() ? { last_school: wdSchool.trim() } : {}),
      });
      toast({ title: `${r.student.name ?? 'Student'} withdrawn`, sub: r.note ?? 'Records kept · bus seat released.', tone: 'success' });
      setWdId(''); setWdReason(''); setWdDate(''); setWdSchool('');
    } catch (e) { toast({ title: 'Withdrawal refused', sub: friendly(e), tone: 'error' }); }
    finally { setLcBusy(false); }
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

      {setup && !setup.checklist.every(c => c.done) && (
        <Card style={{ marginBottom: 'var(--s-4)' }} head="Setting up your school" sub="Tick these off and your school is fully running — your IT admin can help with all of them.">
          <div style={{ display: 'grid', gap: 8 }}>
            {setup.checklist.map(c => (
              <a key={c.id} href={c.href} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
                <span style={{
                  width: 20, height: 20, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
                  border: `1.5px solid ${c.done ? 'var(--ok, #1a7f37)' : 'var(--line)'}`,
                  background: c.done ? 'var(--ok-weak, rgba(26,127,55,.12))' : 'transparent',
                  color: 'var(--ok, #1a7f37)', fontSize: 12,
                }}>{c.done ? '✓' : ''}</span>
                <span style={{ fontSize: 13.5, color: c.done ? 'var(--text-2)' : 'var(--text-1)', textDecoration: c.done ? 'line-through' : 'none' }}>{c.label}</span>
                {!c.done && <span style={{ marginLeft: 'auto', color: 'var(--accent-text)', fontSize: 12.5, fontWeight: 600 }}>Go →</span>}
              </a>
            ))}
          </div>
        </Card>
      )}

      <div className="seg" role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 'var(--s-4)' }}>
        {([['accounts', 'Accounts'], ['transfer', 'Change a class'], ['import', 'Import students'], ['lifecycle', 'Edit / withdraw']] as [Pane, string][])
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

      {pane === 'lifecycle' && (
        <Card headAs="h2" head="Edit a record · withdraw a student" sub="Direct actions on the student ledger (people.admin doors). Withdrawal keeps attendance, fees and guardian links; the bus seat is released and the action is audited.">
          {!['owner', 'principal', 'coordinator'].includes(live.role) ? (
            <Empty title="Owner, Principal or Coordinator only" />
          ) : (
            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
              <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                <strong style={{ fontSize: 14 }}>Edit record</strong>
                <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13, opacity: 0.75 }}>Student ID</span>
                  <input value={lcId} onChange={e => setLcId(e.target.value)} placeholder="uuid from the People screen" aria-label="Student ID" /></label>
                <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13, opacity: 0.75 }}>Name</span>
                  <input value={lcName} onChange={e => setLcName(e.target.value)} aria-label="Name" /></label>
                <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13, opacity: 0.75 }}>Guardian name</span>
                  <input value={lcGuardian} onChange={e => setLcGuardian(e.target.value)} aria-label="Guardian name" /></label>
                <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13, opacity: 0.75 }}>Guardian phone</span>
                  <input value={lcPhone} onChange={e => setLcPhone(e.target.value)} aria-label="Guardian phone" /></label>
                <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13, opacity: 0.75 }}>Bus route</span>
                  <input value={lcBus} onChange={e => setLcBus(e.target.value)} aria-label="Bus route" /></label>
                <div><Button onClick={lcEdit} disabled={lcBusy}>{lcBusy ? 'Saving…' : 'Save changes'}</Button></div>
                <span style={{ fontSize: 12, opacity: 0.65 }}>Class and section changes go through “Change a class” so the move lands in history.</span>
              </div>
              <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                <strong style={{ fontSize: 14 }}>Withdraw / transfer out</strong>
                <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13, opacity: 0.75 }}>Student ID</span>
                  <input value={wdId} onChange={e => setWdId(e.target.value)} placeholder="uuid from the People screen" aria-label="Student ID to withdraw" /></label>
                <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13, opacity: 0.75 }}>Reason (goes on the record)</span>
                  <input value={wdReason} onChange={e => setWdReason(e.target.value)} placeholder="e.g. family relocated" aria-label="Withdrawal reason" /></label>
                <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13, opacity: 0.75 }}>Effective date (optional)</span>
                  <input type="date" value={wdDate} onChange={e => setWdDate(e.target.value)} aria-label="Effective date" /></label>
                <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13, opacity: 0.75 }}>Last school (optional)</span>
                  <input value={wdSchool} onChange={e => setWdSchool(e.target.value)} aria-label="Last school" /></label>
                <div><Button variant="danger" onClick={lcWithdraw} disabled={lcBusy}>{lcBusy ? 'Working…' : 'Withdraw'}</Button></div>
                <span style={{ fontSize: 12, opacity: 0.65 }}>Owner or Principal only. Cannot be undone from the app — re-admission creates a fresh record.</span>
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
