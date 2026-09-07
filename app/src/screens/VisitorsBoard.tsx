/* ============================================================
   VisitorsBoard — ops.visitors gate pass (unit 15).
   Server truth (migration 024, DESK-gated doors):
   - POST /plugins/ops.visitors/visitors          log (badge V-XXXXXXXX)
   - GET  /plugins/ops.visitors/visitors          list
   - POST .../:id/checkin                         expected → checked_in
   - POST .../:id/pickup                          raises OTP to PRIMARY guardian (kernel vault)
   - POST .../:id/pickup/verify                   attempt-bounded, single-use, timingSafeEqual
   - POST .../:id/complete                        FAIL-CLOSED for unverified pickup:
                                                  409 'student release is BLOCKED' unless an
                                                  audited owner/principal override WITH note
   - POST .../:id/deny                            gate refusal
   THE HEADLINE is the release gate: the blocked state renders BEFORE any click
   (danger chip on the row), the override is owner/principal-only and requires a
   mandatory note — never a silent pass. Server errors surface verbatim.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHead, Card, Stat, Badge, Button, useToast, Empty, ErrorState, SkeletonCard, DataTable, Modal, Dropdown,
} from '../components/ui';
import { fmtRelative } from '../lib/format';
import { friendly } from '../lib/friendlyErrors';
import { Icon } from '../components/Icon';
import {
  LIVE_API, apiVisitorsList, apiVisitorLog, apiVisitorCheckin, apiVisitorPickup,
  apiVisitorVerify, apiVisitorComplete, apiVisitorDeny, type ApiVisitorVisit,
} from '../services/liveApi';
import { useStore } from '../state/store';
import { useSession } from '../App';
import type { RoleId } from '../types/domain';
import { apiStudents } from '../services/liveApi';

/* server DESK set (front-desk authority) — the UI mirrors it, the server decides */
const DESK = ['owner', 'principal', 'itadmin', 'coordinator'];
const OVERRIDE_ROLES = ['owner', 'principal'];

const STATUS_META: Record<string, { label: string; tone: 'info' | 'accent' | 'ai' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  expected: { label: 'Expected', tone: 'info' },
  checked_in: { label: 'On campus', tone: 'accent' },
  pickup_pending: { label: 'Pickup — OTP pending', tone: 'warning' },
  verified: { label: 'Guardian verified', tone: 'success' },
  completed: { label: 'Completed', tone: 'neutral' },
  denied: { label: 'Denied', tone: 'danger' },
};
const TERMINAL = new Set(['completed', 'denied']);


/** release-gate state per row — the fail-closed mirror of the server's law */
function releaseState(v: ApiVisitorVisit): 'blocked' | 'authorized' | 'none' {
  if (v.purpose === 'pickup' && v.studentName) return v.verified ? 'authorized' : 'blocked';
  return 'none';
}

export default function VisitorsBoard() {
  const toast = useToast();
  const { actorName, dispatch } = useStore();
  const live = useSession();
  const desk = (DESK as string[]).includes(live.role);
  const canOverride = (OVERRIDE_ROLES as string[]).includes(live.role);

  const [visits, setVisits] = useState<ApiVisitorVisit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  /* log form */
  const [logOpen, setLogOpen] = useState(false);
  const [logName, setLogName] = useState('');
  const [logPhone, setLogPhone] = useState('');
  const [logPurpose, setLogPurpose] = useState('visit');
  const [logDetail, setLogDetail] = useState('');
  const [logStudent, setLogStudent] = useState('');
  const [logBusy, setLogBusy] = useState(false);

  /* release-gate modal (fail-closed complete for unverified pickup) */
  const [releaseFor, setReleaseFor] = useState<ApiVisitorVisit | null>(null);
  const [note, setNote] = useState('');

  /* OTP verify modal */
  const [verifyFor, setVerifyFor] = useState<ApiVisitorVisit | null>(null);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [deniedNoteFor, setDenyNoteFor] = useState<ApiVisitorVisit | null>(null);
  const [denyNote, setDenyNote] = useState('');

  useEffect(() => {
    if (!desk) return;
    let liveReq = true;
    setLoading(true); setError(null);
    apiVisitorsList()
      .then(d => { if (liveReq) { setVisits(d.visits); setLoading(false); } })
      .catch(e => { if (liveReq) { setError(friendly(e)); setLoading(false); } });
    return () => { liveReq = false; };
  }, [tick, desk]);

  const auditEntry = (v: ApiVisitorVisit, action: string, outcome: string, risk: 'low' | 'medium' | 'high') => dispatch({
    type: 'audit/add',
    entry: {
      actor: actorName, actorRole: live.role as RoleId, action,
      recordType: 'VisitorPass', recordRef: `${v.badge} · ${v.visitorName}`,
      reason: 'gate pass', policyRef: 'Student safety · guardian pickup verification',
      aiInvolved: false, risk, outcome,
    },
  });

  const act = async (v: ApiVisitorVisit, what: 'checkin' | 'pickup' | 'complete' | 'deny', noteText?: string, override = false) => {
    setBusyId(v.id);
    try {
      if (what === 'checkin') { await apiVisitorCheckin(v.id); toast({ title: `${v.visitorName} checked in`, sub: `Badge ${v.badge} · on campus.`, tone: 'success' }); auditEntry(v, 'Visitor checked in', 'on campus', 'low'); }
      if (what === 'pickup') {
        const r = await apiVisitorPickup(v.id);
        setDevCode(r.devCode ?? null);
        toast({ title: 'Pickup OTP raised', sub: `6-digit code sent to the primary guardian · valid ${r.ttlMinutes}m (single-use, attempt-bounded).`, tone: 'success' });
        auditEntry(v, 'Pickup OTP raised', `Code sent to the guardian, valid ${r.ttlMinutes} minutes — stored encrypted`, 'medium');
      }
      if (what === 'complete') {
        const r = await apiVisitorComplete(v.id, override, noteText);
        toast({
          title: r.overrideUsed ? 'UNVERIFIED RELEASE — OVERRIDE USED' : 'Visit completed',
          sub: r.overrideUsed ? 'Student released without guardian verification. Owner/Principal override recorded as a high-risk audit entry.' : `${v.visitorName} signed out.`,
          tone: r.overrideUsed ? 'info' : 'success',
        });
        auditEntry(v, r.overrideUsed ? 'Visit completed (UNVERIFIED RELEASE OVERRIDE)' : 'Visit completed',
          r.overrideUsed ? `UNVERIFIED RELEASE OVERRIDE: ${noteText}` : 'completed', r.overrideUsed ? 'high' : 'low');
      }
      if (what === 'deny') { await apiVisitorDeny(v.id, noteText); toast({ title: 'Visitor denied', sub: noteText ? `Refusal note recorded.` : 'Entry refused at the gate.', tone: 'info' }); auditEntry(v, 'Visitor denied', noteText ? `denied: ${noteText}` : 'denied', 'low'); }
      setTick(t => t + 1);
    } catch (e) {
      /* server law surfaces verbatim — the fail-closed message is the feature */
      toast({ title: 'Action blocked', sub: friendly(e), tone: 'error' });
    } finally { setBusyId(null); }
  };

  const submitLog = async () => {
    if (!logName.trim() || (logPurpose === 'pickup' && !logStudent)) return;
    setLogBusy(true);
    try {
      const r = await apiVisitorLog({
        visitorName: logName.trim(), visitorPhone: logPhone.trim() || undefined,
        purpose: logPurpose, detail: logDetail.trim() || undefined,
        studentId: logPurpose === 'pickup' ? logStudent : undefined,
      });
      setLogOpen(false); setLogName(''); setLogPhone(''); setLogDetail(''); setLogStudent(''); setLogPurpose('visit');
      toast({ title: `Visitor logged — badge ${r.badge}`, sub: logPurpose === 'pickup' ? 'Pickup visits release fail-closed: the guardian OTP must verify first.' : 'Gate pass issued.', tone: 'success' });
      auditEntry({ badge: r.badge, visitorName: logName.trim() } as ApiVisitorVisit, 'Visitor logged', `expected (${logPurpose}) · badge ${r.badge}`, 'low');
      setTick(t => t + 1);
    } catch (e) {
      toast({ title: 'Could not log visitor', sub: friendly(e), tone: 'error' });
    } finally { setLogBusy(false); }
  };

  const submitVerify = async () => {
    if (!verifyFor || code.trim().length !== 6) return;
    setBusyId(verifyFor.id);
    try {
      await apiVisitorVerify(verifyFor.id, code.trim());
      toast({ title: 'Guardian verified', sub: `${verifyFor.visitorName} — student release authorized.`, tone: 'success' });
      auditEntry(verifyFor, 'Guardian pickup verified', 'guardian OTP verified — student release authorized', 'medium');
      setVerifyFor(null); setCode(''); setDevCode(null);
      setTick(t => t + 1);
    } catch (e) {
      toast({ title: 'Verification failed', sub: friendly(e), tone: 'error' });
    } finally { setBusyId(null); }
  };

  const stats = useMemo(() => {
    const by = (s: string) => (visits ?? []).filter(v => v.status === s).length;
    return {
      expected: by('expected'),
      onCampus: by('checked_in') + by('pickup_pending') + by('verified'),
      pendingOtp: by('pickup_pending'),
      released: by('completed'),
    };
  }, [visits]);

  /* pickup roster comes from the SERVER student domain (app.students UUIDs): the
     capture door validates studentId against it, and the demo dataset uses a
     different id space — sending dataset ids would fail the FK check server-side */
  const [studentOptions, setStudentOptions] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let liveReq = true;
    apiStudents()
      .then(r => {
        if (!liveReq) return;
        setStudentOptions((r.students ?? []).map((st: Record<string, unknown>) => {
          const id = String(st.id ?? '');
          const grade = st.grade ? ` · Grade ${st.grade}${st.section ? String(st.section) : ''}` : '';
          return { id, label: `${String(st.name ?? id)}${grade}` };
        }).filter(o => o.id));
      })
      .catch(() => { if (liveReq) setStudentOptions([]); });
    return () => { liveReq = false; };
  }, []);

  if (!LIVE_API) {
    return <Card pad><Empty icon={<Icon.Database size={22} />} title="Live API not enabled" sub="The gate-pass desk reads the ops.visitors plugin doors — run with VITE_LIVE_API=1." /></Card>;
  }
  if (!desk) {
    /* server truth: every visitors door 403s non-DESK roles — no masked tier exists */
    return (
      <div>
        <PageHead title="Visitors" sub="Campus gate pass." />
        <Empty icon={<Icon.Lock size={22} />} title="Front-desk surface" sub="Gate-pass records are restricted to front-desk roles (owner, principal, IT admin, coordinator). The server rejects every door for other roles — there is no masked view of visitor PII." />
      </div>
    );
  }
  if (loading) return <SkeletonCard lines={8} />;
  if (error) return <ErrorState title="Could not load gate-pass log" sub={error.replace('Error: ', '')} onRetry={() => setTick(t => t + 1)} />;



  const blocked = (v: ApiVisitorVisit) => releaseState(v) === 'blocked';

  return (
    <div>
      <PageHead
        title="Visitors"
        sub="Gate pass desk — badges at the gate. Student pickups release fail-closed: the guardian OTP must verify first; only an audited owner/principal override with a note can bypass."
        actions={<Button variant="primary" icon={<Icon.Users size={14} />} onClick={() => setLogOpen(true)}>Log visitor</Button>}
      />

      <div className="grid grid-4" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 16, marginBottom: 24 }}>
        <Stat label="Expected" value={stats.expected} sub="Logged, not yet on campus" />
        <Stat label="On campus" value={stats.onCampus} sub="Checked in, incl. pickup flows" />
        <Stat label="Pickup OTP pending" value={stats.pendingOtp} sub="Awaiting guardian code" />
        <Stat label="Released / completed" value={stats.released} sub="Signed out today" />
      </div>

      <Card pad style={{ marginBottom: 24, borderColor: 'var(--danger-weak-2)' }}>
        <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
          <Icon.Lock size={13} style={{ color: 'var(--danger)' }} />
          <span className="u-small" style={{ fontWeight: 600 }}>The safety rule: a student only leaves with a visitor once the guardian confirms their code.</span>
          <span className="u-small u-faint">Safety comes first: the server will not release a student without verification. In an emergency the owner or principal can override — with a written note, and it is always logged.</span>
        </div>
      </Card>

      {(visits ?? []).length === 0 ? (
        <Empty icon={<Icon.Shield size={22} />} title="No visitors logged" sub="Log a visitor at the gate to issue a badge. Student pickups require a student link for guardian verification." />
      ) : (
        <DataTable<ApiVisitorVisit>
          caption="Gate-pass log — visitor PII is front-desk only (server rejects every door for other roles)"
          rows={visits ?? []}
          rowKey={v => v.id}
          columns={[
            {
              key: 'visitor', label: 'Visitor', sortable: true, sortValue: v => v.visitorName,
              render: v => (
                <div>
                  <div style={{ fontWeight: 570 }}>{v.visitorName}</div>
                  <div className="u-xs u-faint">{v.visitorPhone ?? 'no phone on pass'}</div>
                </div>
              ),
            },
            {
              key: 'purpose', label: 'Purpose', sortable: true,
              render: v => (
                <div>
                  <div className="u-small">{v.purpose}</div>
                  {v.detail && <div className="u-xs u-faint">{v.detail}</div>}
                </div>
              ),
            },
            { key: 'student', label: 'Student', render: v => v.studentName ? <span className="u-small">{v.studentName}</span> : <span className="u-faint u-small">—</span> },
            { key: 'badge', label: 'Badge', sortable: true, render: v => <span className="u-small" style={{ fontFamily: 'var(--mono, monospace)', letterSpacing: 0.4 }}>{v.badge}</span> },
            { key: 'status', label: 'Status', sortable: true, render: v => <Badge tone={STATUS_META[v.status]?.tone ?? 'neutral'}>{STATUS_META[v.status]?.label ?? v.status}</Badge> },
            {
              /* THE HEADLINE: fail-closed release state, visible BEFORE any click */
              key: 'release', label: 'Release',
              render: v => {
                const rs = releaseState(v);
                if (rs === 'blocked') return <Badge tone="danger" dot><Icon.Lock size={10} style={{ verticalAlign: -1, marginRight: 3 }} />Blocked — guardian OTP required</Badge>;
                if (rs === 'authorized') return <Badge tone="success">Authorized</Badge>;
                return <span className="u-faint u-small">gate pass</span>;
              },
            },
            { key: 'updated', label: 'Updated', sortable: true, sortValue: v => new Date(v.updatedAt).getTime(), render: v => <span className="u-small">{fmtRelative(v.updatedAt)}</span> },
            {
              key: 'actions', label: 'Actions', align: 'right',
              render: v => {
                if (TERMINAL.has(v.status)) return <span className="u-faint u-small">Closed</span>;
                const pickupPossible = !!v.studentName && ['expected', 'checked_in'].includes(v.status);
                return (
                  <div className="u-flex" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {v.status === 'expected' && <Button size="sm" variant="secondary" disabled={busyId === v.id} onClick={() => act(v, 'checkin')}>Check in</Button>}
                    {pickupPossible && <Button size="sm" variant="secondary" disabled={busyId === v.id} onClick={() => act(v, 'pickup')}>Request pickup OTP</Button>}
                    {v.status === 'pickup_pending' && <Button size="sm" variant="primary" onClick={() => { setVerifyFor(v); setCode(''); setDevCode(null); }}>Enter OTP</Button>}
                    {['checked_in', 'verified', 'pickup_pending'].includes(v.status) && (
                      blocked(v)
                        ? <Button size="sm" variant="danger" onClick={() => { setReleaseFor(v); setNote(''); }}>Release…</Button>
                        : <Button size="sm" variant="primary" disabled={busyId === v.id} onClick={() => act(v, 'complete')}>Complete</Button>
                    )}
                    <Dropdown
                      label={`More actions for ${v.visitorName}`}
                      trigger={() => (
                        <button className="btn btn-ghost btn-sm" aria-label={`More actions for ${v.visitorName}`} title="More actions">More</button>
                      )}
                    >
                      {(close: () => void) => (
                        <div className="u-col" style={{ padding: 4 }}>
                          <div role="none" className="dropdown-label">Actions</div>
                          {v.status === 'pickup_pending' && (
                            <button role="menuitem" className="dropdown-item" onClick={() => { close(); setVerifyFor(v); setCode(''); setDevCode(null); }}>Verify pickup OTP</button>
                          )}
                          <button role="menuitem" className="dropdown-item" onClick={() => { close(); setDenyNoteFor(v); setDenyNote(''); }}>Deny entry…</button>
                        </div>
                      )}
                    </Dropdown>
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <div style={{ height: 20 }} />
      <div className="u-small u-muted">
        Badges use server-issued codes. Guardian codes are stored encrypted, expire quickly, work once, and stop after too many tries — the desk never sees the code itself.
        Release is fail-closed server-side; the blocked state you see on unverified pickup rows mirrors the server's 409 before you click.
      </div>

      {/* ---- log visitor ---- */}
      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="Log visitor" sub="Issues a gate-pass badge (V-XXXXXXXX) and puts the visit on the desk log.">
        <div className="u-col" style={{ gap: 10 }}>
          <div className="u-col" style={{ gap: 4 }}>
            <label className="u-small u-muted" htmlFor="v-name">Visitor name *</label>
            <input id="v-name" className="input" value={logName} onChange={e => setLogName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="u-col" style={{ gap: 4 }}>
            <label className="u-small u-muted" htmlFor="v-phone">Visitor phone</label>
            <input id="v-phone" className="input" value={logPhone} onChange={e => setLogPhone(e.target.value)} placeholder="Optional — contact on the pass" />
          </div>
          <div className="u-col" style={{ gap: 4 }}>
            <label className="u-small u-muted" htmlFor="v-purpose">Purpose *</label>
            <select id="v-purpose" className="input" value={logPurpose} onChange={e => { setLogPurpose(e.target.value); if (e.target.value !== 'pickup') setLogStudent(''); }}>
              <option value="visit">Visit</option>
              <option value="pickup">Student pickup — guardian-verified release</option>
              <option value="delivery">Delivery</option>
              <option value="vendor">Vendor / contractor</option>
              <option value="meeting">Meeting</option>
            </select>
          </div>
          {logPurpose === 'pickup' && (
            <div className="u-col" style={{ gap: 4 }}>
              <label className="u-small u-muted" htmlFor="v-student">Student being picked up *</label>
              <select id="v-student" className="input" value={logStudent} onChange={e => setLogStudent(e.target.value)}>
                <option value="">Select a student…</option>
                {studentOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <span className="u-xs u-faint">Pickup raises a 6-digit OTP to the student's primary guardian. Without verification, release is blocked.</span>
            </div>
          )}
          <div className="u-col" style={{ gap: 4 }}>
            <label className="u-small u-muted" htmlFor="v-detail">Detail</label>
            <input id="v-detail" className="input" value={logDetail} onChange={e => setLogDetail(e.target.value)} placeholder="Optional note" />
          </div>
        </div>
        <footer className="u-flex" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={() => setLogOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={!logName.trim() || (logPurpose === 'pickup' && !logStudent) || logBusy} onClick={submitLog}>
            {logBusy ? 'Logging…' : 'Issue gate pass'}
          </Button>
        </footer>
      </Modal>

      {/* ---- THE HEADLINE: fail-closed release gate / audited override ---- */}
      <Modal open={!!releaseFor} onClose={() => setReleaseFor(null)} title="Student release is BLOCKED" sub="This pickup has no verified guardian OTP.">
        <div style={{ border: '1px solid var(--danger)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
            <Icon.Lock size={14} style={{ color: 'var(--danger)' }} />
            <span className="u-small" style={{ fontWeight: 650, color: 'var(--danger)' }}>no_release_without_verification</span>
          </div>
          <p className="u-small" style={{ margin: '6px 0 0', lineHeight: 1.6 }}>
            Server law: <b>student release is BLOCKED</b> — pickup not guardian-verified
            {releaseFor && <> for <b>{releaseFor.visitorName}</b> picking up <b>{releaseFor.studentName}</b></>}.
            Verify the guardian OTP on this pass first, or use the override below.
          </p>
        </div>
        {canOverride ? (
          <div className="u-col" style={{ gap: 8 }}>
            <div className="u-small" style={{ fontWeight: 620 }}>Owner / Principal override</div>
            <p className="u-xs u-faint" style={{ margin: 0, lineHeight: 1.6 }}>
              Bypassing verification releases the student WITHOUT guardian confirmation. The action is recorded as a high-risk
              audit entry naming you and your note. Never bypass to avoid a phone call.
            </p>
            <label className="u-small u-muted" htmlFor="v-note">Mandatory note *</label>
            <textarea
              id="v-note" className="input" rows={3} maxLength={200} value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Why is the release proceeding without guardian OTP verification?"
              style={{ resize: 'vertical' }}
            />
            <span className="u-xs u-faint">{note.length}/200 — a note is required; the override button stays disabled without one.</span>
          </div>
        ) : (
          <p className="u-small u-faint" style={{ margin: 0, lineHeight: 1.6 }}>
            Your role cannot override this gate. Ask an owner or principal — their override (with a note) is the only bypass, and the server enforces it.
          </p>
        )}
        <footer className="u-flex" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={() => setReleaseFor(null)}>Cancel</Button>
          {releaseFor && canOverride && (
            <Button variant="danger" disabled={!note.trim() || busyId === releaseFor.id} onClick={() => { act(releaseFor, 'complete', note.trim(), true); setReleaseFor(null); }}>
              Override & release (audited)
            </Button>
          )}
        </footer>
      </Modal>

      {/* ---- OTP verify ---- */}
      <Modal open={!!verifyFor} onClose={() => { setVerifyFor(null); setDevCode(null); }} title="Verify pickup OTP" sub="The 6-digit code was sent to the student's primary guardian. Single-use, attempt-bounded.">
        {devCode && <div style={{ marginBottom: 10 }}><Badge tone="warning">dev mode</Badge> <span className="u-xs u-faint">SMS provider not wired — code: <b>{devCode}</b></span></div>}
        <div className="u-col" style={{ gap: 8 }}>
          <label className="u-small u-muted" htmlFor="v-code">Guardian code</label>
          <input
            id="v-code" className="input" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="••••••" style={{ letterSpacing: 6, fontSize: 'var(--text-lg)', textAlign: 'center' }}
          />
        </div>
        <footer className="u-flex" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={() => { setVerifyFor(null); setDevCode(null); }}>Cancel</Button>
          <Button variant="primary" disabled={code.trim().length !== 6 || !verifyFor || busyId === verifyFor.id} onClick={submitVerify}>Verify</Button>
        </footer>
      </Modal>

      {/* ---- deny ---- */}
      <Modal open={!!deniedNoteFor} onClose={() => setDenyNoteFor(null)} title="Deny entry" sub="Refuses this visitor at the gate. The note is recorded in the audit trail.">
        <label className="u-small u-muted" htmlFor="v-deny">Note</label>
        <textarea id="v-deny" className="input" rows={2} maxLength={200} value={denyNote} onChange={e => setDenyNote(e.target.value)} placeholder="Optional reason" style={{ resize: 'vertical', marginTop: 4 }} />
        <footer className="u-flex" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={() => setDenyNoteFor(null)}>Cancel</Button>
          <Button variant="danger" disabled={!deniedNoteFor || busyId === deniedNoteFor.id} onClick={() => { if (deniedNoteFor) { act(deniedNoteFor, 'deny', denyNote.trim() || undefined); setDenyNoteFor(null); } }}>Deny</Button>
        </footer>
      </Modal>
    </div>
  );
}
