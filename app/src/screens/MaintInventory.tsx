/* ============================================================
   MaintInventory — spare parts and consumables. What's in the
   stores, what's below threshold, what's already requested,
   and what each item costs to hold. There is no inventory door
   on the server yet, so the live screen stays empty rather
   than showing invented stock numbers.
   ============================================================ */
import { PageHead, Card, Empty } from '../components/ui';
import { Icon } from '../components/Icon';

export default function MaintInventory() {
  return <LiveMaintInventory />;
}

/* LIVE: no server door yet — honest empty, no fiction (L4-2.2). */
function LiveMaintInventory() {
  return (
    <div>
      <PageHead
        title="Spare-parts inventory"
        sub="Stock levels, consumption and reorder points."
      />
      <Card pad>
        <Empty
          icon={<Icon.Offline size={24} />}
          title="Not connected yet"
          sub="There is no inventory data available yet. The demo world shows the mock registry; a live school sees nothing here rather than invented stock numbers."
        />
      </Card>
    </div>
  );
}
