/* Classes & sections — the school's own structure, authored by the owner, principal or IT admin.
   One source of truth for every class picker, transfer and filter: the server stores this list in
   `app.tenants.config.setup.sections`. A new school starts empty — nothing is fabricated. */
import { useEffect, useState } from 'react';
import { PageHead, Card, Button, Empty, ErrorState, SkeletonCard, useToast } from '../components/ui';
import { apiSchoolClasses, apiSaveSchoolClasses, apiSchoolSubjects, apiAddSchoolSubject, type SchoolClass, type SchoolSubject } from '../services/onboardingApi';
import { friendly } from '../lib/friendlyErrors';
import { useRoleOrGrant } from '../lib/access';

/* Server gate is owner/principal/itadmin (PUT /school/classes); this is only the render hint. */
const CAN_EDIT = ['owner', 'principal', 'itadmin'];

function SectionChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 10px',
      borderRadius: 999, border: '1px solid var(--line)', background: 'var(--accent-soft, rgba(0,0,0,0.04))',
      fontSize: 13, fontWeight: 600,
    }}>
      {name}
      <button
        type="button" onClick={onRemove} aria-label={`Remove section ${name}`}
        style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-2)', fontSize: 15, lineHeight: 1, padding: '0 2px' }}
      >×</button>
    </span>
  );
}

function ClassRow({ cls, onChange, onRemove }: { cls: SchoolClass; onChange: (next: SchoolClass) => void; onRemove: () => void }) {
  const [newSection, setNewSection] = useState('');

  const addSection = () => {
    const name = newSection.trim().toUpperCase().slice(0, 8);
    if (!name || cls.sections.includes(name)) { setNewSection(''); return; }
    onChange({ ...cls, sections: [...cls.sections, name] });
    setNewSection('');
  };

  return (
    <div style={{ display: 'grid', gap: 10, padding: 14, border: '1px solid var(--line)', borderRadius: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 4, flex: '1 1 200px' }}>
          <span style={{ fontSize: 12.5, opacity: 0.75 }}>Class / grade name</span>
          <input value={cls.grade} onChange={e => onChange({ ...cls, grade: e.target.value })} placeholder="e.g. 6, LKG, Nursery" aria-label="Class name" />
        </label>
        <Button variant="ghost" onClick={onRemove} aria-label={`Remove class ${cls.grade || 'unnamed'}`} style={{ alignSelf: 'end' }}>Remove class</Button>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 12.5, opacity: 0.75 }}>Sections {cls.sections.length ? `(${cls.sections.length})` : ''}</span>
        {cls.sections.length ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {cls.sections.map(s => (
              <SectionChip key={s} name={s} onRemove={() => onChange({ ...cls, sections: cls.sections.filter(x => x !== s) })} />
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>No sections yet — add one below (or leave none if this class has no sections).</span>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={newSection}
            onChange={e => setNewSection(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSection(); } }}
            placeholder="Section (e.g. A)" aria-label={`Add section to ${cls.grade || 'class'}`}
            style={{ maxWidth: 160 }}
          />
          <Button variant="secondary" onClick={addSection}>Add section</Button>
        </div>
      </div>
    </div>
  );
}

export default function Classes() {
  const toast = useToast();
  /* FEX-4/FEX-7: the write gate is the school-structure door, not a role string — a custom role
     whose mask grants `PUT /school/classes` may edit. The server re-decides regardless. */
  const canEdit = useRoleOrGrant(CAN_EDIT, ['PUT /school/classes']);

  const [classes, setClasses] = useState<SchoolClass[] | null>(null);
  const [subjects, setSubjects] = useState<SchoolSubject[]>([]);
  const [subjectDraft, setSubjectDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    setLoading(true); setError(null);
    Promise.all([
      apiSchoolClasses(),
      apiSchoolSubjects().catch(() => ({ subjects: [] as SchoolSubject[] })),
    ])
      .then(([c, s]) => { if (!dead) { setClasses(c.classes ?? []); setSubjects(s.subjects ?? []); setLoading(false); } })
      .catch(e => { if (!dead) { setError(friendly(e)); setLoading(false); } });
    return () => { dead = true; };
  }, [tick]);

  const addSubject = async () => {
    const name = subjectDraft.trim();
    if (!name) return;
    try {
      const r = await apiAddSchoolSubject(name);
      setSubjects(prev => [...prev.filter(s => s.name.toLowerCase() !== r.subject.name.toLowerCase()), r.subject].sort((a, b) => a.name.localeCompare(b.name)));
      setSubjectDraft('');
      toast({ title: `Subject added — ${r.subject.name}`, tone: 'success' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  const patch = (i: number, next: SchoolClass) =>
    setClasses(prev => (prev ?? []).map((c, idx) => (idx === i ? next : c)));

  const save = async () => {
    const clean = (classes ?? [])
      .map(c => ({ grade: c.grade.trim(), sections: c.sections }))
      .filter(c => c.grade || c.sections.length);
    const blank = clean.find(c => !c.grade);
    if (blank) { toast({ title: 'Every class needs a name', tone: 'info' }); return; }
    setSaving(true);
    try {
      const r = await apiSaveSchoolClasses(clean);
      setClasses(r.classes ?? clean);
      toast({ title: 'Classes & sections saved', sub: 'Every class picker now offers exactly these', tone: 'success' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <PageHead
        title="Classes & sections"
        sub="The school's own structure. Every roster, class transfer and filter offers exactly what you set here — nothing is added for you."
      />

      {!canEdit ? (
        <Empty title="Owner, Principal or IT admin only" sub="Ask the owner, principal or IT admin to change the school's classes and sections." />
      ) : loading ? <SkeletonCard /> : error ? (
        <ErrorState title="Could not load classes" sub={error.replace('Error: ', '')} onRetry={() => setTick(t => t + 1)} />
      ) : (
        <>
          <Card
            headAs="h2" head="Classes" sub="Add a class, then add its sections. Leave sections empty for a class that has none."
            actions={<Button onClick={() => setClasses(prev => [...(prev ?? []), { grade: '', sections: [] }])}>Add class</Button>}
          >
            {!classes?.length ? (
              <Empty title="No classes yet" sub="Add your first class to start building the school's structure." />
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {classes.map((cls, i) => (
                  <ClassRow
                    key={i}
                    cls={cls}
                    onChange={next => patch(i, next)}
                    onRemove={() => setClasses(prev => (prev ?? []).filter((_, idx) => idx !== i))}
                  />
                ))}
              </div>
            )}
          </Card>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 'var(--s-4)' }}>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save classes & sections'}</Button>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              Students already assigned keep their class; changing this list does not move anyone.
            </span>
          </div>

          <Card
            headAs="h2" head="Subjects" sub="The subjects this school teaches. They feed the timetable and homework pickers; a subject name is a real reference, not free text."
            style={{ marginTop: 'var(--s-4)' }}
          >
            {subjects.length ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {subjects.map(s => (
                  <span key={s.id} style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid var(--line)', fontSize: 13 }}>{s.name}{s.code ? ` · ${s.code}` : ''}</span>
                ))}
              </div>
            ) : (
              <div className="u-small u-faint" style={{ marginBottom: 12 }}>No subjects yet. Add the ones your school teaches.</div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={subjectDraft} onChange={e => setSubjectDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addSubject(); } }} placeholder="Subject (e.g. Mathematics)" aria-label="Subject name" style={{ maxWidth: 260 }} />
              <Button variant="secondary" onClick={addSubject}>Add subject</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
