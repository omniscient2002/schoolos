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
import { Link } from 'react-router-dom';
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
import { apiOnboardStatus, apiSchoolClasses, type OnboardStatus, type SchoolClass } from '../services/onboardingApi';
import { apiGet, apiPost, apiCreateFeeHead, apiUpdateStudent, apiWithdrawStudent, apiStudents } from '../services/liveApi';
import { PROVISIONABLE_ROLES } from '../lib/roles';
import { roleLabel, pluginLabel, classLabel, gradeLabel } from '../lib/labels';
import { useRoleOrGrant, useLiveRole } from '../lib/access';

/* One declaration of what a school can appoint: `PROVISIONABLE_ROLES` (lib/roles.ts) is
   KNOWN_ROLES minus `owner`, because owners are created at tenant bootstrap and nowhere else —
   the server refuses to provision one here (ROLES_NO_OWNER), so the option must not exist either.
   `student` used to be filtered out of this list as well "by design", and that decision had no
   second door behind it: the server issues the role and ~20 `/student/*` doors exist, so the entire
   student portal had no possible user (G-1). A pupil's portal account is now created from the
   roster, where the school actually is — see "Give a pupil a portal account" below.
   `server/tests/frontend-grants.test.js` fails if this list and the server's roles disagree, and it
   asserts `roleLabel()` returns a human name for every one of them (PRE-1). */
const ROLE_OPTIONS = PROVISIONABLE_ROLES;
/* Classes and sections are NOT hardcoded: the school defines them on the Classes & sections
   screen (owner/principal/IT admin) and this console reads that one list. */

type Pane = 'accounts' | 'transfer' | 'import' | 'lifecycle';

export default function PeopleAdmin() {
  const toast = useToast();
  const live = useSession();
  /* FEX-4/FEX-7: the people.admin authority sets plus any custom-role mask granting the door.
     The server's require(...ADMIN / ...ROSTER) re-decides every write. */
  const canAdmin = useRoleOrGrant(['owner', 'itadmin'], ['GET /plugins/people.admin/users', 'POST /plugins/people.admin/users']);
  const canRoster = useRoleOrGrant(['owner', 'principal', 'coordinator'],
    ['POST /plugins/people.admin/students/:id/transfer', 'PATCH /plugins/people.admin/students/:id']);
  /* P2-4 guard: withdrawal is a DIFFERENT authority from a class transfer — the withdraw door admits
     owner and principal only, while transfer and edit also admit a coordinator. One combined list put the
     withdraw form in front of a coordinator who would be refused by the server. */
  const canWithdraw = useRoleOrGrant(['owner', 'principal'], ['POST /plugins/people.admin/students/:id/withdraw']);
  /* The server can never admit a principal appointment from a non-owner
     (audited 403 regardless of custom masks — the handler checks the built-in
     role, not the grant), so offering it is a guaranteed refusal. Hide it. */
  const liveRole = useLiveRole();
  const roleOptions = liveRole === 'owner' ? ROLE_OPTIONS : ROLE_OPTIONS.filter(r => r !== 'principal');
  const canImport = useRoleOrGrant(['owner', 'principal', 'coordinator', 'admissions', 'itadmin'],
    ['POST /plugins/people.admin/import/students']);

  const [pane, setPane] = useState<Pane>('accounts');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /* create-account form */
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('teacher');
  const [phone, setPhone] = useState('');
  const [childId, setChildId] = useState('');
  const [roster, setRoster] = useState<{ id: string; name: string; grade?: string; section?: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  /* transfer form */
  const [studentId, setStudentId] = useState('');
  const [toGrade, setToGrade] = useState('');
  const [toSection, setToSection] = useState('');
  const [reason, setReason] = useState('');
  const [transferring, setTransferring] = useState(false);
  /* the school's configured classes & sections (owner/principal/IT admin define them) */
  const [classes, setClasses] = useState<SchoolClass[]>([]);

  /* import */
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  /* owner setup checklist (Platform §1.1) — a fresh school shows what's left */
  const [setup, setSetup] = useState<OnboardStatus | null>(null);

  /* 0.3 size presets — guided setup. Selecting a size only sets local state
     and previews what Apply will do; Apply itself enables/disables modules via
     GET /plugins + POST /plugins/:id/enable|disable and creates the 3 standard
     fee heads via POST /fees/heads (409 already-exists is fine). */
  type SizePreset = 'small' | 'standard' | 'large';
  const SMALL_ON = ['people.admin', 'ops.visitors', 'ops.timetable', 'files.store', 'library', 'admissions.funnel', 'exams.assessment'];
  const STANDARD_ON = [...SMALL_ON, 'transport.gps', 'teacher.classroom', 'parent.assistant', 'pack.cbse', 'pack.dpdp'];
  /* Full per-tenant registry (server/src/plugin-catalog.js CATALOG): Large = all on. */
  const ALL_ON = ['accounting.tally', 'ops.udise', 'ops.import', 'ops.bi', 'admissions.funnel', 'comms.whatsapp', 'coord.view', 'exams.assessment', 'family.view', 'files.store', 'health.clinic', 'hr.leave', 'library', 'ops.timetable', 'ops.visitors', 'pack.cbse', 'pack.dpdp', 'parent.assistant', 'payments.razorpay', 'payments.upi', 'rails.email', 'rails.sms', 'rails.whatsapp', 'people.admin', 'student.world', 'teacher.classroom', 'teacher.copilot', 'teacher.support', 'transport.gps'];
  const PRESET_ON: Record<SizePreset, string[]> = { small: SMALL_ON, standard: STANDARD_ON, large: ALL_ON };
  const PRESET_LABEL: Record<SizePreset, string> = { small: 'Small (≤500 pupils)', standard: 'Standard', large: 'Large' };
  const PRESET_WILL: Record<SizePreset, string> = {
    small: 'Keeps 7 essentials on — People console, Visitors gate pass, Timetable, Documents, Library, Admissions funnel, Exams — and switches the other 22 off.',
    standard: 'Keeps the Small 7 plus Bus tracking, Teacher classroom, Parent assistant, CBSE pack and DPDP pack (12 on) — switches the other 17 off.',
    large: 'Switches all 29 modules on.',
  };
  /* The door's unique key is (tenant, name); the short codes ride as the ledger name. */
  const STANDARD_HEADS = [
    { name: 'Tuition', category: 'Tuition', glLedgerName: 'TUIT' },
    { name: 'Transport', category: 'Transport', glLedgerName: 'TRANS' },
    { name: 'Activity', category: 'Activity', glLedgerName: 'ACT' },
  ];
  const [sizePreset, setSizePreset] = useState<SizePreset>('standard');
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  const applyPreset = async () => {
    const want = new Set(PRESET_ON[sizePreset]);
    if (!window.confirm(`Apply the ${PRESET_LABEL[sizePreset]} setup? ${want.size} modules will be switched on, the rest switched off (switching off asks for your password once and hands open items back to the principal), and 3 standard fee heads will be created. You can change every switch afterwards.`)) return;
    setApplying(true); setApplyMsg(null);
    try {
      const reg = await apiGet<{ plugins: { plugin_id: string; enabled: boolean }[] }>('/plugins');
      const current = new Map(reg.plugins.map(p => [p.plugin_id, p.enabled]));
      const toEnable = [...want].filter(id => !current.get(id));
      const toDisable = [...current.entries()].filter(([id, on]) => on && !want.has(id)).map(([id]) => id);
      let enabled = 0, disabled = 0, heads = 0, headsExisted = 0;
      const errs: string[] = [];
      for (const id of toEnable) {
        try { await apiPost(`/plugins/${id}/enable`, {}); enabled++; }
        catch (e) { errs.push(`${id}: ${friendly(e)}`); }
      }
      for (const id of toDisable) {
        try { await apiPost(`/plugins/${id}/disable`, {}); disabled++; }
        catch (e) { errs.push(`${id}: ${friendly(e)}`); }
      }
      for (const h of STANDARD_HEADS) {
        try { await apiCreateFeeHead({ name: h.name, category: h.category, glLedgerName: h.glLedgerName }); heads++; }
        catch (e) {
          const status = (e as { status?: number }).status;
          if (status === 409 || /already exists/i.test((e as Error).message)) headsExisted++;
          else errs.push(`${h.name}: ${friendly(e)}`);
        }
      }
      setApplyMsg(`Done: ${enabled} switched on, ${disabled} switched off, ${heads + headsExisted} fee heads ready${headsExisted ? ` (${headsExisted} already existed)` : ''}.${errs.length ? ` ${errs.length} need attention: ${errs.join('; ')}` : ''}`);
      toast({ title: errs.length ? 'Setup applied with warnings' : 'Setup applied', sub: `${enabled} on · ${disabled} off · ${heads + headsExisted} fee heads`, tone: errs.length ? 'info' : 'success' });
      setTick(t => t + 1);
    } catch (e) { setApplyMsg(`Could not apply: ${friendly(e)}`); toast({ title: 'Setup not applied', sub: friendly(e), tone: 'error' }); }
    finally { setApplying(false); }
  };
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

  useEffect(() => {
    let dead = false;
    apiSchoolClasses()
      .then(r => { if (!dead) setClasses(r.classes ?? []); })
      .catch(() => { /* class pickers degrade to empty; the transfer pane points at /classes */ });
    return () => { dead = true; };
  }, [tick]);

  /* The roster, for the two pickers that need a real child: "who is this parent's child" (G-2) and
     "which pupil gets a portal account" (G-1). Read once per refresh, kept as id+name only — this
     console has no business holding the whole roster in component state. */
  useEffect(() => {
    let dead = false;
    if (!canAdmin && !canRoster) return () => { dead = true; };
    apiStudents({ limit: '500' })
      .then(r => {
        if (dead) return;
        setRoster((r.students ?? []).map((s: Record<string, unknown>) => ({
          id: String(s.id), name: String(s.name),
          grade: s.grade == null ? undefined : String(s.grade),
          section: s.section == null ? undefined : String(s.section),
        })));
      })
      .catch(() => { /* the pickers degrade to a typed id; the doors still validate */ });
    return () => { dead = true; };
  }, [tick, canAdmin, canRoster]);

  const create = async () => {
    if (!name.trim() || !email.trim()) { toast({ title: 'Name and email are both needed', tone: 'info' }); return; }
    /* G-2: a parent account with no child link is an account that can never see anything. The
       server has always accepted `phone` (the structural match POST /students makes) and
       `studentId` (writes family.child_link AND app.guardians) — the form simply never asked for
       either, so the one value the link is keyed on was unreachable. Now it does. */
    if (role === 'parent' && !phone.trim() && !childId) {
      toast({ title: 'Give the parent a phone number or pick their child', sub: 'Without one of these the account will never see a child.', tone: 'info' });
      return;
    }
    setCreating(true);
    try {
      const r = await adminCreateUser({
        name: name.trim(), email: email.trim(), role,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(role === 'parent' && childId ? { studentId: childId } : {}),
      });
      setTempPassword({ email: r.user.email ?? email.trim(), password: r.temporaryPassword ?? '' });
      setName(''); setEmail(''); setPhone(''); setChildId('');
      toast({
        title: 'Account created',
        sub: `${roleLabel(role)} · share the one-time password now${role === 'parent' && childId ? ' · linked to their child' : ''}`,
        tone: 'success',
      });
      setTick(t => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setCreating(false); }
  };

  /* G-1: a pupil's portal account, created FROM THE ROSTER ROW — that is where a school is when it
     wants a child to have an account, and it is the only place the structural binding
     (`app.students.user_id`) can be made. The account and the child are then the same thing, so a
     school with two children of the same name does not depend on a name match to find the right
     one. */
  const [portalFor, setPortalFor] = useState<{ id: string; name: string; grade?: string; section?: string } | null>(null);
  const [portalEmail, setPortalEmail] = useState('');

  const createPortalAccount = async () => {
    if (!portalFor) return;
    if (!portalEmail.trim()) { toast({ title: 'An email is needed — the pupil signs in with it', tone: 'info' }); return; }
    setCreating(true);
    try {
      const r = await adminCreateUser({
        name: portalFor.name, email: portalEmail.trim(), role: 'student', studentId: portalFor.id,
      });
      setTempPassword({ email: r.user.email ?? portalEmail.trim(), password: r.temporaryPassword ?? '' });
      setPortalFor(null); setPortalEmail('');
      toast({ title: `Portal account created for ${portalFor.name}`, sub: 'Share the one-time password. They change it at first sign-in.', tone: 'success' });
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
      setTempPassword({ email: u.email, password: r.temporaryPassword });
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
      toast({ title: `${r.student.name ?? 'Student'} updated`, sub: 'The change is on the student school records with an audit entry.', tone: 'success' });
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
        actions={<Badge tone="accent" dot>{pluginLabel('people.admin')}</Badge>}
      />

      {setup && !setup.checklist.every(c => c.done) && (
        <Card style={{ marginBottom: 'var(--s-4)' }} head="Setting up your school" sub="Tick these off and your school is fully running — your IT admin can help with all of them.">
          <div style={{ display: 'grid', gap: 8 }}>
            {setup.checklist.map(c => (
              <a key={c.id} href={c.href} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
                <span style={{
                  width: 20, height: 20, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
                  border: `1.5px solid ${c.done ? 'var(--success-text)' : 'var(--border)'}`,
                  background: c.done ? 'var(--success-weak)' : 'transparent',
                  color: 'var(--success-text)', fontSize: 12,
                }}>{c.done ? '✓' : ''}</span>
                <span style={{ fontSize: 13.5, color: c.done ? 'var(--text-2)' : 'var(--text-1)', textDecoration: c.done ? 'line-through' : 'none' }}>{c.label}</span>
                {!c.done && <span style={{ marginLeft: 'auto', color: 'var(--accent-text)', fontSize: 12.5, fontWeight: 600 }}>Go →</span>}
              </a>
            ))}
          </div>
        </Card>
      )}

      {/* 0.3 guided setup — size presets. Owner-only, always available (not just while the
          checklist is open): schools change size, and every switch stays flippable afterwards
          on the Add-ons screen. */}
      {live.role === 'owner' && (
        <Card style={{ marginBottom: 'var(--s-4)' }} head="Guided setup" sub="Pick your school size, then Apply. This switches modules on/off and creates the 3 standard fee heads — after that, set up your classes.">
          {/* 0.3 guided setup — size presets. Reversible: every switch remains
              flippable afterwards on the Add-ons screen. */}
          <div>
            <div role="radiogroup" aria-label="School size" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
              {(['small', 'standard', 'large'] as const).map(s => (
                <button key={s} role="radio" aria-checked={sizePreset === s}
                  onClick={() => { setSizePreset(s); setApplyMsg(null); }}
                  style={{
                    padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${sizePreset === s ? 'var(--accent)' : 'var(--border)'}`,
                    background: sizePreset === s ? 'var(--accent-weak)' : 'transparent',
                    fontWeight: sizePreset === s ? 600 : 400,
                  }}>{PRESET_LABEL[s]}</button>
              ))}
            </div>
            <div className="u-small" style={{ lineHeight: 1.6 }}>
              {PRESET_WILL[sizePreset]} Plus 3 fee heads: Tuition (TUIT), Transport (TRANS), Activity (ACT) — ones that already exist are left alone.
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
              <Button onClick={applyPreset} disabled={applying}>{applying ? 'Applying…' : 'Apply setup'}</Button>
              <Link to="/classes" style={{ color: 'var(--accent-text)', fontSize: 13.5, fontWeight: 600 }}>Set up classes &amp; sections →</Link>
            </div>
            {applyMsg && <div className="u-small" style={{ marginTop: 8, lineHeight: 1.55 }}>{applyMsg}</div>}
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
                border: `1px solid ${pane === id ? 'var(--accent)' : 'var(--border)'}`,
                background: pane === id ? 'var(--accent-weak)' : 'transparent',
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
                    {roleOptions.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                </label>
                {/* G-2: the phone is how a family is reached (notices, absences, bus delays) AND how
                    an account is matched to a child when the office does not pick one below. */}
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>Phone (WhatsApp / SMS)</span>
                  <input value={phone} onChange={e => setPhone(e.target.value)} type="tel" placeholder="+91 98450 00101" aria-label="Phone" />
                </label>
                {role === 'parent' && (
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 13, opacity: 0.75 }}>Their child (optional)</span>
                    <select value={childId} onChange={e => setChildId(e.target.value)} aria-label="Their child">
                      <option value="">Pick a pupil…</option>
                      {roster.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.grade ? ` · ${gradeLabel(s.grade)}${s.section ? ` ${s.section}` : ''}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <Button onClick={create} disabled={creating}>{creating ? 'Creating…' : 'Create account'}</Button>
                </div>
              </div>
            )}
            {tempPassword && (
              <div style={{ marginTop: 14, padding: 14, borderRadius: 10, border: '1px solid var(--warning)', background: 'var(--warning-weak)' }}>
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
                    { key: 'role', label: 'Role', render: (u: AdminUser) => roleLabel(u.role) },
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

          {/* G-1 · the pupil portal. The server issues `role: 'student'` and ~20 `/student/*` doors
              exist, but nothing here could ever create the account — so the entire student portal had
              no possible user. A pupil's account is made FROM THEIR ROSTER ROW, which is also the
              only place the structural binding (`app.students.user_id`) can be written, so a school
              with two children of the same name still gets the right child on the right login. */}
          <Card headAs="h2" head="Give a pupil a portal account"
            sub="Pupils sign in on a shared school computer to see their own homework, results and tasks. Pick the child from the roster; the account is bound to that record.">
            {!canAdmin ? (
              <Empty title="Owner or IT admin only" sub="Ask the owner or IT admin to create accounts." />
            ) : !roster.length ? (
              <Empty title="No pupils on the roster yet" sub="Enrol a pupil on the People screen first, then come back to give them an account." />
            ) : portalFor ? (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', alignItems: 'end' }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>Pupil</span>
                  <input readOnly value={`${portalFor.name} · ${gradeLabel(portalFor.grade)}${portalFor.section ? ` ${portalFor.section}` : ''}`} aria-label="Pupil" />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>Sign-in email</span>
                  <input value={portalEmail} onChange={e => setPortalEmail(e.target.value)} type="email" placeholder="child@school.edu" aria-label="Sign-in email" />
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button onClick={createPortalAccount} disabled={creating}>{creating ? 'Creating…' : 'Create portal account'}</Button>
                  <Button variant="ghost" onClick={() => { setPortalFor(null); setPortalEmail(''); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', alignItems: 'end' }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>Pupil</span>
                  <select aria-label="Pupil" defaultValue="" onChange={e => {
                    const picked = roster.find(s => s.id === e.target.value);
                    setPortalFor(picked ?? null);
                  }}>
                    <option value="">Choose a pupil…</option>
                    {roster.map(s => (
                      <option key={s.id} value={s.id}>{s.name} · {gradeLabel(s.grade)}{s.section ? ` ${s.section}` : ''}</option>
                    ))}
                  </select>
                </label>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  {roster.length} active {roster.length === 1 ? 'pupil' : 'pupils'} on the roster. A school should not have to hand-create hundreds of these.
                </span>
              </div>
            )}
          </Card>
        </>
      )}

      {pane === 'transfer' && (
        <Card headAs="h2" head="Change a student's class" sub="Use when a student moves to a different class or section. Past attendance, fees and results stay untouched; the move is recorded in the student's history.">
          {!canRoster ? (
            <Empty title="Owner, Principal or Coordinator only" sub="Class changes are a school-office decision." />
          ) : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 13, opacity: 0.75 }}>Student ID (from the People screen)</span>
                <input value={studentId} onChange={e => setStudentId(e.target.value)} placeholder="STU-…" aria-label="Student ID" />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 13, opacity: 0.75 }}>New class</span>
                <select value={toGrade} onChange={e => { setToGrade(e.target.value); setToSection(''); }} aria-label="New class">
                  <option value="">Select…</option>
                  {classes.map(c => <option key={c.grade} value={c.grade}>{classLabel(c.grade)}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 13, opacity: 0.75 }}>New section</span>
                <select
                  value={toSection} onChange={e => setToSection(e.target.value)} aria-label="New section"
                  disabled={!toGrade || !(classes.find(c => c.grade === toGrade)?.sections.length)}
                >
                  <option value="">{toGrade && !(classes.find(c => c.grade === toGrade)?.sections.length) ? 'No sections in this class' : 'Select…'}</option>
                  {(classes.find(c => c.grade === toGrade)?.sections ?? []).map(s => <option key={s} value={s}>Section {s}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 13, opacity: 0.75 }}>Reason (optional)</span>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. section balancing" aria-label="Reason" />
              </label>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <Button onClick={transfer} disabled={transferring}>{transferring ? 'Moving…' : 'Move student'}</Button>
              </div>
              {!classes.length && (
                <div style={{ gridColumn: '1 / -1', fontSize: 12.5, color: 'var(--text-2)' }}>
                  No classes defined yet. <Link to="/classes" style={{ color: 'var(--accent-text)' }}>Set up classes &amp; sections</Link> first.
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {pane === 'lifecycle' && (
        <Card headAs="h2" head="Edit a record · withdraw a student" sub="Direct actions on a student's school records. Withdrawal keeps attendance, fees and guardian links; the bus seat is released and the action is audited.">
          {!canRoster ? (
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
                <div><Button variant="danger" onClick={lcWithdraw} disabled={lcBusy || !canWithdraw}>{lcBusy ? 'Working…' : 'Withdraw'}</Button></div>
                <span style={{ fontSize: 12, opacity: 0.65 }}>
                  {canWithdraw
                    ? 'Cannot be undone from the app — re-admission creates a fresh record.'
                    : 'Withdrawal is the owner or principal\u2019s decision. A coordinator can move a student between classes but cannot end their enrolment.'}
                </span>
              </div>
            </div>
          )}
        </Card>
      )}

      {pane === 'import' && (
        <Card headAs="h2" head="Bring in students from a spreadsheet" sub="CSV with a header row: name,grade,section,admission_no,guardian_name,guardian_phone — only the first three are required. You get a line-by-line report; nothing half-lands.">
          {!canImport ? (
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
