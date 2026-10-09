/* Onboard — public self-serve signup for school owners (Platform §1.1).
   Three steps, one action each, in the visual language of the Login card:
   ① your school  ② you, the owner  ③ what happens next.
   After the server creates the tenant + owner (one transaction, audited from
   row one), the owner is already signed in — and `enterApp` routes client-side to
   /setup, the Part 1 guide (principal → IT admin → classes → students), which is
   where a new school's office actually starts. */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiSignup } from '../services/onboardingApi';
import { ensureDataset } from '../data/dataset';
import { Icon } from '../components/Icon';

const STRENGTH = (pw: string) => (pw.length >= 8 ? 1 : 0) + (/[A-Z]/.test(pw) ? 1 : 0) + (/[0-9]/.test(pw) ? 1 : 0) + (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);

/* Timezone default: the browser's own zone (the school's locale, not the
   server's) — the server still validates it is a real IANA name. */
const browserTimezone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; }
  catch { return 'Asia/Kolkata'; }
})();
/* Common zones for the datalist — free text still works, the server validates. */
const COMMON_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/London', 'Europe/Berlin', 'Africa/Nairobi', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Pacific/Auckland', 'UTC'];

export default function Onboard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [school, setSchool] = useState({
    schoolName: '', address: '', city: '', state: '', postalCode: '', country: '',
    board: '', phone: '', email: '', website: '', timezone: browserTimezone,
  });
  const [owner, setOwner] = useState({ ownerName: '', ownerEmail: '', ownerPassword: '', ownerPhone: '' });
  const [done, setDone] = useState<{ school: string; slug: string } | null>(null);

  const next = () => { setError(null); setStep(1); };
  const back = () => { setError(null); setStep(0); };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiSignup({ ...school, ...owner });
      try { await ensureDataset(); } catch { /* an empty school has no dataset — the app handles empty states */ }
      setDone({ school: r.tenant.name, slug: r.tenant.slug });
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the school — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const enterApp = () => {
    // Token is already held in memory (apiSignup). Navigate client-side so the
    // session survives: switching pathname re-mounts SessionApp, whose AuthGate
    // validates the fresh token live via GET /me. A hard reload (navigate(0))
    // would drop the memory-only bearer and bounce straight back to /login.
    navigate('/setup', { replace: true });
  };

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 460 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div className="logo-mark">S</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>Start your school</div>
            <div style={{ color: 'var(--text-2)', fontSize: 12.5 }}>SchoolOS — the digital school office</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, margin: '14px 0 4px' }} aria-hidden="true">
          {['Your school', 'You', 'Done'].map((label, i) => (
            <div key={label} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? 'var(--accent)' : 'var(--border)' }} />
          ))}
        </div>
        {error && <div role="alert" style={{ border: '1px solid var(--danger)', color: 'var(--danger-text)', borderRadius: 10, padding: '8px 12px', fontSize: 13, marginTop: 10 }}>{error}</div>}

        {step === 0 && (
          <form className="login-form" onSubmit={(e) => { e.preventDefault(); school.schoolName.trim().length >= 3 && next(); }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>School name
              <input className="input" value={school.schoolName} onChange={(e) => setSchool({ ...school, schoolName: e.target.value })} placeholder="Sunrise Public School" autoFocus minLength={3} required />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Address <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>
              <input className="input" value={school.address} onChange={(e) => setSchool({ ...school, address: e.target.value })} placeholder="12 Station Road" />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>City <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>
                <input className="input" value={school.city} onChange={(e) => setSchool({ ...school, city: e.target.value })} placeholder="Pune" />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>State <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>
                <input className="input" value={school.state} onChange={(e) => setSchool({ ...school, state: e.target.value })} placeholder="Maharashtra" />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Postal code <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>
                <input className="input" value={school.postalCode} onChange={(e) => setSchool({ ...school, postalCode: e.target.value })} placeholder="411001" />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Country <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>
                <input className="input" value={school.country} onChange={(e) => setSchool({ ...school, country: e.target.value })} placeholder="India" />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Board <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>
                <input className="input" value={school.board} onChange={(e) => setSchool({ ...school, board: e.target.value })} placeholder="CBSE" />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Timezone
                <input className="input" value={school.timezone} onChange={(e) => setSchool({ ...school, timezone: e.target.value })} list="onboard-zones" placeholder="Asia/Kolkata" required />
                <datalist id="onboard-zones">
                  {COMMON_ZONES.map(z => <option key={z} value={z} />)}
                </datalist>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>School phone <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>
                <input className="input" type="tel" value={school.phone} onChange={(e) => setSchool({ ...school, phone: e.target.value })} placeholder="+91 98765 43210" />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>School email <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>
                <input className="input" type="email" value={school.email} onChange={(e) => setSchool({ ...school, email: e.target.value })} placeholder="office@yourschool.in" />
              </label>
            </div>
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Website <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>
              <input className="input" value={school.website} onChange={(e) => setSchool({ ...school, website: e.target.value })} placeholder="yourschool.in" />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy || school.schoolName.trim().length < 3} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
              Continue <Icon.ArrowRight size={15} />
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Your classes and sections are yours to define — nothing is added for you. You'll set them up right after signup.</div>
          </form>
        )}

        {step === 1 && (
          <form className="login-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Your full name
              <input className="input" value={owner.ownerName} onChange={(e) => setOwner({ ...owner, ownerName: e.target.value })} placeholder="Ravi Sharma" autoFocus required />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Your email — you will sign in with this
              <input className="input" type="email" value={owner.ownerEmail} onChange={(e) => setOwner({ ...owner, ownerEmail: e.target.value })} placeholder="ravi@yourschool.in" required />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Choose a password <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(at least 8 characters)</span>
              <input className="input" type="password" value={owner.ownerPassword} onChange={(e) => setOwner({ ...owner, ownerPassword: e.target.value })} minLength={8} required />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>Your phone <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional — for account recovery)</span>
              <input className="input" type="tel" value={owner.ownerPhone} onChange={(e) => setOwner({ ...owner, ownerPhone: e.target.value })} placeholder="+91 98765 43210" />
            </label>
            {owner.ownerPassword && (
              <div style={{ display: 'flex', gap: 4 }} aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: STRENGTH(owner.ownerPassword) > i ? 'var(--accent)' : 'var(--border)' }} />
                ))}
              </div>
            )}
            <button className="btn btn-primary" type="submit" disabled={busy || !owner.ownerName || !owner.ownerEmail || owner.ownerPassword.length < 8} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Creating your school…' : 'Create my school'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={back} style={{ width: '100%', justifyContent: 'center' }}>Back</button>
          </form>
        )}

        {step === 2 && done && (
          <div className="login-form" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--success-weak)', display: 'grid', placeItems: 'center', color: 'var(--success-text)' }}><Icon.Check size={20} /></div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17 }}>{done.school} is ready</div>
                <div style={{ color: 'var(--text-2)', fontSize: 12.5 }}>You are signed in as its owner.</div>
              </div>
            </div>
            <ol style={{ margin: '0 0 4px', paddingLeft: 18, fontSize: 13.5, lineHeight: 1.9, color: 'var(--text-2)' }}>
              <li><b style={{ color: 'var(--text-1)' }}>Appoint your principal</b> — the Setup guide walks you through each stage after this.</li>
              <li><b style={{ color: 'var(--text-1)' }}>Your IT admin adds everyone else</b> — staff one by one, students by CSV or migration load.</li>
              <li><b style={{ color: 'var(--text-1)' }}>Switch on modules</b> — library, fees, transport… anything you don't switch on simply never appears.</li>
            </ol>
            <button className="btn btn-primary" onClick={enterApp} style={{ width: '100%', justifyContent: 'center' }}>
              Set up my school <Icon.ArrowRight size={15} />
            </button>
          </div>
        )}

        <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--text-2)' }}>
          Already work at a school? <Link to="/login" style={{ color: 'var(--accent-text)' }}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
