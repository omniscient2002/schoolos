/* ============================================================
   404 — friendly dead end. Routes home by role; the "Search"
   button announces the command palette and falls back to /today
   (the palette is owned by the App shell in this build).
   ============================================================ */
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { Button, Card } from '../components/ui';
import { Icon } from '../components/Icon';

export default function NotFound() {
  const navigate = useNavigate();
  const { session } = useStore();

  /* T509 (§9.6): light roles used to be sent BACK into the demo surfaces
     (/parent, /student) — the demo-blob screens that crash on a fresh
     tenant. Route them to their LIVE homes instead. */
  const homeByRole = session.roleId === 'parent' ? '/parent/family' : session.roleId === 'student' ? '/student/home2' : '/today';
  const homeLabel = session.roleId === 'parent' ? 'Go to Family' : session.roleId === 'student' ? 'Go to My Day' : 'Go to Today';

  const openSearch = () => {
    /* The command palette lives in the app shell; announce the intent
       (harmless if unhandled) and land on Today where search lives. */
    window.dispatchEvent(new CustomEvent('schoolos:open-palette'));
    navigate('/today');
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', paddingTop: '6vh' }}>
      <Card pad>
        <div className="u-col" style={{ alignItems: 'center', gap: 14, textAlign: 'center', padding: '24px 8px' }}>
          <span style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--surface-3)', color: 'var(--text-3)', display: 'grid', placeItems: 'center' }}>
            <Icon.Search size={28} />
          </span>
          <div>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>This page moved or never existed</h1>
            <div className="u-muted" style={{ marginTop: 6 }}>
              Check the address, or head back to your home page. Nothing broke — the rest of the school is still here.
            </div>
          </div>
          <div className="u-flex" style={{ gap: 10, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button variant="primary" size="lg" icon={<Icon.Home size={15} />} onClick={() => navigate(homeByRole)}>
              {homeLabel}
            </Button>
            <Button variant="secondary" size="lg" icon={<Icon.Search size={15} />} onClick={openSearch}>
              Search (⌘K)
            </Button>
          </div>
          <div className="u-xs u-faint" style={{ marginTop: 10 }}>
            If a link inside SchoolOS brought you here, mention it to the IT Admin — broken links are tracked.
          </div>
        </div>
      </Card>
    </div>
  );
}
