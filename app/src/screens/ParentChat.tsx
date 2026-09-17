/* ============================================================
   Parent chat — the school message surface. The sample-family
   thread has been removed; a tenant without the fixture gets the
   honest empty state that points at Family → Requests.
   ============================================================ */
import { Card, Empty, PageHead } from '../components/ui';
import { Icon } from '../components/Icon';

export default function ParentChat() {
  return <ParentChatNotConfigured />;
}

/* LIVE (P0 crash fix): this thread was the demo walkthrough — it rendered a
   sample student and stored messages on the device only. A tenant without
   the demo fixture gets that stated plainly instead of a crash. */
function ParentChatNotConfigured() {
  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <PageHead title="Chat with school" sub="Your messages with the school office." />
      <Card pad>
        <Empty
          icon={<Icon.Message size={24} />}
          title="This chat is a demo preview"
          sub="It shows a sample thread and keeps messages on this device, so there is nothing of yours to show here. The live channel to the school office is Family → Requests."
        />
      </Card>
    </div>
  );
}
