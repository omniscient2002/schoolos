/* ============================================================
   Inspections — the compliance check register.
   Answers in one screen: what is scheduled, what completed this
   month, which checks failed, and whether each failure already
   has a work order behind it. Findings come from the records;
   counts are recomputed, never hardcoded.
   ============================================================ */
import { PageHead, Card, Empty } from '../components/ui';
import { Icon } from '../components/Icon';

export default function Inspections() {
  return <LiveInspections />;
}

/* LIVE: no server door yet — honest empty, no fiction (L4-2.2). */
function LiveInspections() {
  return (
    <div>
      <PageHead
        title="Inspections"
        sub="Round checklists, findings and sign-offs."
      />
      <Card pad>
        <Empty
          icon={<Icon.Offline size={24} />}
          title="Not connected yet"
          sub="There is no inspections door on the server yet. Rounds and checklists will appear here when the door exists."
        />
      </Card>
    </div>
  );
}
