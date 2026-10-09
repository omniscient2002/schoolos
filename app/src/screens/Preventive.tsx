/* ============================================================
   Preventive — the planned-work board.
   Answers in one screen: what maintenance is scheduled, what is
   late, which high-risk assets the plan windows touch, and what
   to do about each plan. There is no preventive-schedule door
   on the server yet, so the live screen stays empty.
   ============================================================ */
import { PageHead, Card, Empty } from '../components/ui';
import { Icon } from '../components/Icon';

export default function Preventive() {
  return <LivePreventive />;
}

/* LIVE: no server door yet — honest empty, no fiction (L4-2.2). */
function LivePreventive() {
  return (
    <div>
      <PageHead
        title="Preventive maintenance"
        sub="Schedules, upcoming services and plan coverage."
      />
      <Card pad>
        <Empty
          icon={<Icon.Offline size={24} />}
          title="Not connected yet"
          sub="There is no schedule data available yet. Plans and schedules will appear here once it is."
        />
      </Card>
    </div>
  );
}
