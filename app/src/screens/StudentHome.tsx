/* ============================================================
   Student home — "My Day". The sample-student walkthrough has
   been removed; a tenant without the fixture gets the honest
   empty state that points at the live student page.
   ============================================================ */
import { Card, Empty, PageHead } from '../components/ui';
import { Icon } from '../components/Icon';

export default function StudentHome() {
  return <StudentHomeNotConfigured />;
}

/* LIVE (P0 crash fix): this page was the demo walkthrough built around one
   sample student — with no fixture there is no "me" to show, so it says so
   and points at the live student page instead of crashing the shell. */
function StudentHomeNotConfigured() {
  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      <PageHead title="My Day" sub="Your school day, from your own records." />
      <Card pad>
        <Empty
          icon={<Icon.Today size={24} />}
          title="This page is a demo walkthrough"
          sub="It shows a sample student's day, so there is nothing of yours to show here. Your own day — attendance, periods, homework — is on My Day under your menu."
        />
      </Card>
    </div>
  );
}
