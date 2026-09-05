/* ============================================================
   Demo: Resolve a parent issue (Golden Loop 3).
   Parent WhatsApp → verify before disclose → deterministic
   answer → self-serve payment → receipt → reconciliation →
   installment-plan case → finance approval → resolution →
   "why was this closed?" → the audit.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../state/store';
import { PageHead, Card, Badge, Button, KeyValue, Drawer } from '../components/ui';
import { Icon } from '../components/Icon';
import { EventTimeline, ActionChain, LoopClosed, VerifyRow, SectionLabel, type ChainStep, type TimelineEntry } from '../components/Flow';
import { PARENT_FEE, paymentLifecycleSteps } from '../demo/loops';
import type { ChatMsg, SchoolCase } from '../types/domain';

type Phase = 'inbound' | 'verifying' | 'answered' | 'paying' | 'paid' | 'plan-request' | 'plan-review' | 'resolved';
const FLOW: Phase[] = ['inbound', 'verifying', 'answered', 'paying', 'paid', 'plan-request', 'plan-review', 'resolved'];

const PAY_CHAIN: ChainStep[] = [
  { id: 'trigger', label: 'Trigger', detail: 'parent question', state: 'done' },
  { id: 'policy', label: 'Policy', detail: 'Fees §5.1', state: 'done' },
  { id: 'evidence', label: 'Evidence', detail: 'obligation + attempt', state: 'done' },
  { id: 'proposal', label: 'Answer', detail: 'deterministic', state: 'done' },
  { id: 'approval', label: 'Consent', detail: 'parent taps Pay now', state: 'done' },
  { id: 'execution', label: 'Execution', detail: 'gateway + ledger', state: 'done' },
  { id: 'verification', label: 'Verification', detail: 'reconciled ₹0 diff', state: 'done' },
  { id: 'audit', label: 'Audit', detail: 'ledger entry', state: 'done' },
];

export default function DemoParent() {
  const { dispatch } = useStore();
  const [phase, setPhase] = useState<Phase>('inbound');
  const [orchOpen, setOrchOpen] = useState(false);
  const [stmtOpen, setStmtOpen] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [payLog, setPayLog] = useState<TimelineEntry[] | null>(null);
  const [planCase, setPlanCase] = useState<SchoolCase | null>(null);
  const timers = useRef<number[]>([]);
  const idx = FLOW.indexOf(phase);

  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);

  /* the message arrives on its own — the loop opens cinematically */
  useEffect(() => {
    if (phase !== 'inbound') return;
    const t = window.setTimeout(() => advance(), 1400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const advance = () => {
    const next = FLOW[idx + 1];
    if (!next) return;
    if (next === 'verifying') {
      setPhase('verifying');
      timers.current.push(window.setTimeout(() => {
        dispatch({ type: 'chat/add', msg: { id: `c_${Date.now()}`, from: 'guardian', text: 'Hi, I was told Aarav\u2019s fee payment failed. Can you tell me what happened?', on: new Date(), status: 'read' } as ChatMsg });
        setPhase('answered');
        dispatch({ type: 'audit/add', entry: {
          actor: 'Communication orchestrator', actorRole: 'coordinator', action: 'Guardian verified before disclosure', recordType: 'Communication',
          recordRef: 'WhatsApp · guardian of Aarav Sharma (8-B)', reason: 'Fees §5.1 + DPDP minimization — identity, relationship, permission',
          policyRef: 'Fees §5.1', aiInvolved: true, risk: 'low', outcome: '3 checks passed — deterministic answer unlocked',
        } });
      }, 1600));
      return;
    }
    if (next === 'paying') {
      setPhase('paying');
      timers.current.push(window.setTimeout(() => {
        setPayLog(paymentLifecycleSteps({ dispatch, say: () => {}, tick: () => {} }));
        setPhase('paid');
      }, 2200));
      return;
    }
    if (next === 'plan-request') {
      setPhase('plan-request');
      timers.current.push(window.setTimeout(() => {
        const c: SchoolCase = {
          id: 'case_fee_plan', kind: 'request', title: 'Fee arrangement request — 2-month installment plan (Aarav Sharma, 8-B)',
          openedOn: new Date(), openedBy: 'Communication orchestrator', owner: 'Finance (Ms. Rao)', priority: 'normal', slaHours: 48,
          status: 'open', origin: 'parent-whatsapp', campus: 'north',
          messages: [
            { on: new Date(), from: 'system', text: 'Intent classified from WhatsApp: fee arrangement request. Evidence attached: obligation FEE-2026-0821 · payment history (12 on-time, 1 unsettled attempt).', internal: true },
            { on: new Date(), from: 'system', text: 'Parent was told: "Your request has been received. The finance team will respond by tomorrow." — no promises made by AI.', internal: true },
          ],
          linkedRecords: [{ label: 'Fee obligation', ref: 'FEE-2026-0821' }, { label: 'Payment history', ref: '12 on-time · 1 unsettled' }],
        };
        setPlanCase(c);
        dispatch({ type: 'case/add', c });
        dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'fees', label: 'Case opened — fee arrangement request (owner: Finance, SLA 48h). AI acknowledged; did NOT decide.', severity: 'info' } });
        setPhase('plan-review');
      }, 2000));
      return;
    }
    if (next === 'resolved') {
      setPhase('resolved');
      timers.current.push(window.setTimeout(() => {
        dispatch({ type: 'audit/add', entry: {
          actor: 'Ms. Rao', actorRole: 'finance', action: 'Approved installment plan + closed case', recordType: 'Case',
          recordRef: 'case_fee_plan · 2-month split · next debit Nov 5', reason: 'Payment history clean; policy allows ≤2 splits per term (Fees §4.3)',
          policyRef: 'Fees §4.3', aiInvolved: false, risk: 'low',
          outcome: 'Plan recorded · parent informed · delivery verified · case closed with evidence',
        } });
      }, 1200));
      return;
    }
    setPhase(next);
  };

  const planApproved = phase === 'resolved';

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <PageHead
        title="Resolve a parent issue"
        sub="One WhatsApp thread — verified, answered from records, self-served, reconciled, and remembered"
        actions={<Link to="/demo" className="btn btn-ghost">Demo launcher</Link>}
      />

      {/* rail */}
      <Card style={{ marginBottom: 'var(--s-4)' }}>
        <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
          {['Message', 'Verify', 'Answer', 'Pay', 'Receipt', 'Request', 'Finance', 'Resolved'].map((l, i) => (
            <span key={l} className="u-inline" style={{ gap: 6, alignItems: 'center' }}>
              <span style={{
                padding: '5px 10px', borderRadius: 999, fontSize: 'var(--text-xs)', fontWeight: 570, letterSpacing: '0.04em', textTransform: 'uppercase',
                border: `1px solid ${i <= idx ? 'color-mix(in srgb, var(--success) 40%, transparent)' : 'var(--border-subtle)'}`,
                background: i <= idx ? 'color-mix(in srgb, var(--success) 8%, transparent)' : 'var(--surface-2)',
                color: i <= idx ? 'var(--success-text, var(--accent-text))' : 'var(--text-3)',
              }}>{i < idx ? '✓ ' : ''}{l}</span>
              {i < 7 && <span style={{ color: 'var(--text-3)', fontSize: 11 }}>→</span>}
            </span>
          ))}
        </div>
      </Card>

      {/* the conversation — staff-side representation of the real WhatsApp thread */}
      <Card head="Parent thread — WhatsApp" sub="Staff view of the real conversation. SchoolOS never fabricates; it answers from records.">
        <div className="u-col" style={{ gap: 10 }}>
          {idx >= FLOW.indexOf('inbound') && (
            <Bubble from="guardian" text="Hi, I was told Aarav's fee payment failed. Can you tell me what happened?" meta="received · WhatsApp · 10:02" />
          )}
          {(idx >= FLOW.indexOf('verifying') || idx >= FLOW.indexOf('answered')) && (
            <div className="u-col" style={{ gap: 6, padding: '11px 13px', border: '1px dashed var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}>
              <span className="u-upper u-xs" style={{ fontWeight: 660, color: 'var(--ai)', letterSpacing: '0.06em' }}>Verify before disclosing — internal state</span>
              {idx >= FLOW.indexOf('answered') ? (
                <div className="u-col" style={{ gap: 6 }}>
                  <VerifyRow ok label="Guardian verified" detail="phone matches household record (migrated, source-stamped)" />
                  <VerifyRow ok label="Child relationship verified" detail="Aarav Sharma · 8-B · linked guardian" />
                  <VerifyRow ok label="Fee-record permission verified" detail="guardian has fee visibility for this student only" />
                </div>
              ) : (
                <span className="u-small u-muted" style={{ animation: 'pulse 1.2s infinite' }}>checking identity → relationship → permission…</span>
              )}
            </div>
          )}
          {idx >= FLOW.indexOf('answered') && (
            <Bubble
              from="school"
              text={`Your ${PARENT_FEE.feeLabel} of ₹18,500 is currently marked unpaid because the previous payment attempt did not settle (${PARENT_FEE.attempt}). No late fee applies if you retry by Friday (Fees §4.2).`}
              meta="sources: fee obligation FEE-2026-0821 · payment attempt record — quoted from data, not generated"
            />
          )}
          {idx >= FLOW.indexOf('answered') && idx < FLOW.indexOf('paid') && (
            <div className="u-inline" style={{ gap: 8, paddingLeft: 40, flexWrap: 'wrap' }}>
              <Button variant="primary" size="sm" icon={<Icon.Money size={13} />} onClick={advance}>Pay now — ₹18,500</Button>
              <Button variant="secondary" size="sm" onClick={() => setStmtOpen(true)}>View statement</Button>
              <Button variant="ghost" size="sm" onClick={() => setTalkOpen(true)}>Talk to school</Button>
            </div>
          )}
          {talkOpen && idx < FLOW.indexOf('paid') && (
            <div className="u-col" style={{ gap: 4, padding: '9px 12px', border: '1px dashed var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', marginLeft: 40 }}>
              <span className="u-small">A callback with the finance desk is queued — Ms. Rao's team will call before 3 pm today (Fees §5.2). You can also resolve this instantly by paying now.</span>
              <span className="u-xs u-faint">The AI never blocks a human path — it adds one.</span>
            </div>
          )}
          {payLog && (
            <div className="u-col" style={{ gap: 6, padding: '11px 13px', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)', borderRadius: 'var(--r-md)' }}>
              <SectionLabel>Payment lifecycle — every step visible</SectionLabel>
              <EventTimeline items={payLog} compact />
            </div>
          )}
          {idx >= FLOW.indexOf('paid') && idx < FLOW.indexOf('plan-request') && (
            <div className="u-col" style={{ gap: 8, paddingLeft: 40 }}>
              <Badge tone="success" dot>RESOLVED — the original problem is gone from every queue</Badge>
              <Button variant="secondary" size="sm" onClick={advance}>Parent replies: “Can I split the next installment into two months?” →</Button>
            </div>
          )}
          {(idx >= FLOW.indexOf('plan-request')) && (
            <>
              <Bubble from="guardian" text="Thank you! One more thing — I need to request a two-month installment plan for the next installment." meta="reply · 10:21" />
              {planCase && (
                <div className="u-col" style={{ gap: 6, padding: '11px 13px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
                  <SectionLabel right={<Badge tone={planApproved ? 'success' : 'warning'}>{planApproved ? 'APPROVED' : 'PENDING FINANCE'}</Badge>}>Case created — not auto-answered</SectionLabel>
                  <div style={{ fontWeight: 590, fontSize: 'var(--text-sm)' }}>{planCase.title}</div>
                  <KeyValue items={[
                    { k: 'Priority', v: 'Medium' }, { k: 'Owner', v: 'Finance (Ms. Rao)' }, { k: 'SLA', v: '48 hours' },
                    { k: 'Evidence', v: 'Fee record + payment history — attached to the case' },
                    { k: 'Parent was told', v: '"Your request has been received. The finance team will respond by tomorrow."' },
                  ]} cols={2} />
                  {phase === 'plan-review' && (
                    <div className="u-inline" style={{ gap: 8, marginTop: 4 }}>
                      <Button variant="primary" size="sm" onClick={advance}>Finance reviews & approves</Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {planApproved && (
            <div className="u-col" style={{ gap: 10 }}>
              <EventTimeline items={[
                { time: '10:24', label: 'Case approved', detail: 'Ms. Rao · 2-month split allowed (Fees §4.3 — history clean)', kind: 'act' },
                { time: '10:24', label: 'Payment plan updated', detail: 'next debit Nov 5 · ledger annotated', kind: 'act' },
                { time: '10:25', label: 'Parent informed on WhatsApp', detail: 'plan confirmed in writing · delivery receipt ✓', kind: 'verify' },
                { time: '10:25', label: 'Case closed', detail: 'with evidence — approval, plan change, delivered message', kind: 'close' },
              ]} compact />
              <LoopClosed at="10:25" summary="Two requests, one thread: one self-served to ₹0, one human-approved with evidence." />
              <div className="u-col" style={{ gap: 4, padding: '11px 13px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}>
                <SectionLabel>Why was this closed?</SectionLabel>
                <div className="u-col" style={{ gap: 5 }}>
                  <VerifyRow ok label="Approved payment-plan change" detail="Fees §4.3 · decision by Finance, not AI" />
                  <VerifyRow ok label="Finance approval on the ledger" detail="actor, reason, policy ref recorded 10:24" />
                  <VerifyRow ok label="Communication delivered" detail="WhatsApp receipt attached to the case" />
                </div>
              </div>
              <ActionChain steps={PAY_CHAIN} />
              <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Link to="/audit" className="btn btn-secondary btn-sm">Open the audit ledger</Link>
                <Link to="/cases" className="btn btn-ghost btn-sm">See the case</Link>
                <Link to="/demo/summary" className="btn btn-primary btn-sm">Finish — school running →</Link>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* communication orchestrator — elegant internals */}
      <Card head="How it went out — the orchestrator" sub="The plumbing is visible for trust, hidden until you ask" style={{ marginTop: 'var(--s-4)' }}>
        <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button variant="ghost" size="sm" icon={<Icon.Operations size={13} />} onClick={() => setOrchOpen(o => !o)}>
            {orchOpen ? 'Hide details' : 'Details for advanced users'}
          </Button>
        </div>
        {orchOpen && (
          <div className="u-col" style={{ gap: 8, marginTop: 10 }}>
            <KeyValue items={[
              { k: 'Audience', v: 'Guardian of Aarav Sharma (8-B) — resolved from household link' },
              { k: 'Channel', v: 'WhatsApp Cloud API · template FEE_STATUS (Hinglish variant auto-selected)' },
              { k: 'Policy', v: 'Fees §5.1 disclosure · Communication §1.2 quiet hours & dedup' },
              { k: 'Template', v: 'payment_status_query → answer_from_records (deterministic)' },
              { k: 'Dedup', v: 'Passed — 1 message, not 3 (alerts coalesced)' },
              { k: 'Delivery', v: 'Delivered 10:02 · read 10:03 · reply classified 10:04' },
              { k: 'Reply intent', v: 'fee enquiry → routed to fee answer path (no human wait)' },
            ]} cols={2} />
          </div>
        )}
      </Card>

      {/* same event, different roles */}
      <Card head="The same event, four roles" sub="One school graph — scope-filtered, never copied" style={{ marginTop: 'var(--s-4)' }}>
        <div className="grid grid-4" style={{ gap: 10 }}>
          {[
            { r: 'Principal', sees: 'Fee issue resolved — no action needed', ref: 'briefing attention item cleared', icon: 'User' as const },
            { r: 'Finance', sees: '₹18,500 reconciled · ₹0 difference · plan approved under §4.3', ref: 'ledger entry · case closed', icon: 'Money' as const },
            { r: 'Parent', sees: 'Receipt RCP-1187 · plan confirmed for Nov 5', ref: 'the WhatsApp thread itself', icon: 'Message' as const },
            { r: 'Auditor / IT', sees: 'Full chain: verify → answer → pay → reconcile → approve → close', ref: 'audit ledger, 7 entries, every one sourced', icon: 'Lock' as const },
          ].map(x => {
            const I = Icon[x.icon];
            return (
              <div key={x.r} className="u-col" style={{ gap: 6, padding: '12px 13px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                <span className="u-inline u-small" style={{ gap: 7, fontWeight: 640 }}><I size={14} /> {x.r} sees</span>
                <span style={{ fontSize: 'var(--text-sm)', lineHeight: 1.55 }}>{x.sees}</span>
                <span className="u-xs u-faint">{x.ref}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Drawer open={stmtOpen} onClose={() => setStmtOpen(false)} title="Fee statement — Aarav Sharma (8-B)" sub="Migrated from the Tally ledger · source-stamped, read-only">
        <div className="u-col" style={{ gap: 12 }}>
          <KeyValue items={[
            { k: 'Term 2 plan', v: '₹63,500 — three installments' },
            { k: 'Installment 1 (July)', v: '₹22,500 · paid Jul 05 · receipt RCP-0982' },
            { k: 'Installment 2 (September)', v: '₹18,500 · UNSETTLED — UPI timeout Oct 12, 19:04' },
            { k: 'Amount due now', v: '₹18,500 · no late fee if paid by Friday (Fees §4.2)' },
            { k: 'Installment 3 (November)', v: '₹22,500 · due Nov 05' },
          ]} cols={1} />
          <div className="u-xs u-faint">Every line carries its payment record reference. The AI quoted this statement verbatim — it did not compose an answer.</div>
        </div>
      </Drawer>
    </div>
  );
}

function Bubble({ from, text, meta }: { from: 'guardian' | 'school'; text: string; meta: string }) {
  const mine = from === 'school';
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div className="u-col" style={{ maxWidth: '78%', gap: 3 }}>
        <div style={{
          padding: '9px 13px', borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          background: mine ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface-3)',
          border: `1px solid ${mine ? 'color-mix(in srgb, var(--accent) 25%, transparent)' : 'var(--border-subtle)'}`,
          fontSize: 'var(--text-sm)', lineHeight: 1.6,
        }}>{text}</div>
        <span className="u-xs u-faint" style={{ textAlign: mine ? 'right' : 'left' }}>{from === 'school' ? 'SchoolOS · from records' : 'Parent'} · {meta}</span>
      </div>
    </div>
  );
}
