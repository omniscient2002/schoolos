/* LibrarySetup — the enable wizard step for owner/principal: identifier scheme, loan policy, and the
   librarian account. The desk stays locked until a librarian exists (server-enforced). */
import { useState } from 'react';
import { PageHead, Card, Badge, Button, useToast, Stat } from '../../components/ui';
import { friendly } from '../../lib/friendlyErrors';
import { roleLabel } from '../../lib/labels';
import { adminCreateUser } from '../../services/adminApi';
import { apiPost } from '../../services/liveApi';
import { useRoleOrGrant } from '../../lib/access';

export default function LibrarySetup() {
  const toast = useToast();
  const [scheme, setScheme] = useState('accession');
  const [prefix, setPrefix] = useState('LIB');
  const [loanDays, setLoanDays] = useState('14');
  const [lib, setLib] = useState({ name: '', email: '' });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savePolicy = async () => {
    setBusy(true);
    try {
      await apiPost('/plugins/library/settings', { identifier_scheme: scheme, identifier_prefix: prefix, default_loan_days: Math.max(1, Number(loanDays) || 14) });
      toast({ title: 'Library settings saved', tone: 'success' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  /* P3-3: this screen's own door (`POST /plugins/:id/settings`) admits owner, principal AND IT admin,
     but APPOINTING the librarian is `POST /plugins/people.admin/users` — owner and IT admin only. A
     principal could therefore fill this form in, press the button, and be refused by the server. The
     two authority tiers are stated here rather than discovered by a 403. */
  const canAppoint = useRoleOrGrant(['owner', 'itadmin'], ['POST /plugins/people.admin/users']);

  const createLibrarian = async () => {
    if (!lib.name.trim() || !lib.email.trim()) { toast({ title: 'Name and email are needed', tone: 'info' }); return; }
    setBusy(true);
    try {
      const r = await adminCreateUser({ name: lib.name.trim(), email: lib.email.trim(), role: 'librarian' });
      setTempPassword(r.temporaryPassword ?? '');
      toast({ title: 'Librarian created', sub: 'Share the one-time password now — it will not be shown again.', tone: 'success' });
      setLib({ name: '', email: '' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <PageHead title="Set up the library" sub="Choose how books are labelled, set the loan policy, and appoint a librarian" actions={<Badge tone="accent" dot>{`${roleLabel('owner')} / ${roleLabel('principal')}`}</Badge>} />

      <Card headAs="h2" head="① How this school labels books">
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '2fr 1fr 1fr' }}>
          <label style={{ fontSize: 13 }}>Identifier scheme
            <select value={scheme} onChange={(e) => setScheme(e.target.value)} aria-label="Identifier scheme">
              <option value="accession">Accession number (LIB-00001)</option>
              <option value="barcode">Barcode</option>
              <option value="isbn">ISBN</option>
              <option value="qr">QR code</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label style={{ fontSize: 13 }}>Prefix
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} aria-label="Prefix" />
          </label>
          <label style={{ fontSize: 13 }}>Loan days
            <input type="number" min={1} value={loanDays} onChange={(e) => setLoanDays(e.target.value)} aria-label="Loan days" />
          </label>
        </div>
        <div style={{ marginTop: 12 }}><Button disabled={busy} onClick={savePolicy}>Save settings</Button></div>
      </Card>

      <Card headAs="h2" head="② Appoint the librarian" sub="The desk is locked until a librarian account exists">
        {!canAppoint ? (
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
            Appointing a librarian is the school owner or IT admin's step — ask either of them to open this
            page. You can still set the labelling and loan policy above.
          </div>
        ) : (
        <>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
          <label style={{ fontSize: 13 }}>Full name
            <input value={lib.name} onChange={(e) => setLib({ ...lib, name: e.target.value })} placeholder="Meera Rao" aria-label="Librarian name" />
          </label>
          <label style={{ fontSize: 13 }}>Email
            <input value={lib.email} onChange={(e) => setLib({ ...lib, email: e.target.value })} placeholder="librarian@yourschool.in" aria-label="Librarian email" />
          </label>
        </div>
        <div style={{ marginTop: 12 }}><Button disabled={busy} onClick={createLibrarian}>Create librarian</Button></div>
        </>
        )}
        {tempPassword && (
          <div style={{ marginTop: 12 }}>
            <Stat label="One-time password (shown once)" value={tempPassword} />
            <div className="u-xs u-muted" style={{ marginTop: 6 }}>Share this with the librarian now. They will be asked to change it at first sign-in.</div>
          </div>
        )}
      </Card>

      <Card headAs="h2" head="③ What happens next">
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9, color: 'var(--text-2)', fontSize: 13.5 }}>
          <li>The librarian signs in and lands on the <b>Library desk</b>.</li>
          <li>They add books and copies — identifiers are generated per your scheme.</li>
          <li>Borrowers search the catalog, reserve titles, and request books the library does not own.</li>
          <li>Due-date reminders go to every borrower; parents are notified for students.</li>
        </ol>
      </Card>
    </div>
  );
}
