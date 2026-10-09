/* ============================================================
   OversightHome — OPP-API-1. The single live aggregate the owner
   and principal land on: students, open decisions by desk, fee
   health, attendance, compliance and safety, plus the latest brief.
   Door: GET /owner/home or /principal/home (same shape).
   ============================================================ */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../App';
import { apiOwnerHome, apiPrincipalHome } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Button, ErrorState, Section, Stat, SkeletonCard } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtMoney } from '../lib/format';
import { roleLabel } from '../lib/labels';

interface Home {
  as_of?: string;
  students?: number;
  queue?: { owner_role: string; n: number }[];
  queue_total?: number;
  fees?: { billed: number; collected: number; outstanding: number; open_obligations: number };
  attendance_today?: { present: number; absent: number };
  compliance?: { open: number; overdue: number };
  safety_open?: number;
  brief?: { absentees?: number; fee_dues?: { count: number }; deadlines_today?: number } | null;
  brief_date?: string | null;
}

export default function OversightHome() {
  const session = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    const fetch = session.role === 'owner' ? apiOwnerHome : apiPrincipalHome;
    fetch().then(r => { if (live) { setData(r as Home); setError(null); } })
      .catch(e => { if (live) { setData(null); setError(String(e)); } });
    return () => { live = false; };
  }, [session.role, tick]);

  const collectionPct = data?.fees && data.fees.billed > 0 ? Math.round((data.fees.collected / data.fees.billed) * 100) : null;

  return (
    <>
      <PageHead
        title={session.role === 'owner' ? 'Owner home' : 'Principal home'}
        sub={data?.as_of ? `One live view across every desk · as of ${new Date(data.as_of).toLocaleString()}` : 'One live view across every desk.'}
        actions={
          <>
            <Button variant="secondary" icon={<Icon.Insights size={14} />} onClick={() => navigate('/board-pack')}>Board pack</Button>
            <Button variant="secondary" icon={<Icon.Clipboard size={14} />} onClick={() => navigate('/principal-brief')}>Morning brief</Button>
          </>
        }
      />
      {!data && !error ? <SkeletonCard lines={4} />
        : error ? <ErrorState title="Could not load your home" sub={friendly(error)} onRetry={() => setTick(t => t + 1)} />
        : (
          <>
            <div className="grid grid-4" style={{ marginBottom: 20 }}>
              <Stat label="Open decisions" value={data?.queue_total ?? 0} sub="Across every desk" />
              <Stat label="Active students" value={data?.students ?? 0} sub="Enrolled, status active" />
              <Stat label="Attendance today" value={data?.attendance_today ? `${data.attendance_today.present} present` : '—'} sub={data?.attendance_today ? `${data.attendance_today.absent} absent` : ''} />
              <Stat label="Outstanding fees" value={fmtMoney(Math.round((data?.fees?.outstanding ?? 0) / 100))} sub={collectionPct != null ? `${collectionPct}% collected` : ''} />
            </div>

            <Section title="Where the decisions sit" sub="Open actions by owning desk." style={{ marginBottom: 4 }}>
              <Card pad>
                {(data?.queue ?? []).length === 0 ? <div className="u-small u-muted">No open decisions — the queue is clear.</div> : (
                  <div className="u-col" style={{ gap: 8 }}>
                    {(data?.queue ?? []).map(q => (
                      <div key={q.owner_role ?? 'unassigned'} className="u-between u-small">
                        <span>{q.owner_role ? roleLabel(q.owner_role) : 'Not assigned yet'}</span>
                        <span className="tnum">{q.n}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </Section>

            <div className="grid grid-3" style={{ marginTop: 14 }}>
              <Card pad><Stat label="Compliance open" value={data?.compliance?.open ?? 0} sub={`${data?.compliance?.overdue ?? 0} overdue`} /></Card>
              <Card pad><Stat label="Safety reports" value={data?.safety_open ?? 0} sub="Open in the safety box" /></Card>
              <Card pad>
                <Stat label="Today's brief" value={data?.brief ? `${data.brief.absentees ?? 0} absent` : 'Not generated'} sub={data?.brief ? `${data.brief.fee_dues?.count ?? 0} overdue fees · ${data.brief.deadlines_today ?? 0} deadlines` : 'The 07:00 brief will appear here'} />
              </Card>
            </div>
          </>
        )}
    </>
  );
}
