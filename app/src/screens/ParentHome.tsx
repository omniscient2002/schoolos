/* ============================================================
   Parent home — the family surface. The sample-family
   walkthrough has been removed; a tenant without the fixture gets
   the honest empty state that points at the live Family surface.
   ============================================================ */
import { Card, Empty, PageHead } from '../components/ui';
import { Icon } from '../components/Icon';

export default function ParentHome() {
  return <ParentHomeNotConfigured />;
}

/* LIVE (P0 crash fix): this surface was a walkthrough of the sample family —
   it can only render from seed.DEMO_STUDENT. A tenant whose /dataset carries no
   (or a blanked) fixture gets this honest state instead of a crash: no
   substituted child, no fake numbers, just where the real records live. */
function ParentHomeNotConfigured() {
  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <PageHead title="Home" sub="Your family's live surface." />
      <Card pad>
        <Empty
          icon={<Icon.Users size={24} />}
          title="This page is a demo walkthrough"
          sub="It renders a sample family, so there is nothing to show on your account here. Your children, attendance, homework and fee records live under Family."
        />
      </Card>
    </div>
  );
}
