/* ============================================================
   CaseDetail — the case workspace, on the school's own record.

   P2-9, third piece. This screen used to read `domain.cases` (a device
   store seeded at login) and `seed.cases` for the "similar" list, so a
   case filed through the parent app could not be opened here at all, and
   the status buttons wrote to a local reducer with the toast admitting
   "Saved on this device only". Meanwhile `GET /cases/:id` — the door the
   client had typed a wrapper for — did not exist on the server.

   Both are now real: the read door exists (routes.js), the status move
   is `POST /cases/:id/status` with a server audit row, and the linked
   records are the case's own `linked_refs`.

   What is deliberately NOT here, because the server has no model for it:
     · a message thread. `app.cases` has no notes/messages table, so the
       history shown is the case record plus the ledger rows that mention
       its code — labelled as exactly that, rather than a thread of
       invented messages with dates;
     · an AI triage. The old card credited a "sentiment scorer" and a
       "reply classifier" that do not exist. What replaced it is the
       chain of facts the case actually carries.
     · an "escalate" button. There is no door that raises an action from
       a case, so the button wrote a row into the device's audit array and
       notified nobody. It is gone rather than kept as a promise.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, Dropdown, Empty, ErrorState, KeyValue, Modal, PageHead, Progress, Section, SkeletonCard, useToast } from '../components/ui';
import { EvidenceChain } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateTime, fmtRelative } from '../lib/format';
import { statusLabel } from '../lib/labels';
import { useRoleOrGrant } from '../lib/access';
import { apiAudit, apiCase, apiCaseStatus, apiCases, type ApiCase } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';

type CaseStatus = 'open' | 'triaged' | 'in-progress' | 'resolved' | 'closed';

const FLOW: CaseStatus[] = ['open', 'triaged', 'in-progress', 'resolved', 'closed'];
const STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'Open', triaged: 'Triaged', 'in-progress': 'In-progress', resolved: 'Resolved', closed: 'Closed' };
const STATUS_TONE: Record<CaseStatus, 'info' | 'warning' | 'accent' | 'success' | 'neutral'> = {
  open: 'info', triaged: 'warning', 'in-progress': 'accent', resolved: 'success', closed: 'neutral' };
const PRIORITY_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = {
  urgent: 'danger', high: 'warning', normal: 'neutral', low: 'neutral' };
const ORIGIN_LABEL: Record<string, string> = {
  parent: 'Parent app', 'parent-whatsapp': 'Parent WhatsApp', staff: 'Raised by staff', api: 'API', system: 'System' };

/** The case record, plus the two derived numbers the workspace shows: how much of the SLA is
 *  spent, and whether it is breached. Both are arithmetic on the server's own timestamps. */
function slaInfo(c: ApiCase, now: number) {
  if (c.status === 'resolved' || c.status === 'closed') {
    const done = new Date(c.resolved_at ?? now).getTime();
    const due = new Date(c.sla_due_at ?? done).getTime();
    const met = c.sla_due_at ? done <= due : true;
    return {
      label: c.sla_due_at ? (met ? 'Met the deadline' : `Closed ${Math.round((done - due) / 3600000)}h late`) : 'No deadline on this case',
      tone: met ? 'success' as const : 'danger' as const,
      pct: c.sla_due_at ? 100 : 0,
    };
  }
  if (!c.sla_due_at) return { label: 'No deadline on this case', tone: 'neutral' as const, pct: 0 };
  const start = new Date(c.created_at).getTime();
  const due = new Date(c.sla_due_at).getTime();
  const span = Math.max(1, due - start);
  const pct = Math.max(0, Math.min(100, Math.round(((now - start) / span) * 100)));
  const left = Math.round((due - now) / 3600000);
  return {
    label: left < 0 ? `${Math.abs(left)}h past the deadline` : left === 0 ? 'due now' : `${left}h left`,
    tone: (left < 0 ? 'danger' : left <= 4 ? 'warning' : 'success') as 'danger' | 'warning' | 'success',
    pct,
  };
}

const fmtH = (h: number) => `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const now = Date.now();

  const [row, setRow] = useState<ApiCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [ledger, setLedger] = useState<{ at: string; actor: string; action: string; outcome: string | null }[]>([]);
  const [similar, setSimilar] = useState<Record<string, unknown>[]>([]);

  const canMove = useRoleOrGrant(
    ['owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'finance', 'finance_head', 'finance_clerk'],
    ['POST /cases/:id/status'],
  );
  /* The ledger is a privileged read; the case itself is not. A desk that cannot read /audit still
     gets the case, and the trail card says why it is empty instead of inventing entries. */
  const canReadLedger = useRoleOrGrant(['owner', 'principal', 'itadmin', 'finance', 'finance_head', 'finance_clerk'], ['GET /audit']);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const res = await apiCase(id);
      setRow(res.case ?? null);
    } catch (e) {
      setError(String(e));
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  /* The trail and the sibling cases follow the case, and both degrade on their own. */
  useEffect(() => {
    if (!row?.code) return;
    let live = true;
    if (canReadLedger) {
      apiAudit(200)
        .then(r => {
          if (!live) return;
          setLedger((r.entries ?? [])
            .filter(e => String(e.record_ref ?? '').includes(row.code) || String(e.record_ref ?? '').includes(row.id))
            .slice(0, 20)
            .map(e => ({ at: String(e.created_at ?? ''), actor: String(e.actor ?? ''), action: String(e.action ?? ''), outcome: (e.outcome as string | null) ?? null })));
        })
        .catch(() => { if (live) setLedger([]); });
    }
    apiCases()
      .then(r => {
        if (!live) return;
        setSimilar(((r.cases ?? []) as Record<string, unknown>[])
          .filter(x => String(x.kind) === row.kind && String(x.id) !== row.id)
          .slice(0, 6));
      })
      .catch(() => { if (live) setSimilar([]); });
    return () => { live = false; };
  }, [row?.code, row?.kind, row?.id, canReadLedger]);

  const advance = async (to: CaseStatus) => {
    if (!row) return;
    setBusy(true);
    try {
      const res = await apiCaseStatus(row.id, to);
      setRow(res.case ?? null);
      toast({ title: `Case moved to ${STATUS_LABEL[to]}`, sub: 'Recorded on the case with an audit row — other desks see the same status.', tone: 'success' });
    } catch (e) {
      toast({ title: 'The status change was refused', sub: friendly(e), tone: 'error' });
    } finally { setBusy(false); }
  };

  const draftReply = useMemo(() => {
    if (!row) return '';
    /* The server stores `status` as text; the flow is ours, so it is narrowed once here rather than
       indexed with a raw string at every badge. An unknown status reads as `open`, never as a crash. */
    const status: CaseStatus = (FLOW.includes(row.status as CaseStatus) ? row.status : 'open') as CaseStatus;
    const links = (row.linked_refs ?? []).map(l => l.label).filter(Boolean);
    return [
      'Dear Parent,',
      '',
      `Thank you for writing to us about “${row.title.replace(/\.$/, '')}”. Here is where things stand:`,
      '',
      `· Your case (${row.code}) is with ${row.owner ?? 'the school office'} — current status: ${STATUS_LABEL[status].toLowerCase()}.`,
      links.length ? `· We are reviewing ${links.join(', ')} and will confirm the resolution steps shortly.` : '· We are reviewing the details you sent and will confirm the resolution steps shortly.',
      '· You will hear from us within 24 hours, or sooner if anything changes.',
      '',
      'If you would like to discuss this, reply here and we will call you back.',
      '',
      `— ${row.owner ?? 'The school office'}`].join('\n');
  }, [row]);

  if (loading) {
    return (
      <>
        <PageHead title="Case" back={{ to: '/cases', label: 'Back to cases' }} />
        <SkeletonCard lines={6} />
      </>
    );
  }

  if (error || !row) {
    return (
      <>
        <PageHead title="Case not available" back={{ to: '/cases', label: 'Back to cases' }} />
        {error
          ? <Card pad><ErrorState title="Could not open this case" sub={friendly(error)} onRetry={load} /></Card>
          : <Card pad>
            <Empty
              icon={<Icon.Clipboard size={26} />}
              title="No case with that id"
              sub="It may have been merged, withdrawn, or belong to another family. The board lists every case this desk can see."
              action={<Button variant="primary" onClick={() => navigate('/cases')}>Back to cases</Button>}
            />
          </Card>}
      </>
    );
  }

  const sla = slaInfo(row, now);
  const status: CaseStatus = (FLOW.includes(row.status as CaseStatus) ? row.status : 'open') as CaseStatus;
  const idx = FLOW.indexOf(status);
  const nexts = FLOW.slice(idx + 1);
  const links = (row.linked_refs ?? []).filter(l => l?.label || l?.ref);

  return (
    <>
      <PageHead
        title={row.title}
        sub={`${row.code} · opened ${fmtDateTime(row.created_at)} (${fmtRelative(row.created_at)}) · ${ORIGIN_LABEL[row.origin] ?? row.origin}`}
        back={{ to: '/cases', label: 'Back to cases' }}
        actions={
          <>
            {canMove && nexts.length > 0 ? (
              <Dropdown
                label="Status advance" trigger={() => <Button variant="primary" loading={busy} icon={<Icon.ArrowRight size={13} />}>Advance status</Button>} align="left">
                {close => (
                  <div className="u-col" style={{ padding: 4 }}>
                    {nexts.map(s => (
                      <button
                        key={s}
                        role="menuitem"
                        className="u-small"
                        style={{ textAlign: 'left', padding: '7px 10px', borderRadius: 8, cursor: 'pointer', border: 'none', background: 'transparent' }}
                        onClick={() => { void advance(s); close(); }}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                )}
              </Dropdown>
            ) : (
              <Badge tone="success" dot>{STATUS_LABEL[status]}</Badge>
            )}
            <Button variant="secondary" icon={<Icon.Message size={13} />} onClick={() => { setReplyText(draftReply); setReplyOpen(true); }}>Draft a reply</Button>
          </>
        }
      />

      <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        <Badge tone="outline">{statusLabel(row.kind)}</Badge>
        <Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Badge>
        <Badge tone={PRIORITY_TONE[row.priority] ?? 'neutral'}>{statusLabel(row.priority)} priority</Badge>
        <Badge tone={sla.tone === 'danger' ? 'danger' : sla.tone === 'warning' ? 'warning' : 'outline'}>{sla.label}</Badge>
        <Badge tone="info">{ORIGIN_LABEL[row.origin] ?? row.origin}</Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        {/* ---------- left: the record and its trail ---------- */}
        <div className="u-col" style={{ gap: 18 }}>
          <Section title="What was reported" sub={`Filed ${fmtDateTime(row.created_at)}${row.detail ? '' : ' · no detail was given'}`}>
            <Card pad>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--text-md)', lineHeight: 1.6 }}>
                {row.detail || 'The case was opened without a description — ask the person who filed it what they need.'}
              </p>
            </Card>
          </Section>

          <Section
            title="Activity"
            sub="The case has no message thread on the server — app.cases stores no notes or messages, so this is the ledger trail for this case, not a conversation."
          >
            <Card pad>
              {!canReadLedger ? (
                <span className="u-small u-muted">
                  The activity ledger is readable by the owner, principal, IT admin and finance desks. This case record is
                  complete without it.
                </span>
              ) : ledger.length === 0 ? (
                <span className="u-small u-faint">
                  No ledger rows mention {row.code} in the last 200 entries. Every status change writes one, so an empty
                  list means nothing has changed since it was opened.
                </span>
              ) : (
                <div className="u-col" style={{ gap: 10 }}>
                  {ledger.map((e, i) => (
                    <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px', borderLeft: '3px solid var(--border-strong)' }}>
                      <div className="u-between" style={{ marginBottom: 4 }}>
                        <span className="u-small" style={{ fontWeight: 620 }}>{e.action}</span>
                        <span className="u-xs u-faint">{fmtDateTime(e.at)}</span>
                      </div>
                      <div className="u-small u-muted">{e.actor}{e.outcome ? ` · ${e.outcome}` : ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Section>

          <Section title="Linked records" sub="Records attached to this case when it was opened.">
            <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
              {links.length === 0 && <span className="u-small u-faint">No linked records on this case.</span>}
              {links.map((l, i) => (
                <button
                  key={`${l.ref ?? l.label}-${i}`}
                  className="u-flex u-xs"
                  style={{ gap: 5, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 10px', background: 'var(--surface)', cursor: l.ref ? 'pointer' : 'default' }}
                  onClick={() => { if (l.ref) navigate(l.ref); }}
                >
                  <Icon.ArrowUpRight size={11} />{l.label ?? l.ref}
                </button>
              ))}
            </div>
          </Section>
        </div>

        {/* ---------- right: facts, deadline, siblings ---------- */}
        <div className="u-col" style={{ gap: 18 }}>
          <Card>
            <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 10 }}>Case details</div>
            <KeyValue
              items={[
                { k: 'Case code', v: <span className="mono">{row.code}</span> },
                { k: 'Kind', v: statusLabel(row.kind) },
                { k: 'Status', v: <Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Badge> },
                { k: 'Priority', v: <Badge tone={PRIORITY_TONE[row.priority] ?? 'neutral'}>{statusLabel(row.priority)}</Badge> },
                { k: 'Origin', v: ORIGIN_LABEL[row.origin] ?? row.origin },
                { k: 'Opened by', v: row.opened_by ? <span className="mono u-small">{row.opened_by.slice(0, 8)}</span> : '—' },
                { k: 'Owner', v: row.owner ?? 'Unassigned' },
                { k: 'Opened on', v: fmtDate(row.created_at) },
                { k: 'Deadline', v: row.sla_due_at ? fmtDateTime(row.sla_due_at) : 'None set' },
                ...(row.resolved_at ? [{ k: 'Resolved on', v: fmtDateTime(row.resolved_at) }] : [])]}
            />
          </Card>

          <Card>
            <div className="u-between" style={{ marginBottom: 8 }}>
              <span className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Deadline</span>
              <Badge tone={sla.tone === 'danger' ? 'danger' : sla.tone === 'warning' ? 'warning' : 'outline'}>{sla.label}</Badge>
            </div>
            <Progress value={sla.pct} tone={sla.tone === 'danger' ? 'danger' : sla.tone === 'warning' ? 'warn' : undefined} />
            <div className="u-xs u-faint" style={{ marginTop: 7 }}>
              {row.sla_due_at
                ? `${fmtH(Math.max(0, (now - new Date(row.created_at).getTime()) / 3600000))} elapsed against a deadline of ${fmtDateTime(row.sla_due_at)}. The deadline is set when the case is opened and never extends itself.`
                : 'This case carries no deadline — nothing here is counting down.'}
            </div>
          </Card>

          {similar.length > 0 && (
            <Card>
              <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 10 }}>Other {statusLabel(row.kind).toLowerCase()} cases</div>
              <div className="u-col" style={{ gap: 8 }}>
                {similar.map(s => (
                  <div
                    key={String(s.id)}
                    className="u-between card-click"
                    role="button"
                    tabIndex={0}
                    style={{ gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', cursor: 'pointer' }}
                    onClick={() => navigate(`/cases/${s.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/cases/${s.id}`); } }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="u-small u-truncate" style={{ fontWeight: 570 }}>{String(s.title ?? '')}</div>
                      <div className="u-xs u-faint">{String(s.code ?? '')} · {fmtDate(String(s.created_at ?? ''))} · {String(s.owner ?? 'Unassigned')}</div>
                    </div>
                    <Badge tone={STATUS_TONE[(s.status as CaseStatus)] ?? 'neutral'}>{STATUS_LABEL[(s.status as CaseStatus)] ?? statusLabel(String(s.status ?? ''))}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 10 }}>How this case reached the desk</div>
            <EvidenceChain
              title="Facts on the record"
              steps={[
                { label: 'Origin', detail: `${ORIGIN_LABEL[row.origin] ?? row.origin}${row.opened_by ? ` · filed by account ${row.opened_by.slice(0, 8)}` : ' · filed by the school office'}`, source: 'app.cases.origin / opened_by' },
                { label: 'Priority', detail: `${statusLabel(row.priority)} — set when the case was opened`, source: 'app.cases.priority' },
                { label: 'Owner', detail: row.owner ?? 'Nobody has taken ownership yet', source: 'app.cases.owner' },
                { label: 'Linked records', detail: links.length ? links.map(l => l.label ?? l.ref).join(' · ') : 'None attached', source: 'app.cases.linked_refs' }]}
            />
            <div className="u-xs u-faint" style={{ marginTop: 8 }}>
              These are the case&apos;s own fields. Nothing here is inferred: the previous version of this card credited a
              sentiment scorer and a reply classifier that the product does not run.
            </div>
          </Card>
        </div>
      </div>

      {/* ---------- guardian reply draft ---------- */}
      <Modal
        open={replyOpen}
        onClose={() => setReplyOpen(false)}
        title="Draft a reply to the family"
        sub={`${row.code} · written from this case's own facts. WhatsApp is not connected, so nothing is sent from here.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReplyOpen(false)}>Close</Button>
            <Button variant="primary" icon={<Icon.Send size={13} />} onClick={() => {
              setReplyOpen(false);
              toast({
                title: 'Reply kept as a draft',
                sub: 'Messaging is not connected, so this was not sent. Send it from the communications desk once a provider is configured.',
                tone: 'info',
              });
            }}>Save draft (not sent)</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 10 }}>
          <div className="u-xs u-faint">Draft only — every fact in it comes from the case record above.</div>
          <textarea className="textarea" rows={12} style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-sm)' }} value={replyText} onChange={e => setReplyText(e.target.value)} aria-label="Reply draft to the family" />
        </div>
      </Modal>
    </>
  );
}