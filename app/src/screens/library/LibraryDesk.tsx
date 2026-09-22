/* LibraryDesk — the librarian's workspace. The desk's sections are navigation items in the main sidebar
   (Shell.tsx, the librarian nav), so this shell is just the page header over the active section. Every
   page talks only to `/plugins/library/*`; the server re-checks the librarian role and the plugin
   lifecycle on every door. */
import { Outlet } from 'react-router-dom';
import { PageHead, Badge } from '../../components/ui';

export default function LibraryDesk() {
  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <PageHead title="Library desk" sub="Catalog, circulation, holds, fines and purchase requests" actions={<Badge tone="accent" dot>librarian</Badge>} />
      <Outlet />
    </div>
  );
}
