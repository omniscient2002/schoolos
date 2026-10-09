/* Setup guide — Part 1 of onboarding: the people chain.
   school → principal (owner only) → IT admin (owner or principal) → classes →
   staff → students → parent/pupil portal access. Each stage reads its live
   done-flag from GET /school/setup; the two appointment stages create inline
   through POST /plugins/people.admin/users (the server re-gates: a principal
   reaching for anything but the IT admin is refused). Later stages link to the
   consoles that already do the work (People console, migration, classes) — this
   screen guides, it does not duplicate them. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHead, Card, Button, Empty, ErrorState, SkeletonCard, useToast } from '../components/ui';
import { apiSetupStages, type SetupGuide, type SetupStage } from '../services/onboardingApi';
import { adminCreateUser } from '../services/adminApi';
import { friendly } from '../lib/friendlyErrors';
import { useRoleOrGrant } from '../lib/access';
import { canSurface } from '../lib/effective';
import { useSession } from '../App';
import { Icon } from '../components/Icon';

const CREATE_DOOR = ['POST /plugins/people.admin/users'];

function AppointCard({ role, canAppoint, onCreated }: {
  role: 'principal' | 'itadmin'; canAppoint: boolean; onCreated: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);

  if (!canAppoint) return null;
  const title = role === 'principal' ? 'Appoint your principal' : 'Create your IT admin';

  const create = async () => {
    if (!name.trim() || !email.trim()) { toast({ title: 'Name and email are both needed', tone: 'info' }); return; }
    setBusy(true);
    try {
      const r = await adminCreateUser({
        name: name.trim(), email: email.trim(), role,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      setTemp({ email: r.user.email ?? email.trim(), password: r.temporaryPassword ?? '' });
      setName(''); setEmail(''); setPhone('');
      toast({ title: `${role === 'principal' ? 'Principal' : 'IT admin'} appointed`, sub: 'Share the one-time password now — they change it at first sign-in.', tone: 'success' });
      onCreated();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Card head={title}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Full name
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={role === 'principal' ? 'Meera Nair' : 'Arjun Rao'} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Email — they sign in with this
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={role === 'principal' ? 'meera@yourschool.in' : 'arjun@yourschool.in'} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Phone <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>
            <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" />
          </label>
          <Button variant="primary" loading={busy} disabled={!name.trim() || !email.trim()} onClick={create}>
            {role === 'principal' ? 'Appoint principal' : 'Create IT admin'}
          </Button>
        </div>
        {temp && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 6, background: 'var(--surface-2)' }}>
            <strong style={{ fontSize: 13 }}>One-time password for {temp.email} — shown once</strong>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ fontSize: 16, letterSpacing: 1 }}>{temp.password}</code>
              <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(temp.password); toast({ title: 'Copied', tone: 'info' }); }}>Copy</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function StageRow({ stage }: { stage: SetupStage }) {
  const live = useSession();
  /* A link the caller cannot reach is a dead end behind the role guard — the
     principal sees the People-console rows as status, not as links. No server
     answer yet means the server has not spoken (canSurface allows); every door
     still re-decides. */
  const reachable = stage.href ? canSurface(live?.effective, stage.href) : false;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 12, background: stage.done ? 'var(--success-weak)' : 'var(--surface-1)' }}>
      <div style={{ width: 28, height: 28, borderRadius: 999, display: 'grid', placeItems: 'center', flexShrink: 0, background: stage.done ? 'var(--success)' : 'var(--surface-3)', color: stage.done ? '#fff' : 'var(--text-2)' }}>
        {stage.done ? <Icon.Check size={15} /> : <span style={{ width: 8, height: 8, borderRadius: 999, background: 'currentColor' }} />}
      </div>
      <div style={{ flex: 1, display: 'grid', gap: 2 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          {stage.label}
          {typeof stage.count === 'number' && stage.count > 0 && <span style={{ fontWeight: 400, color: 'var(--text-2)' }}> · {stage.count}</span>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{stage.hint}</div>
      </div>
      {reachable && stage.href && (
        <Link to={stage.href} style={{ color: 'var(--accent-text)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {stage.done ? 'Review →' : 'Start →'}
        </Link>
      )}
    </div>
  );
}

export default function Setup() {
  /* Render hints only — every door re-decides on the server. */
  const canAppointPrincipal = useRoleOrGrant(['owner'], CREATE_DOOR);
  const canCreateItAdmin = useRoleOrGrant(['owner', 'principal'], CREATE_DOOR);

  const [guide, setGuide] = useState<SetupGuide | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);

  useEffect(() => {
    let dead = false;
    setLoading(true); setError(null);
    apiSetupStages()
      .then(g => { if (!dead) { setGuide(g); setLoading(false); } })
      .catch(e => { if (!dead) { setError(friendly(e)); setLoading(false); } });
    return () => { dead = true; };
  }, [tick]);

  if (loading) return (<><PageHead title="Setup guide" sub="Staffing your school, stage by stage." /><SkeletonCard lines={6} /></>);
  if (error || !guide) return (<><PageHead title="Setup guide" /><ErrorState sub={error ?? 'Could not load the setup guide.'} onRetry={refresh} /></>);

  const principalStage = guide.stages.find(s => s.id === 'principal');
  const itadminStage = guide.stages.find(s => s.id === 'itadmin');
  const rest = guide.stages.filter(s => s.id !== 'principal' && s.id !== 'itadmin');

  return (
    <>
      <PageHead
        title="Setup guide"
        sub={guide.school?.name ? <>Staffing <b>{guide.school.name}</b>, stage by stage — the owner appoints the principal, the principal appoints the IT admin, the IT admin fills the school.</> : 'Staffing your school, stage by stage.'}
      />
      <div style={{ display: 'grid', gap: 12, maxWidth: 760 }}>
        {principalStage && !principalStage.done && (
          <AppointCard role="principal" canAppoint={canAppointPrincipal} onCreated={refresh} />
        )}
        {itadminStage && !itadminStage.done && (
          <AppointCard role="itadmin" canAppoint={canCreateItAdmin} onCreated={refresh} />
        )}
        {itadminStage?.done && (
          <Empty title="Delegation complete" sub="Your IT admin adds everyone else from the People console — staff one by one, students by CSV or migration load, parents linked to their children." titleAs="h3" size="sm" />
        )}
        <Card head="Stages" sub="Done stages stay green.">
          <div style={{ display: 'grid', gap: 8 }}>
            {rest.map(s => <StageRow key={s.id} stage={s} />)}
            {principalStage && <StageRow stage={principalStage} />}
            {itadminStage && <StageRow stage={itadminStage} />}
          </div>
        </Card>
      </div>
    </>
  );
}
