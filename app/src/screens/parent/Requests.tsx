/* ============================================================
   Requests — the unified parent request center (PU-1).
   Ask the office for certificates, documents, transport or
   corrections, and follow each request's progress as a stepped
   timeline. Parents never edit school records — anything that
   looks wrong goes through report-discrepancy (case-style).
   Server truth: GET/POST /parent/requests · POST /parent/report-discrepancy.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, PageHead, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { DeniedEmpty, ParentError, ParentLoading } from '../../components/parent/states';
import { friendly } from '../../lib/friendlyErrors';
import { fmtDateShort, fmtTime } from '../../lib/format';
import { getRequests, createRequest, reportDiscrepancy, type FamilyRequest, type RequestCategory } from '../../services/parentApi';

const CATEGORIES: { id: RequestCategory; label: string }[] = [
  { id: 'certificate', label: 'Certificate' },
  { id: 'document', label: 'Document' },
  { id: 'transport', label: 'Transport' },
  { id: 'activity', label: 'Activity' },
  { id: 'profile_correction', label: 'Profile correction' },
  { id: 'reevaluation', label: 'Re-evaluation' },
  { id: 'other', label: 'Other' },
];

/* Ticketing statuses → calm plain words (never "processed" when queued). */
const STATUS_WORD: Record<string, string> = {
  submitted: 'Sent to the office',
  received: 'Received',
  assigned: 'Assigned',
  in_progress: 'Being worked on',
  waiting_parent: 'Waiting for you',
  resolved: 'Resolved',
  closed: 'Closed',
};

export default function Requests() {
  const toast = useToast();
  const [rows, setRows] = useState<FamilyRequest[] | null>(null);
  const [err, setErr] = useState<unknown>(null);

  /* new-request form */
  const [category, setCategory] = useState<RequestCategory>('certificate');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  /* discrepancy form */
  const [discOpen, setDiscOpen] = useState(false);
  const [discRef, setDiscRef] = useState('');
  const [discWhat, setDiscWhat] = useState('');
  const [discBusy, setDiscBusy] = useState(false);
  const [discErr, setDiscErr] = useState<string | null>(null);
  const [discDone, setDiscDone] = useState(false);

  const load = useCallback(() => {
    setErr(null);
    getRequests().then(r => setRows(r.requests)).catch(e => setErr(e));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!title.trim()) { setFormErr('Please write a short title so the office knows what you need.'); return; }
    setBusy(true); setFormErr(null); setSent(null);
    try {
      await createRequest({ category, title: title.trim(), detail: detail.trim() || undefined });
      toast({ title: 'Request sent to the school office', sub: 'You can follow its progress below.', tone: 'success' });
      setTitle(''); setDetail('');
      load();
    } catch (e) {
      setFormErr(friendly((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const submitDiscrepancy = async () => {
    if (!discRef.trim() || !discWhat.trim()) { setDiscErr('Tell us which record and what looks wrong.'); return; }
    setDiscBusy(true); setDiscErr(null);
    try {
      await reportDiscrepancy({ record_ref: discRef.trim(), what_wrong: discWhat.trim() });
      setDiscDone(true);
      setDiscRef(''); setDiscWhat('');
      setDiscOpen(false);
    } catch (e) {
      setDiscErr(friendly((e as Error).message || e));
    } finally {
      setDiscBusy(false);
    }
  };

  if (err) return <ParentError err={err} onRetry={load} />; // covers denied via DeniedEmpty
  if (!rows) return <ParentLoading cards={2} />;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gap: 16 }}>
      <PageHead
        title="Requests"
        sub="Ask the school office for documents, transport changes or corrections — and follow each request's progress."
      />

      <div className="grid grid-2" style={{ gap: 16 }}>
        {/* ---------- new request ---------- */}
        <Card pad>
          <h2 style={{ marginBottom: 10 }}><Icon.File size={15} /> New request</h2>
          {sent && <div className="login-error" role="status" style={{ marginBottom: 10 }}>{sent}</div>}
          {formErr && <div className="login-error" role="alert" style={{ marginBottom: 10 }}>{formErr}</div>}

          <div className="field">
            <span id="req-cat-label" className="u-xs u-muted" style={{ fontWeight: 600 }}>What do you need?</span>
            <div role="group" aria-labelledby="req-cat-label" className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
              {CATEGORIES.map(c => {
                const active = c.id === category;
                return (
                  <button key={c.id} onClick={() => setCategory(c.id)} aria-pressed={active} style={{
                    minHeight: 44, padding: '8px 13px', borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
                    background: active ? 'var(--accent-weak)' : 'var(--surface)', color: 'var(--text-1)',
                    fontWeight: active ? 620 : 480, fontSize: 'var(--text-sm)',
                  }}>{c.label}</button>
                );
              })}
            </div>
          </div>
          <div className="field">
            <label htmlFor="req-title">Short title</label>
            <input id="req-title" className="input" style={{ width: '100%' }} value={title}
              onChange={e => setTitle(e.target.value)} placeholder="e.g. Transfer certificate for June" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="req-detail">Tell the office more <span className="u-faint">(optional)</span></label>
            <textarea id="req-detail" className="textarea" style={{ width: '100%' }} value={detail}
              onChange={e => setDetail(e.target.value)} placeholder="Any detail that helps — dates, class, who it is for" />
          </div>
          <Button variant="primary" style={{ marginTop: 12 }} loading={busy} disabled={busy || !title.trim()} onClick={submit}>
            Send to the office
          </Button>
        </Card>

        {/* ---------- my requests ---------- */}
        <div className="u-col" style={{ gap: 16 }}>
          <Card pad>
            <h2 style={{ marginBottom: 10 }}><Icon.Clipboard size={15} /> My requests</h2>
            {rows.length === 0 ? (
              <Empty
                icon={<Icon.File size={22} />}
                title="No requests yet"
                sub="Certificate copies, transport changes, corrections — ask here and follow the progress."
                titleAs="h3"
              />
            ) : (
              <div className="u-col" style={{ gap: 12 }}>
                {rows.map(r => (
                  <div key={r.id} className="u-col" style={{ gap: 10, padding: 13, border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                    <div className="u-between u-flex" style={{ gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{r.title}</div>
                        <div className="u-xs u-faint" style={{ marginTop: 2 }}>
                          {CATEGORIES.find(c => c.id === r.category)?.label ?? r.category}{r.child_name ? ` · ${r.child_name}` : ''} · asked {fmtDateShort(r.created_at)}
                        </div>
                      </div>
                      <Badge tone={r.status === 'resolved' || r.status === 'closed' ? 'success' : r.status === 'waiting_parent' ? 'warning' : 'info'} dot>
                        {STATUS_WORD[r.status] ?? r.status}
                      </Badge>
                    </div>
                    {/* status timeline — one filled step per office event */}
                    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Progress">
                      {(r.events?.length ? r.events : [{ status: r.status, at: r.created_at, note: null }]).map((ev, i, all) => (
                        <li key={i} className="u-flex" style={{ gap: 10, position: 'relative', paddingBottom: i === all.length - 1 ? 0 : 12 }}>
                          {i < all.length - 1 && <span aria-hidden="true" style={{ position: 'absolute', left: 5, top: 14, bottom: -2, width: 2, background: 'var(--border-subtle)' }} />}
                          <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 6, flexShrink: 0, marginTop: 3, background: i === all.length - 1 ? 'var(--accent)' : 'var(--border-strong)', border: '2px solid var(--surface)' }} />
                          <span style={{ minWidth: 0 }}>
                            <span className="u-small" style={{ display: 'block', fontWeight: i === all.length - 1 ? 620 : 520 }}>
                              {STATUS_WORD[ev.status] ?? ev.status}
                            </span>
                            <span className="u-xs u-faint">
                              {fmtDateShort(ev.at)} · {fmtTime(ev.at)}{ev.note ? ` — ${ev.note}` : ''}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ---------- something looks incorrect? ---------- */}
          <Card pad>
            <button aria-expanded={discOpen} onClick={() => { setDiscOpen(o => !o); setDiscDone(false); }}
              className="u-flex" style={{ gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-2)', font: 'inherit', fontSize: 'var(--text-sm)', minHeight: 44, alignItems: 'center' }}>
              <Icon.Alert size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <b>Something looks incorrect?</b>
              <Icon.ChevronDown size={13} style={{ transform: discOpen ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
            </button>
            {discDone && <div className="login-error" role="status" style={{ marginTop: 10 }}>The office will review and correct the record if needed.</div>}
            {discOpen && (
              <div style={{ marginTop: 10 }}>
                {discErr && <div className="login-error" role="alert" style={{ marginBottom: 10 }}>{discErr}</div>}
                <div className="field">
                  <label htmlFor="disc-ref">Which record? <span className="u-faint">(e.g. “Attendance — 3 September”)</span></label>
                  <input id="disc-ref" className="input" style={{ width: '100%' }} value={discRef} onChange={e => setDiscRef(e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="disc-what">What looks wrong?</label>
                  <textarea id="disc-what" className="textarea" style={{ width: '100%' }} value={discWhat} onChange={e => setDiscWhat(e.target.value)}
                    placeholder="Describe it in your own words — the office checks the original record" />
                </div>
                <Button variant="secondary" style={{ marginTop: 10 }} loading={discBusy} disabled={discBusy} onClick={submitDiscrepancy}>
                  Tell the office
                </Button>
              </div>
            )}
            {!discOpen && !discDone && (
              <div className="u-xs u-muted" style={{ marginTop: 6 }}>
                You cannot edit school records — tell the office instead and they will verify and correct it.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
