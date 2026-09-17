/* ============================================================
   Student portfolio — "proud work". Artifacts chosen with the
   teachers, each with a subject chip and a teacher comment,
   plus a term reflection. Click through for the full view.
   ============================================================ */
import { useState, type ReactNode } from 'react';
import { Badge, Button, Card, Drawer, PageHead, SampleNote, Section } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate } from '../lib/format';

interface Artifact {
  id: string; title: string; subject: string; color: string;
  teacher: string; comment: string; date: Date; description: string; glyph: ReactNode;
}

const ARTIFACTS: Artifact[] = [
  {
    id: 'pf1', title: 'Fraction poster', subject: 'Art + Mathematics', color: 'var(--accent)',
    teacher: 'Ms. Priya Iyer', date: new Date(Date.now() - 12 * 86400000),
    comment: 'You made 3/4 and 6/8 look obvious. That is the whole idea.',
    description: 'A poster built from cut paper strips showing how 1/2, 2/4, 3/6 and 4/8 all cover the same amount of the whole. Made during the fractions unit, week 3.',
    glyph: <Icon.Grid size={22} />,
  },
  {
    id: 'pf2', title: 'River map — Godavari basin', subject: 'Social Studies', color: 'var(--warning)',
    teacher: 'Mr. Arun Krishnan', date: new Date(Date.now() - 20 * 86400000),
    comment: 'Careful, patient work. The tributaries are all in the right places.',
    description: 'A hand-drawn relief map of the Godavari basin with six tributaries labelled, plus the three cities we studied. Ink and colour pencil.',
    glyph: <Icon.Compass size={22} />,
  },
  {
    id: 'pf3', title: 'Photosynthesis lab photo', subject: 'Science', color: 'var(--info)',
    teacher: 'Ms. Deepa Chandra', date: new Date(Date.now() - 8 * 86400000),
    comment: 'Your leaf comparison table is exactly how a scientist writes.',
    description: 'The setup from the leaf-starch experiment: one leaf kept in light, one in dark, with the iodine results photographed side by side.',
    glyph: <Icon.Sunrise size={22} />,
  },
  {
    id: 'pf4', title: "Poem — 'My Monsoon'", subject: 'English', color: 'var(--ai)',
    teacher: 'Ms. Swati Rao', date: new Date(Date.now() - 5 * 86400000),
    comment: 'The line about the puddles holding the sky is genuinely good.',
    description: 'A four-stanza poem about the first rain after summer, written for the class anthology. Second draft — the first was two lines longer and said less.',
    glyph: <Icon.Book size={22} />,
  },
  {
    id: 'pf5', title: 'Triangle geometry model', subject: 'Mathematics', color: 'var(--accent)',
    teacher: 'Ms. Priya Iyer', date: new Date(Date.now() - 27 * 86400000),
    comment: 'The movable angle arm made the 180° rule click for the whole class.',
    description: 'A cardboard model with a rotating third side that shows any triangle\u2019s angles always sum to 180°. Used as the class demo.',
    glyph: <Icon.Layers size={22} />,
  },
  {
    id: 'pf6', title: 'Community walk reflection', subject: 'Social Studies', color: 'var(--warning)',
    teacher: 'Mr. Arun Krishnan', date: new Date(Date.now() - 15 * 86400000),
    comment: 'You listened well — the shopkeeper interview is the strongest part.',
    description: 'Notes and a one-page reflection from the Sector 12 community walk: three interviews, two photographs, and what public space means to different people.',
    glyph: <Icon.Users size={22} />,
  },
];

export default function StudentPortfolio() {
  const [open, setOpen] = useState<Artifact | null>(null);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        title="Portfolio"
        sub="Chosen with your teachers — progress you can see."
        actions={<Badge tone="accent" dot>Grade 8-B · 6 pieces</Badge>}
      />

      {/* Honesty: this screen has no portfolio door behind it — the pieces, comments and dates are
          illustrative. A live build reads them from the student's own record. */}
      <SampleNote>Sample portfolio — these pieces, teacher comments and dates are illustrative in this build and are not read from your school records.</SampleNote>

      <div className="grid grid-3">
        {ARTIFACTS.map(a => (
          <Card key={a.id} pad onClick={() => setOpen(a)}>
            <div className="u-between">
              <span style={{ width: 38, height: 38, borderRadius: 10, background: `color-mix(in srgb, ${a.color} 10%, transparent)`, color: a.color, display: 'grid', placeItems: 'center' }}>
                {a.glyph}
              </span>
              <span className="u-xs" style={{ padding: '2px 9px', borderRadius: 999, background: `color-mix(in srgb, ${a.color} 12%, transparent)`, color: a.color, fontWeight: 600 }}>{a.subject}</span>
            </div>
            <div style={{ fontWeight: 620, fontSize: 'var(--text-lg)' }}>{a.title}</div>
            <div className="u-small u-muted u-clamp2" style={{ flex: 1 }}>{a.comment}</div>
            <div className="u-xs u-faint">{a.teacher} · {fmtDate(a.date)}</div>
          </Card>
        ))}
      </div>

      <Section title="What I'm proud of this term" style={{ marginTop: 20 }}>
        <Card pad>
          <div className="u-col" style={{ gap: 10 }}>
            {[
              'I kept going with fractions even when they felt hard — and now I can see why the rules work.',
              'My poem made it into the class anthology. I wrote it three times and each one got shorter and better.',
              'On the community walk I talked to two shopkeepers by myself. Last year I would not have.',
            ].map((line, i) => (
              <div key={i} className="u-flex u-small" style={{ gap: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: 4, background: 'var(--accent)', flexShrink: 0, marginTop: 7 }} />
                <span style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{line}</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* ---------- artifact drawer ---------- */}
      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.title ?? ''}
        sub={open ? `${open.subject} · ${fmtDate(open.date)}` : undefined}
        footer={
          open && (
            <div className="u-flex" style={{ gap: 8, justifyContent: 'space-between', width: '100%' }}>
              <span className="u-xs u-faint" style={{ alignSelf: 'center' }}>Uploaded by teacher — students suggest, teachers add.</span>
              <Button variant="ghost" icon={<Icon.Plus size={14} />} disabled>Add to portfolio</Button>
            </div>
          )
        }
      >
        {open && (
          <div className="u-col" style={{ gap: 16 }}>
            <div style={{ height: 150, borderRadius: 'var(--r-lg)', background: `linear-gradient(135deg, color-mix(in srgb, ${open.color} 14%, var(--surface)), var(--surface-2))`, display: 'grid', placeItems: 'center', color: open.color, border: '1px solid var(--border-subtle)' }}>
              {open.glyph}
            </div>
            <div className="u-col" style={{ gap: 6 }}>
              <div className="u-upper">About this piece</div>
              <p className="u-small" style={{ lineHeight: 1.7, color: 'var(--text-2)', margin: 0 }}>{open.description}</p>
            </div>
            <div style={{ border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${open.color}`, borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--surface-2)' }}>
              <div className="u-xs u-faint" style={{ marginBottom: 3 }}>Teacher comment</div>
              <div className="u-small" style={{ fontStyle: 'italic' }}>“{open.comment}”</div>
              <div className="u-xs u-faint" style={{ marginTop: 5 }}>— {open.teacher}</div>
            </div>
            <div className="u-flex u-small u-muted" style={{ gap: 8, padding: '9px 12px', border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-md)' }}>
              <Icon.Lock size={14} style={{ flexShrink: 0 }} />
              <span>Uploaded by teacher — the portfolio is chosen with your teachers, so it stays honest.</span>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
