/* ============================================================
   Maintenance intelligence — the "read the operations" screen.
   Where the money goes, how SLA is holding, which assets fail
   repeatedly, what a replacement would cost, how technicians
   are performing and where preventive compliance stands.
   Deterministic arithmetic over the maintenance records —
   rule-based insight, honestly labelled as such.
   ============================================================ */
import { PageHead, Card, Empty } from '../components/ui';
import { Icon } from '../components/Icon';

export default function MaintIntelligence() {
  return <LiveMaintIntelligence />;
}

/* LIVE: no server door yet — honest empty, no fiction (L4-2.2). */
function LiveMaintIntelligence() {
  return (
    <div>
      <PageHead
        title="Maintenance intelligence"
        sub="Failure patterns, repeat-fault detection and replacement forecasts."
      />
      <Card pad>
        <Empty
          icon={<Icon.Offline size={24} />}
          title="Not connected yet"
          sub="There is no analytics door behind these forecasts yet. Showing them without a data source would be fiction, so this screen stays empty until the door lands."
        />
      </Card>
    </div>
  );
}
