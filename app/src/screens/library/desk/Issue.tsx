/* Issue a book: search the title, search the borrower (by name / class / section / id), confirm the due
   date (prefilled from the school's loan policy) and issue. */
import { useEffect, useState } from 'react';
import { Card, Button, Badge, Section, useToast, KeyValue } from '../../../components/ui';
import { DeskIcon as Icon } from './shared';
import { friendly } from '../../../lib/friendlyErrors';
import { roleLabel } from '../../../lib/labels';
import { libraryIssue, libraryDeskSettingsGet, type LibraryBook, type LibraryBorrower, type LibraryDeskSettings } from '../../../services/adminApi';
import { BookPicker, BorrowerPicker, fmtDate, todayISO } from './shared';

const addDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

export default function Issue() {
  const toast = useToast();
  const [book, setBook] = useState<LibraryBook | null>(null);
  const [borrower, setBorrower] = useState<LibraryBorrower | null>(null);
  const [dueOn, setDueOn] = useState('');
  const [settings, setSettings] = useState<LibraryDeskSettings>({});
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ copy: string; dueOn: string; bookTitle: string; borrower: string } | null>(null);

  useEffect(() => { libraryDeskSettingsGet().then((r) => setSettings(r.settings ?? {})).catch(() => {}); }, []);

  const defaultDays = (b: LibraryBorrower | null) => {
    if (!b) return settings.default_loan_days ?? 14;
    if (b.type === 'staff') return settings.loan_days_staff ?? settings.default_loan_days ?? 14;
    const role = b.role;
    if (role === 'teacher') return settings.loan_days_teacher ?? settings.default_loan_days ?? 14;
    return settings.loan_days_student ?? settings.default_loan_days ?? 14;
  };

  const pickBorrower = (b: LibraryBorrower) => { setBorrower(b); setDueOn(addDays(defaultDays(b))); };

  const issue = async () => {
    if (!book || !borrower) return;
    setBusy(true);
    try {
      const r = await libraryIssue({
        bookId: book.id,
        ...(borrower.type === 'student' ? { studentId: borrower.id } : { userId: borrower.id }),
        ...(dueOn ? { dueOn } : {}),
      });
      setReceipt({ copy: r.copy, dueOn: r.dueOn, bookTitle: book.title, borrower: borrower.name });
      toast({ title: `Issued to ${borrower.name}`, sub: `Due ${fmtDate(r.dueOn)} · copy ${r.copy}`, tone: 'success' });
      setBook(null); setBorrower(null); setDueOn('');
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      {receipt && (
        <Card headAs="h2" head="Issued">
          <KeyValue cols={2} items={[
            { k: 'Book', v: receipt.bookTitle },
            { k: 'Borrower', v: receipt.borrower },
            { k: 'Copy', v: <code>{receipt.copy}</code> },
            { k: 'Due back', v: fmtDate(receipt.dueOn) },
          ]} />
          <div style={{ marginTop: 12 }}><Button onClick={() => setReceipt(null)}>Issue another</Button></div>
        </Card>
      )}

      <div style={{ display: 'grid', gap: 'var(--s-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Card headAs="h2" head="① The book">
          {book ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
              <span><b>{book.title}</b><span className="u-xs u-muted" style={{ display: 'block' }}><code>{book.code}</code> · {book.author || '—'}</span></span>
              <Button variant="ghost" onClick={() => setBook(null)}><Icon name="X" size={14} /></Button>
            </div>
          ) : <BookPicker onPick={setBook} />}
        </Card>

        <Card headAs="h2" head="② The borrower">
          {borrower ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
              <span>
                <b>{borrower.name}</b>
                <span className="u-xs u-muted" style={{ display: 'block' }}>
                  {borrower.type === 'student' ? `${borrower.grade}-${borrower.section} · ${borrower.identifier}` : `${borrower.role ? roleLabel(borrower.role) : ''} · ${borrower.identifier}`}
                </span>
                <Badge tone={borrower.duesCents ? 'warning' : 'neutral'}>{borrower.openLoans} out{borrower.duesCents ? ` · ${borrower.duesCents / 100} due` : ''}</Badge>
              </span>
              <Button variant="ghost" onClick={() => { setBorrower(null); setDueOn(''); }}><Icon name="X" size={14} /></Button>
            </div>
          ) : <BorrowerPicker onPick={pickBorrower} />}
        </Card>
      </div>

      <Card headAs="h2" head="③ Confirm">
        <Section title="Due date" sub={`Default is ${defaultDays(borrower)} day(s) for this borrower — override if needed.`}>
          <input type="date" value={dueOn || todayISO()} min={todayISO()} onChange={(e) => setDueOn(e.target.value)} aria-label="Due date" style={{ maxWidth: 220 }} />
        </Section>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button variant="primary" disabled={!book || !borrower} loading={busy} onClick={issue}><Icon name="Check" size={15} /> Issue book</Button>
        </div>
      </Card>
    </div>
  );
}
