/* ============================================================
   Facilities map — the "where is the trouble" screen.
   A schematic floorplan per campus with tagged assets as status
   dots and active work orders as rings. There is no
   assets-with-location door on the server yet, so the live
   screen stays empty rather than showing a guessed layout.
   ============================================================ */
import { PageHead, Card, Empty } from '../components/ui';
import { Icon } from '../components/Icon';

export default function MaintMap() {
  return <LiveMaintMap />;
}

/* LIVE: no server door yet — honest empty, no fiction (L4-2.2). */
function LiveMaintMap() {
  return (
    <div>
      <PageHead
        title="Campus asset map"
        sub="Assets plotted by building and floor."
      />
      <Card pad>
        <Empty
          icon={<Icon.Offline size={24} />}
          title="Not connected yet"
          sub="The map needs location data that isn't available yet. The demo world plots sample assets; a live school sees no map rather than a guessed layout."
        />
      </Card>
    </div>
  );
}
