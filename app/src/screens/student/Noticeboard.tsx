/* ============================================================
   Noticeboard — StudentOS staff side (SU-3 lane, unit: staff/student).

   One print-ready weekly sheet: the class noticeboard is how a
   whole class sees the week without any phone. Staff preview the
   physical sheet, print it, pin it. [Regenerate] re-pulls the
   week from the server; [Print for the noticeboard] prints via
   window.print() — @media print CSS hides all app chrome so the
   sheet is the only thing on the paper.

   Door consumed (LIVE — student.world:440):
   - GET /student/noticeboard → { student, blocks: [{title, lines[]}] }:
     "Homework due this week" / "Results published" /
     "Announcements & events this week" / "Printed by". T506 rewired the
     UI to the real shape (the old assignments/exams/events/clubs contract
     never existed server-side, so the sheet always rendered empty).
   Server errors surface verbatim (house law) via friendly().
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHead, Button, useToast, Empty, ErrorState, SkeletonCard,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDateShort } from '../../lib/format';
import { friendly } from '../../lib/friendlyErrors';
import { getNoticeboard, type StudentNoticeboardData } from '../../services/studentApi';
import { useStore } from '../../state/store';
import { useSession } from '../../App';

/* staff surface: teacher/office/coordinator/principal (plan: "teacher/office see
   … noticeboard"); the server decides — this is a UI mirror, not authority. */
const STAFF_ROLES: string[] = ['teacher', 'coordinator', 'principal', 'owner', 'itadmin'];

/* paper preview = physical paper: the sheet keeps light, theme-independent
   colours on screen AND on the printed page (dark tokens stay on the chrome). */
const PAPER = { bg: '#ffffff', text: '#141414', line: '#d9d4c8', dim: '#6d6a62' };

function currentWeekLabel(): string {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; /* Monday = 0 */
  const monday = new Date(now); monday.setDate(now.getDate() - day);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return `${fmtDateShort(monday)} – ${fmtDateShort(sunday)}`;
}

const NO_PRINT_CSS = `
@media print {
  .sidebar, .topbar, .mobile-tabbar, .ai-dock, .toast-stack, .skip-link, .page-head, .no-print { display: none !important; }
  body { background: #ffffff !important; }
  .page { padding: 0 !important; }
  .nb-sheet { box-shadow: none !important; border: 1px solid #000 !important; border-radius: 0 !important; }
  .nb-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 18px !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
@page { margin: 12mm; }
`;

export default function Noticeboard() {
  const toast = useToast();
  const { session } = useStore();
  const live = useSession();
  const allowed = STAFF_ROLES.includes(live.role) || STAFF_ROLES.includes(session.roleId);

  const [data, setData] = useState<StudentNoticeboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!allowed) return;
    let liveReq = true;
    setLoading(true); setError(null);
    getNoticeboard()
      .then(d => { if (liveReq) { setData(d); setLoading(false); } })
      .catch(e => { if (liveReq) { setError(friendly(e)); setLoading(false); } });
    return () => { liveReq = false; };
  }, [tick, allowed]);

  const regenerate = () => {
    setTick(t => t + 1);
    toast({ title: 'Regenerating this week’s sheet', sub: 'Rebuilds the sheet from live homework, results and announcements.', tone: 'info' });
  };

  /* T506: render the server's own blocks (title + lines) — no fabricated
     categories. Server block lines map 1:1 to sheet entries. */
  const blocks = useMemo(() => {
    if (!data) return [];
    const ICONS = [
      <Icon.Clipboard size={13} key="hw" />,
      <Icon.Alert size={13} key="ex" />,
      <Icon.Calendar size={13} key="ev" />,
      <Icon.Users size={13} key="cl" />,
      <Icon.File size={13} key="ft" />,
    ];
    return data.blocks.map((b, i) => ({
      key: `${i}-${(b.title || 'block').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}`,
      title: b.title,
      icon: ICONS[i % ICONS.length],
      entries: b.lines.map(l => ({ title: l, detail: null as string | null, when: null as string | null })),
    }));
  }, [data]);

  const anything = blocks.some(b => b.entries.length > 0);
  const weekLabel = data?.weekLabel || currentWeekLabel();

  if (!allowed) {
    return (
      <div>
        <PageHead title="Noticeboard" sub="The weekly print-ready sheet for the class noticeboard." />
        <Empty icon={<Icon.Lock size={22} />} title="Staff surface" sub="The weekly noticeboard sheet is for office and teaching staff (teacher, coordinator, principal, owner, IT admin). Students see the same week on their Home page — this page is the paper version." />
      </div>
    );
  }
  if (loading) return <SkeletonCard lines={9} />;
  if (error) {
    return (
      <div>
        <PageHead title="Noticeboard" sub="The weekly print-ready sheet for the class noticeboard." />
        <ErrorState title="Could not load the weekly summary" sub={error} onRetry={() => setTick(t => t + 1)} />
        <p className="u-small u-faint" style={{ marginTop: 10 }}>
          The noticeboard door (student.world) assembles the week from homework, published results and announcements. Until it answers, nothing can be printed here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <style>{NO_PRINT_CSS}</style>
      <PageHead
        title="Noticeboard"
        sub="One sheet, printed once a week, pinned where every student passes. This preview is exactly what comes out of the printer."
        actions={
          <span className="no-print u-flex" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={regenerate}>Regenerate weekly</Button>
            <Button variant="primary" icon={<Icon.Document size={14} />} onClick={() => window.print()}>Print for the noticeboard</Button>
          </span>
        }
      />

      {!anything ? (
        <Empty
          icon={<Icon.Calendar size={22} />}
          title="The noticeboard is empty this week"
          sub="The school's noticeboard feed has nothing this week. Regenerate to pull the latest — the sheet rebuilds from live homework, results and announcements."
          action={<span className="no-print"><Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={regenerate}>Regenerate weekly</Button></span>}
        />
      ) : (
        <div
          className="nb-sheet"
          role="document"
          aria-label={`Weekly noticeboard sheet — ${weekLabel}`}
          style={{
            maxWidth: 860, margin: '0 auto', background: PAPER.bg, color: PAPER.text,
            border: `1px solid ${PAPER.line}`, borderRadius: 10, padding: '26px 30px 22px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.14)',
          }}
        >
          {/* ---- sheet header ---- */}
          <div style={{ borderBottom: `2px solid ${PAPER.text}`, paddingBottom: 12, marginBottom: 18 }}>
            <div className="u-flex" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 750, letterSpacing: '-0.01em' }}>Weekly Noticeboard</div>
              <div style={{ fontSize: 13, fontWeight: 650, color: PAPER.dim }}>{weekLabel}</div>
            </div>
            <div className="u-xs" style={{ color: PAPER.dim, marginTop: 2 }}>
              Printed by the school office · replaced every week · take a photo of this sheet only if you must — it stays on the board all week.
            </div>
          </div>

          {/* ---- blocks: auto-fit wraps to one column by 768, two columns on paper ---- */}
          <div className="nb-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {blocks.map(b => (
              <section key={b.key} aria-label={b.title} style={{ breakInside: 'avoid' }}>
                <h2 className="u-flex" style={{ gap: 6, margin: 0, fontSize: 13, fontWeight: 750, textTransform: 'uppercase', letterSpacing: '.07em', color: PAPER.text, borderBottom: `1px solid ${PAPER.line}`, paddingBottom: 6 }}>
                  {b.icon}{b.title}
                </h2>
                {b.entries.length === 0 ? (
                  <div className="u-small" style={{ color: PAPER.dim, padding: '10px 0', fontStyle: 'italic' }}>Nothing this week.</div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {b.entries.map((e, i) => (
                      <li key={`${b.key}-${i}`} style={{ padding: '9px 0', borderBottom: i < b.entries.length - 1 ? `1px dashed ${PAPER.line}` : 'none' }}>
                        <div style={{ fontWeight: 620, fontSize: 14.5 }}>{e.title}</div>
                        {e.when && <div className="u-small" style={{ color: PAPER.dim }}>{e.when}</div>}
                        {e.detail && <div className="u-small" style={{ marginTop: 2 }}>{e.detail}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          {/* ---- sheet footer ---- */}
          <div className="u-xs" style={{ marginTop: 20, paddingTop: 8, borderTop: `1px solid ${PAPER.line}`, color: PAPER.dim }}>
            Anything wrong on this sheet? Tell the office — the week is rebuilt from the live timetable, homework and calendar.
          </div>
        </div>
      )}

      <div style={{ height: 20 }} />
      <div className="u-small u-muted no-print">
        Print tips: A4 portrait prints best. Students have no phones — this sheet (plus the office print queue) is how the week reaches them on paper.
        Regenerating never changes school records; it only rebuilds what is pinned on the board.
      </div>
    </div>
  );
}
