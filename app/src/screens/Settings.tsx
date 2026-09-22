import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHead, Section, Card, Badge, Tabs, Button, Empty, SkeletonCard, useToast, KeyValue } from '../components/ui';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { apiGet, apiPost } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { KNOWN_ROLES } from '../lib/roles';
import MfaSection from './account/MfaSection';
import { t, useLang, setLang, LANGS, isPartial } from '../i18n';
import { storedTheme, setTheme, type ThemeChoice } from '../lib/theme';

const THEME_OPTS: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/* The roles the product ships (mirrors lib/roles KNOWN_ROLES) with a plain-language
   purpose. Reference only — the server is the authority on what a role may reach. */
const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', principal: 'Principal', teacher: 'Teacher', coordinator: 'Coordinator',
  counselor: 'Counsellor (wellbeing)', finance: 'Accounts (Finance)',
  finance_head: 'Finance head (approver)', finance_clerk: 'Finance clerk (maker)',
  admissions: 'Admissions desk',
  transport: 'Transport in-charge', itadmin: 'IT admin', facilities: 'Facilities',
  technician: 'Technician', parent: 'Parent', student: 'Student', librarian: 'Librarian',
};
const ROLE_PURPOSE: Record<string, string> = {
  owner: 'Runs the school and its modules; full configuration.',
  principal: 'Day-to-day leadership — briefings, approvals and people.',
  coordinator: 'Timetable, substitutions and workload fairness.',
  counselor: 'The wellbeing queue and safeguarding notes only.',
  finance: 'Fee plans, collection and reconciliation.',
  finance_head: 'Approves refunds and concessions; runs reconciliation and dunning.',
  finance_clerk: 'Collects payments and proposes refunds; cannot approve them.',
  admissions: 'Enquiries, follow-ups and the admissions funnel.',
  transport: 'Routes, fleet and transport incidents.',
  itadmin: 'Accounts, roles, modules and platform settings.',
  facilities: 'Maintenance board, work orders and reports.',
  technician: 'Assigned jobs and the asset workspace.',
  teacher: 'Own classes, homework, submissions and leave.',
};
/* Staff roles a school appoints through the console (parents and students are not appointed). */
const STAFF_ROLES = KNOWN_ROLES.filter(r => r !== 'parent' && r !== 'student');

interface RoleMask { allow: string[]; deny: string[] }
interface CustomRole { key: string; label: string; base_role: string; permissions: RoleMask; members: number }
interface RolesResponse { roles: CustomRole[]; builtin: string[] }

export default function Settings() {
  const { session, actorName } = useStore();
  const lang = useLang(); // L5-3.3: re-render on language change
  const toast = useToast();
  const navigate = useNavigate();
  /* T305: the data-export request now uses the real DPDP DSR door
     (POST /plugins/pack.dpdp/dsr — DPO-gated) instead of a fictional toast. */
  const [dsrPhone, setDsrPhone] = useState('');
  const [dsrBusy, setDsrBusy] = useState(false);
  const requestDsr = (kind: 'export' | 'erasure') => {
    const subjectRef = dsrPhone.trim();
    if (!subjectRef) { toast({ title: 'Phone number required', sub: 'Data requests are filed against the guardian phone number on record.', tone: 'error' }); return; }
    setDsrBusy(true);
    apiPost<{ id?: string; sla_due_at?: string }>('/plugins/pack.dpdp/dsr', { kind, subjectRef })
      .then(() => toast({ title: `${kind === 'export' ? 'Data export' : 'Data erasure'} request filed`, sub: 'Recorded with the school’s data-protection workflow and an SLA due date.', tone: 'success' }))
      .catch(e => toast({ title: 'Request not filed', sub: friendly(e), tone: 'error' }))
      .finally(() => setDsrBusy(false));
  };
  const [tab, setTab] = useState('school');
  const [theme, setThemeState] = useState<ThemeChoice>(storedTheme());
  const canManage = ['principal', 'itadmin', 'owner'].includes(session.roleId);
  /* GET/POST /roles are owner/itadmin only (ROLES_ADMIN) — a principal may open Settings but not roles. */
  const canManageRoles = ['itadmin', 'owner'].includes(session.roleId);

  return (
    <>
      <PageHead title="Settings" sub={`Signed in as ${actorName} · ${ROLE_LABELS[session.roleId] ?? session.roleId}`}
        actions={<Button variant="secondary" icon={<Icon.Download size={14} />} onClick={() => toast({ title: 'Not connected', sub: 'Configuration export requires server support — nothing was downloaded.', tone: 'info' })}>Export configuration</Button>} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'school', label: t('settings.tabs.school', { fallback: 'School' }) },
        { id: 'roles', label: 'Roles & access' }, /* RBAC terms keep English glossary names */
        { id: 'communication', label: t('settings.tabs.communication', { fallback: 'Communication' }) },
        { id: 'notifications', label: t('settings.tabs.notifications', { fallback: 'Notifications' }) },
        { id: 'data', label: t('settings.tabs.data', { fallback: 'Data & privacy' }) },
      ]} />

      {tab === 'school' && (
        <Section title="School profile" sub="Applies to the whole school.">
          <div className="grid grid-2">
            <Card head="Identity" actions={canManage ? <Button size="sm" variant="ghost" icon={<Icon.Edit size={13} />} onClick={() => toast({ title: 'Not connected', sub: 'Editing the school profile requires server support — no request was logged.', tone: 'info' })}>Edit</Button> : <Badge tone="outline">Read-only for your role</Badge>}>
              <div style={{ padding: 'var(--s-5)' }}>
                <KeyValue cols={1} items={[
                  { k: 'School name', v: seed.SCHOOL.name },
                  { k: 'Established', v: String(seed.SCHOOL.established) },
                  { k: 'Boards', v: seed.SCHOOL.board },
                  { k: 'Academic year', v: '2026–27 · Term 2 in progress' },
                  { k: 'Timezone', v: 'Asia/Kolkata (IST)' },
                  { k: 'Languages', v: 'English, Hindi (parent communication)' },
                ]} />
              </div>
            </Card>
            <Card head="Account security">
              <div className="u-col" style={{ padding: 'var(--s-5)', gap: 10 }}>
                <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>
                  Signed in as <strong>{actorName}</strong>. Changing your password signs out every other device immediately.
                </div>
                {/* L5-2.1: real self-service door — POST /me/password */}
                <div>
                  <Button size="sm" variant="secondary" icon={<Icon.Shield size={13} />} onClick={() => navigate('/account/password')}>Change password</Button>
                </div>
                {/* L5-3.1: staff TOTP enrollment (server doors from L2-3.2) */}
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                  <div className="u-xs u-faint" style={{ marginBottom: 6, letterSpacing: '.06em', textTransform: 'uppercase' }}>Two-step sign-in</div>
                  <MfaSection />
                </div>
                {/* L5-3.3: language switcher — real coverage shown, no "fully
                    translated" claim while hi-IN is a scaffold. */}
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                  <div className="u-xs u-faint" style={{ marginBottom: 6, letterSpacing: '.06em', textTransform: 'uppercase' }}>{t('settings.language', { fallback: 'Language' })}</div>
                  <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {LANGS.map(l => (
                      <Button
                        key={l.id}
                        size="sm"
                        variant={lang === l.id ? 'primary' : 'ghost'}
                        onClick={() => setLang(l.id)}
                        aria-pressed={lang === l.id}
                      >
                        {l.native}{l.coverage < 1 ? ` · ${Math.round(l.coverage * 100)}%` : ''}
                      </Button>
                    ))}
                  </div>
                  {isPartial(lang) && <div className="u-xs u-faint" style={{ marginTop: 6 }}>{t('settings.languagePartial', { fallback: 'Hindi covers a small part of the interface today — the rest stays in English.' })}</div>}
                </div>
              </div>
            </Card>
            <Card head="Academic structure">
              <div style={{ padding: 'var(--s-5)' }}>
                <KeyValue items={[
                  { k: 'Grades', v: '1 – 10' },
                  { k: 'Sections', v: `${seed.sections.length}` },
                  { k: 'Periods / day', v: '6 · 08:00 – 13:20' },
                  { k: 'Working days', v: 'Mon – Sat (Sundays off)' },
                  { k: 'Attendance policy', v: 'First-period mark · leniency for delayed transport' },
                ]} />
              </div>
            </Card>
            <Card head="Compliance pack">
              <div style={{ padding: 'var(--s-5)' }}>
                <div className="u-flex u-gap-2" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
                  <Badge tone="accent">India CBSE v2026.1</Badge>
                  <Badge tone="outline">DPDP-ready</Badge>
                  <Badge tone="outline">WCAG 2.2 AA</Badge>
                </div>
                <p className="u-small u-muted" style={{ lineHeight: 1.6 }}>
                  The pack pins regulatory defaults: quiet hours, consent for under-18 data processing, retention schedules, and inspection export formats. School-level entries in the Constitution layer on top and never weaken the floor.
                </p>
                <div style={{ marginTop: 10 }}><Button size="sm" variant="secondary" onClick={() => navigate('/constitution')}>View school policies</Button></div>
              </div>
            </Card>
          </div>
        </Section>
      )}

      {tab === 'school' && (
        <Section title="Appearance" sub="Your choice wins over this device's system preference. Everyone sees their own — theme is per browser, never per school.">
          <Card head="Theme">
            <div style={{ padding: 'var(--s-4) var(--s-5)' }}>
              <div className="seg" role="radiogroup" aria-label="Colour theme" id="theme-seg">
                {THEME_OPTS.map(o => (
                  <button
                    key={o.id}
                    id={`theme-seg-${o.id}`}
                    role="radio"
                    aria-checked={theme === o.id}
                    tabIndex={theme === o.id ? 0 : -1}
                    className={theme === o.id ? 'seg-btn active' : 'seg-btn'}
                    onClick={() => { setTheme(o.id); setThemeState(o.id); }}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      const i = THEME_OPTS.findIndex(x => x.id === theme);
                      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                      if (!dir) return;
                      e.preventDefault();
                      const next = THEME_OPTS[(i + dir + THEME_OPTS.length) % THEME_OPTS.length];
                      setTheme(next.id); setThemeState(next.id);
                      (document.getElementById(`theme-seg-${next.id}`) as HTMLElement | null)?.focus();
                    }}
                  >{o.label}</button>
                ))}
              </div>
              <p className="u-small u-muted" style={{ margin: '10px 0 0' }}>
                {theme === 'system'
                  ? <>Following this device — it currently looks {window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'}.</>
                  : theme === 'dark'
                    ? <>Dark surfaces on. Charts and status colours are re-tuned for contrast, not just inverted.</>
                    : <>Light surfaces on — the default SchoolOS look.</>}
              </p>
            </div>
          </Card>
        </Section>
      )}

      {tab === 'roles' && <RoleAccessTab canManage={canManageRoles} onManage={() => navigate('/roles')} />}

      {tab === 'communication' && (
        <Section title="Communication" sub="Channels, templates and guardrails. Every parent-facing message originates here.">
          <div className="grid grid-2">
            <Card head="Channels">
              <div style={{ padding: 'var(--s-5)' }}>
                <KeyValue cols={1} items={[
                  /* T305 (§9.5/§24): no messaging rails are implemented — the
                     "Connected · 99.2% · Live" badges were fiction. In-app
                     notifications are the one channel that really runs. */
                  { k: 'WhatsApp Business', v: <span className="u-flex" style={{ gap: 8 }}>Not connected — no messaging provider configured <Badge tone="neutral">Off</Badge></span> },
                  { k: 'SMS fallback', v: <span className="u-flex" style={{ gap: 8 }}>Not connected — no SMS provider configured <Badge tone="neutral">Off</Badge></span> },
                  { k: 'Email', v: <span className="u-flex" style={{ gap: 8 }}>Not connected — no email provider configured <Badge tone="neutral">Off</Badge></span> },
                  { k: 'In-app', v: <span className="u-flex" style={{ gap: 8 }}>Delivered inside SchoolOS <Badge tone="success" dot>Live</Badge></span> },
                ]} />
              </div>
            </Card>
            <Card head="Guardrails from the Constitution">
              <div style={{ padding: 'var(--s-5)' }} className="u-col u-gap-2">
                {seed.policies.filter(p => p.category === 'Communication').map(p => (
                  <div key={p.id} className="u-flex" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <Badge tone={p.posture === 'AUTO' ? 'success' : p.posture === 'APPROVAL REQUIRED' ? 'warning' : 'danger'}>{p.posture}</Badge>
                    <div><div style={{ fontWeight: 570 }}>{p.title}</div><div className="u-small u-muted">{p.statement}</div></div>
                  </div>
                ))}
              </div>
            </Card>
            <Card head="Templates">
              <div style={{ padding: 'var(--s-5)' }} className="u-col u-gap-2">
                {/* FE-7: the "uses / mo" figures are illustrative — there is no template-usage door. The
                    per-row label says so; no measured-looking count is presented as the school's record. */}
                {[
                  { name: 'Absence notification', lang: 'EN + HI', uses: 142, policy: 'Attendance §1.1 · AUTO' },
                  { name: 'Transport delay', lang: 'EN + HI', uses: 9, policy: 'Transport §3.1 · AUTO' },
                  { name: 'Payment assistance', lang: 'EN + HI', uses: 47, policy: 'Fees §4.3 · AUTO' },
                  { name: 'Bulk class message', lang: 'EN + HI', uses: 31, policy: 'Communication §2.1 · APPROVAL' },
                  { name: 'Wellbeing check-in', lang: 'EN', uses: 4, policy: 'Safeguarding · HUMAN-ONLY' },
                ].map(t => (
                  <div key={t.name} className="u-between" style={{ padding: '9px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div className="u-flex" style={{ gap: 10 }}>
                      <span style={{ fontWeight: 570 }}>{t.name}</span>
                      <Badge tone="outline">{t.lang}</Badge>
                    </div>
                    <div className="u-flex" style={{ gap: 10, alignItems: 'center' }}>
                      <span className="u-xs u-faint u-hide-mobile">{t.policy} · sample ~{t.uses} sends / mo</span>
                      <Button size="sm" variant="ghost" onClick={() => toast({ title: `${t.name} — preview`, sub: 'Template opens with live placeholders resolved for your class', tone: 'info' })}>Preview</Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </Section>
      )}

      {tab === 'notifications' && (
        <Section title="Notification preferences" sub="Your personal routing. School-wide guardrails always apply.">
          <Card>
            <div style={{ padding: 'var(--s-5)' }} className="u-col u-gap-2">
              {[
                { label: 'Needs-you items', desc: 'Action Center items where you are the approver', push: true, whatsapp: false, email: true },
                { label: 'Approval requests', desc: 'Things waiting on your decision, with deadline reminders', push: true, whatsapp: true, email: true },
                { label: 'Transport delays', desc: 'Routes you own or your child rides', push: true, whatsapp: true, email: false },
                { label: 'Daily digest', desc: 'Morning briefing summary at 07:15', push: false, whatsapp: false, email: true },
                { label: 'Workflow completions', desc: 'Automations that ran on your records', push: false, whatsapp: false, email: true },
                { label: 'Data health alerts', desc: 'Score drops below 90 or gateway mismatches', push: true, whatsapp: false, email: true },
              ].map(n => (
                <NotificationRow key={n.label} {...n} canEdit={true} />
              ))}
            </div>
          </Card>
        </Section>
      )}

      {tab === 'data' && (
        <Section title="Data & privacy" sub="Retention, residency and your rights. The platform floor is not editable here — by design.">
          <div className="grid grid-2">
            <Card head="Retention schedule">
              <div style={{ padding: 'var(--s-5)' }}>
                <KeyValue cols={1} items={[
                  { k: 'Attendance records', v: '5 years' },
                  { k: 'Fee & payment records', v: '10 years (statutory)' },
                  { k: 'Parent chats', v: '90 days rolling' },
                  { k: 'AI traces & prompts', v: '180 days, then aggregate-only' },
                  { k: 'Audit trail', v: 'Permanent · nothing can be edited or deleted' },
                ]} />
              </div>
            </Card>
            <Card head="Residency & processing">
              <div style={{ padding: 'var(--s-5)' }}>
                <KeyValue cols={1} items={[
                  { k: 'Primary storage', v: 'ap-south-1 (Mumbai)' },
                  { k: 'AI processing', v: 'In-region models only' },
                  { k: 'Sub-processors', v: 'Payment gateway · WhatsApp BSP · SMS · Maps' },
                  { k: 'Consent (under-18)', v: 'Verifiable parental consent on enrollment' },
                  { k: 'Tracking & ads', v: 'None. Prohibited by policy floor.' },
                ]} />
              </div>
            </Card>
            <Card head="Your data rights">
              <div style={{ padding: 'var(--s-5)' }} className="u-col u-gap-2">
                <div className="u-small u-muted">File a data-protection request for a guardian by phone number. Requests go to the school's DPDP workflow with an SLA due date — filed by data-protection operators (owner, principal, IT admin, coordinator).</div>
                <label className="u-small">Guardian phone on record
                  <input type="tel" value={dsrPhone} onChange={e => setDsrPhone(e.target.value)} placeholder="+91 98450 00101" style={{ width: '100%' }} />
                </label>
                <div className="u-flex u-gap-2">
                  <Button size="sm" variant="secondary" icon={<Icon.Download size={13} />} disabled={dsrBusy} onClick={() => requestDsr('export')}>Request data export</Button>
                  <Button size="sm" variant="ghost" icon={<Icon.Shield size={13} />} disabled={dsrBusy} onClick={() => requestDsr('erasure')}>Request erasure review</Button>
                </div>
                {/* T305: no correction door exists — the old "correction request
                    created · routed to the front office" toast was fiction. */}
                <div className="u-xs u-faint">Corrections are not connected yet — contact the front office directly; no correction request can be filed from here.</div>
              </div>
            </Card>
          </div>
        </Section>
      )}
    </>
  );
}

/* Roles & access — the product's built-in roles (reference) beside the school's real
   custom roles from GET /roles (built-in base + allow/deny mask, with member counts). */
function RoleAccessTab({ canManage, onManage }: { canManage: boolean; onManage: () => void }) {
  const [roles, setRoles] = useState<CustomRole[] | null>(null);
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });

  useEffect(() => {
    let live = true;
    apiGet<RolesResponse>('/roles')
      .then(r => { if (live) { setRoles(r.roles ?? []); setState({ loading: false, error: null }); } })
      .catch(e => { if (live) { setRoles(null); setState({ loading: false, error: friendly(e) }); } });
    return () => { live = false; };
  }, []);

  return (
    <Section title="Roles & access" sub="The roles this school can assign, and the custom roles it has created. The server decides every door; this is a read-only view.">
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card head="Built-in roles">
          <div style={{ padding: 'var(--s-3) var(--s-5) var(--s-4)' }}>
            {STAFF_ROLES.map(r => (
              <div key={r} className="u-flex" style={{ gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'flex-start' }}>
                <Icon.Key size={14} style={{ color: 'var(--text-3)', marginTop: 3, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 590 }}>{ROLE_LABELS[r] ?? r}</div>
                  <div className="u-small u-muted">{ROLE_PURPOSE[r] ?? ''}</div>
                </div>
                <Badge tone="outline">Built-in</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card
          head="Custom roles"
          actions={canManage
            ? <Button size="sm" variant="ghost" icon={<Icon.Key size={13} />} onClick={onManage}>Manage</Button>
            : <Badge tone="outline">Owner / IT admin</Badge>}
        >
          <div style={{ padding: 'var(--s-3) var(--s-5) var(--s-4)' }}>
            {state.loading && <SkeletonCard lines={3} />}
            {!state.loading && state.error && (
              <Empty icon={<Icon.Lock size={20} />} title="Custom roles could not be loaded" sub={state.error} />
            )}
            {!state.loading && !state.error && roles && roles.length === 0 && (
              <Empty
                icon={<Icon.Key size={20} />}
                title="No custom roles yet"
                sub={canManage
                  ? 'Create one under Roles & access administration — a built-in base plus an allow/deny mask over real doors.'
                  : 'The school owner or IT admin can create custom roles.'}
              />
            )}
            {!state.loading && !state.error && roles && roles.map(role => (
              <div key={role.key} className="u-flex" style={{ gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'flex-start' }}>
                <Icon.Key size={14} style={{ color: 'var(--text-3)', marginTop: 3, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 590 }}>
                    {role.label}{' '}
                    <span className="u-xs u-faint">· base {ROLE_LABELS[role.base_role] ?? role.base_role}</span>
                  </div>
                  <div className="u-xs u-faint">
                    {role.permissions.allow.length} granted · {role.permissions.deny.length} refused ·{' '}
                    {role.members} member{role.members === 1 ? '' : 's'}
                  </div>
                </div>
                <Badge tone={role.members > 0 ? 'accent' : 'outline'}>{role.members}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="u-small u-muted" style={{ marginTop: 10 }}>
        A custom role is a built-in base plus an allow/deny mask over real doors — it is not gated behind an
        enterprise pack. {canManage ? 'Manage them under ' : 'Only the owner or IT admin can manage them under '}
        <button
          onClick={onManage}
          disabled={!canManage}
          style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: canManage ? 'var(--accent-text)' : 'inherit', cursor: canManage ? 'pointer' : 'not-allowed', textDecoration: canManage ? 'underline' : 'none' }}
        >Roles &amp; access administration</button>.
      </div>
    </Section>
  );
}

function NotificationRow({ label, desc, push, whatsapp, email, canEdit }: { label: string; desc: string; push: boolean; whatsapp: boolean; email: boolean; canEdit: boolean }) {
  const toast = useToast();
  const [state, setState] = useState({ push, whatsapp, email });
  const flip = (k: 'push' | 'whatsapp' | 'email') => {
    if (!canEdit) return;
    setState(s => {
      const next = { ...s, [k]: !s[k] };
      /* T305 (D-6): preferences live in this screen's state only — no door
         persists them for the school. */
      toast({ title: 'Saved on this device only', sub: `${label} — ${k} turned ${next[k] ? 'on' : 'off'} locally. Notification preferences are not connected to school records yet.`, tone: 'info' });
      return next;
    });
  };
  return (
    <div className="u-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 570 }}>{label}</div>
        <div className="u-small u-muted">{desc}</div>
      </div>
      <div className="u-flex u-gap-3 u-hide-mobile" style={{ alignItems: 'center' }}>
        {(['push', 'whatsapp', 'email'] as const).map(k => (
          <label key={k} className="u-flex u-xs u-faint" style={{ gap: 5, alignItems: 'center', cursor: canEdit ? 'pointer' : 'not-allowed' }}>
            <input type="checkbox" className="checkbox" checked={state[k]} onChange={() => flip(k)} aria-label={`${label} via ${k}`} />
            {k}
          </label>
        ))}
      </div>
    </div>
  );
}
