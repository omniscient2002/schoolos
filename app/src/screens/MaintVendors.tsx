/* ============================================================
   MaintVendors — who does the work we can't do in-house.
   Contract status, SLA performance, spend and ratings per
   vendor, an expiry watch naming the contracts that need
   review, and the work orders currently escalated to vendor
   partners. Every figure on the callout is computed from the
   records below it.
   ============================================================ */
import { PageHead, Card, Empty } from '../components/ui';
import { Icon } from '../components/Icon';

export default function MaintVendors() {
  return <LiveMaintVendors />;
}

/* LIVE: no server door yet — honest empty, no fiction (L4-2.2). */
function LiveMaintVendors() {
  return (
    <div>
      <PageHead
        title="Vendor directory"
        sub="Contracts, deadlines and escalation contacts."
      />
      <Card pad>
        <Empty
          icon={<Icon.Offline size={24} />}
          title="Not connected yet"
          sub="There is no vendor data available yet. The demo world shows sample vendors; a live school sees nothing here until that data is available."
        />
      </Card>
    </div>
  );
}
