/* ============================================================
   Parent fee center — the family fee surface. The sample-family
   walkthrough has been removed; a tenant without the fixture gets
   the honest empty state that points at Family → Fees.
   ============================================================ */
import { Card, Empty, PageHead } from '../components/ui';
import { Icon } from '../components/Icon';

export default function ParentFees() {
  return <ParentFeesNotConfigured />;
}

/* LIVE (P0 crash fix): the fee walkthrough was built on the demo pair's seeded
   ledger — it cannot speak for a real tenant's account. Say so plainly; the
   live ledger is Family → Fees. */
function ParentFeesNotConfigured() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <PageHead title="Fees" sub="Your family's live fee records." />
      <Card pad>
        <Empty
          icon={<Icon.Wallet size={24} />}
          title="This page is a demo walkthrough"
          sub="It walks through a sample family's ledger, so there is nothing of yours to show here. Your real dues, receipts and payment history are under Family → Fees."
        />
      </Card>
    </div>
  );
}
