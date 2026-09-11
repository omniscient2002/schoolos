import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHead, Section, Card, Badge, Tabs, Button, useToast, KeyValue, Avatar } from '../components/ui';
import { Icon } from '../components/Icon';
import { useStore, demoAccounts } from '../state/store';
import * as seed from '../data/dataset';
import { apiPost } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import MfaSection from './account/MfaSection';
import { t, useLang, setLang, LANGS, isPartial } from '../i18n';
import { storedTheme, setTheme, type ThemeChoice } from '../lib/theme';

const THEME_OPTS: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

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

  return (
    <>
      <PageHead title="Settings" sub={`Signed in as ${actorName} · ${demoAccounts.find(a => a.id === session.roleId)?.title}`}
        actions={<Button variant="secondary" icon={<Icon.Download size={14} />} onClick={() => toast({ title: 'Not connected', sub: 'Configuration export requires server support — nothing was downloaded.', tone: 'info' })}>Export configuration</Button>} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'school', label: t('settings.tabs.school', { fallback: 'School' }) },
        { id: 'roles', label: 'Roles & access' }, /* RBAC terms keep English glossary names */
        { id: 'communication', label: t('settings.tabs.communication', { fallback: 'Communication' }) },
        { id: 'notifications', label: t('settings.tabs.notifications', { fallback: 'Notifications' }) },
        { id: 'data', label: t('settings.tabs.data', { fallback: 'Data & privacy' }) },
      ]} />

      {tab === 'school' && (
        <Section title="School profile" sub="Applies across all campuses. Campus-specific details live in Operations.">
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
            <Card head="Campuses">
              <div style={{ padding: 'var(--s-3) var(--s-5) var(--s-4)' }}>
                {seed.campuses.map(c => (
                  <div key={c.id} className="u-flex" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 4, background: c.hue, marginTop: 5 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 590 }}>{c.name}</div>
                      <div className="u-small u-muted">{c.students} students · capacity {c.capacity} · {Math.round((c.students / c.capacity) * 100)}% utilisation</div>
                    </div>
                    <Badge tone="success" dot>Active</Badge>
                  </div>
                ))}
              </div>
              <div style={{ padding: '0 var(--s-5) var(--s-4)' }}>
                <Button size="sm" variant="ghost" icon={<Icon.Plus size={13} />} disabled={!canManage} onClick={() => toast({ title: 'Not connected', sub: 'Campus creation requires server support — no draft was created.', tone: 'info' })}>Add campus</Button>
              </div>
            </Card>
            <Card head="Academic structure">
              <div style={{ padding: 'var(--s-5)' }}>
                <KeyValue items={[
                  { k: 'Grades', v: '1 – 10' },
                  { k: 'Sections', v: `${seed.sections.length} across 3 campuses` },
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

      {tab === 'roles' && (
        <Section title="Roles & access" sub="What each role can see and do. This demo ships 10 pre-configured roles.">
          <Card>
            <div style={{ padding: 'var(--s-3) var(--s-5) var(--s-4)' }}>
              {demoAccounts.map(a => {
                const scopeAll = ['principal', 'finance', 'owner', 'itadmin'].includes(a.id);
                return (
                  <div key={a.id} className="u-flex" style={{ gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
                    <Avatar name={a.name} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 590 }}>{a.title}</div>
                      <div className="u-xs u-faint u-truncate">{a.email} · scope: {scopeAll ? 'all campuses' : 'home campus'}</div>
                    </div>
                    <div className="u-hide-mobile u-flex u-gap-1" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {a.id === 'principal' && <><Badge tone="accent">Full loop</Badge><Badge tone="ai">AI proposals</Badge></>}
                      {a.id === 'finance' && <><Badge tone="accent">Fees</Badge><Badge tone="outline">Reconciliation</Badge></>}
                      {a.id === 'admissions' && <Badge tone="accent">Funnel</Badge>}
                      {a.id === 'transport' && <Badge tone="accent">Fleet</Badge>}
                      {a.id === 'teacher' && <><Badge tone="accent">Classes</Badge><Badge tone="ai">Drafts</Badge></>}
                      {a.id === 'parent' && <Badge tone="info">Own child</Badge>}
                      {a.id === 'student' && <Badge tone="info">Calm surface</Badge>}
                      {a.id === 'owner' && <Badge tone="accent">Group</Badge>}
                      {a.id === 'itadmin' && <><Badge tone="accent">Platform</Badge><Badge tone="warning">Governance</Badge></>}
                      {a.id === 'coordinator' && <Badge tone="accent">Operations</Badge>}
                    </div>
                    {session.roleId === 'itadmin'
                      ? <Button size="sm" variant="ghost" onClick={() => toast({ title: `Permission editor — ${a.title}`, sub: 'Granular overrides open in a governed editor; changes are audit-logged', tone: 'info' })}>Manage</Button>
                      : <Icon.Lock size={13} style={{ color: 'var(--text-3)' }} />}
                  </div>
                );
              })}
            </div>
          </Card>
          <div className="u-small u-muted" style={{ marginTop: 10 }}>
            Need a role that isn't here? Custom roles with field-level permissions ship in the enterprise pack.
          </div>
        </Section>
      )}

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
                      <span className="u-xs u-faint u-hide-mobile">{t.policy} · {t.uses} sends / mo</span>
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
