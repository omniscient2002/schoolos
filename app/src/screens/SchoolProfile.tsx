/* School profile — the tenant identity card, editable by the owner at any time.
   Reads GET /school/profile, writes the changed fields through POST
   /onboard/school (the door that previously had no screen calling it).
   The server re-validates everything; this is only the render hint. */
import { useEffect, useState } from 'react';
import { PageHead, Card, Button, ErrorState, SkeletonCard, useToast } from '../components/ui';
import { apiSchoolProfile, apiOnboardSchool, type SchoolProfileFields, type SchoolProfilePatch } from '../services/onboardingApi';
import { friendly } from '../lib/friendlyErrors';
import { useRoleOrGrant } from '../lib/access';

/* Server gate is owner-only on both profile doors (POST /onboard/school refuses
   non-owners outright); this is only the render hint. */
const CAN_EDIT = ['owner'];
const EDIT_DOORS = ['POST /onboard/school'];

const EMPTY: SchoolProfileFields = {
  address: '', city: '', state: '', postalCode: '', country: '',
  board: '', phone: '', email: '', website: '', timezone: '',
};

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
      <span>{label} {optional && <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>(optional)</span>}</span>
      {children}
    </label>
  );
}

export default function SchoolProfile() {
  const toast = useToast();
  const canEdit = useRoleOrGrant(CAN_EDIT, EDIT_DOORS);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [form, setForm] = useState<SchoolProfileFields>(EMPTY);
  const [saved, setSaved] = useState<SchoolProfileFields>(EMPTY);
  const [savedName, setSavedName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    setLoading(true); setError(null);
    apiSchoolProfile()
      .then(r => {
        if (dead) return;
        const p = { ...EMPTY, ...(r.school?.profile ?? {}) };
        setName(r.school?.name ?? '');
        setSavedName(r.school?.name ?? '');
        setSlug(r.school?.slug ?? '');
        setForm(p);
        setSaved(p);
        setLoading(false);
      })
      .catch(e => { if (!dead) { setError(friendly(e)); setLoading(false); } });
    return () => { dead = true; };
  }, [tick]);

  const set = (k: keyof SchoolProfileFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const dirty = name.trim() !== savedName.trim() ||
    (Object.keys(EMPTY) as (keyof SchoolProfileFields)[]).some(k => form[k].trim() !== saved[k].trim());

  const save = async () => {
    const patch: SchoolProfilePatch = {};
    if (name.trim() !== savedName.trim()) patch.schoolName = name.trim();
    for (const k of Object.keys(EMPTY) as (keyof SchoolProfileFields)[]) {
      if (form[k].trim() !== saved[k].trim()) patch[k] = form[k].trim();
    }
    if (!Object.keys(patch).length) return;
    setSaving(true);
    try {
      const r = await apiOnboardSchool(patch);
      setSavedName(r.school.name);
      setName(r.school.name);
      const cfg = (r.school.config ?? {}) as Record<string, unknown>;
      const next = { ...EMPTY };
      for (const k of Object.keys(EMPTY) as (keyof SchoolProfileFields)[]) {
        next[k] = typeof cfg[k] === 'string' ? (cfg[k] as string) : '';
      }
      setForm(next);
      setSaved(next);
      toast({ title: 'School profile saved', tone: 'success' });
    } catch (e) {
      toast({ title: friendly(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (<><PageHead title="School profile" sub="The school's identity card — name, address, contacts, timezone." /><SkeletonCard lines={8} /></>);
  if (error) return (<><PageHead title="School profile" /><ErrorState sub={error} onRetry={() => setTick(t => t + 1)} /></>);

  return (
    <>
      <PageHead
        title="School profile"
        sub={slug ? <>Signed up as <b>{slug}</b> — this card is what invoices, report cards and schedules read.</> : 'This card is what invoices, report cards and schedules read.'}
        actions={canEdit ? <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>Save changes</Button> : undefined}
      />
      {!canEdit && (
        <Card><span style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Only the school owner can change the school profile.</span></Card>
      )}
      <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
        <Card head="School">
          <div style={{ display: 'grid', gap: 10 }}>
            <Field label="School name">
              <input className="input" value={name} onChange={e => setName(e.target.value)} minLength={3} maxLength={120} disabled={!canEdit} />
            </Field>
            <Field label="Board" optional>
              <input className="input" value={form.board} onChange={set('board')} placeholder="CBSE" maxLength={60} disabled={!canEdit} />
            </Field>
          </div>
        </Card>
        <Card head="Where is it">
          <div style={{ display: 'grid', gap: 10 }}>
            <Field label="Address" optional>
              <input className="input" value={form.address} onChange={set('address')} placeholder="12 Station Road" maxLength={300} disabled={!canEdit} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="City" optional>
                <input className="input" value={form.city} onChange={set('city')} placeholder="Pune" maxLength={80} disabled={!canEdit} />
              </Field>
              <Field label="State" optional>
                <input className="input" value={form.state} onChange={set('state')} placeholder="Maharashtra" maxLength={80} disabled={!canEdit} />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Postal code" optional>
                <input className="input" value={form.postalCode} onChange={set('postalCode')} placeholder="411001" maxLength={20} disabled={!canEdit} />
              </Field>
              <Field label="Country" optional>
                <input className="input" value={form.country} onChange={set('country')} placeholder="India" maxLength={80} disabled={!canEdit} />
              </Field>
            </div>
          </div>
        </Card>
        <Card head="How to reach it">
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="School phone" optional>
                <input className="input" type="tel" value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210" maxLength={30} disabled={!canEdit} />
              </Field>
              <Field label="School email" optional>
                <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="office@yourschool.in" maxLength={120} disabled={!canEdit} />
              </Field>
            </div>
            <Field label="Website" optional>
              <input className="input" value={form.website} onChange={set('website')} placeholder="yourschool.in" maxLength={120} disabled={!canEdit} />
            </Field>
          </div>
        </Card>
        <Card head="Locale">
          <div style={{ display: 'grid', gap: 10 }}>
            <Field label="Timezone">
              <input className="input" value={form.timezone} onChange={set('timezone')} placeholder="Asia/Kolkata" maxLength={80} disabled={!canEdit} />
            </Field>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Attendance, timetables and reports all schedule in this zone.</span>
          </div>
        </Card>
      </div>
    </>
  );
}
