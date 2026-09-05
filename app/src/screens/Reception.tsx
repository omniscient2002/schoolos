/* ============================================================
   Reception — the AI front desk.
   Answers every call from school records, never guesses,
   hands off with context, and shows its work. This is the
   "AI Reception" company DNA applied to the school gate:
   phone + WhatsApp + walk-in, one desk, zero hold music.
   ============================================================ */
import { useState } from 'react';
import { useStore } from '../state/store';
import * as d from '../data/dataset';
import { PageHead, Card, Stat, Badge, Button, Drawer, Empty, Avatar, useToast, KeyValue } from '../components/ui';
import { EvidenceChain, AiTraceCard } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtTime, fmtDateTime } from '../lib/format';
import type { ReceptionCall } from '../types/domain';

const OUTCOME_META: Record<ReceptionCall['outcome'], { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  resolved: { label: 'Resolved by AI', tone: 'success' },
  handoff: { label: 'Handed to staff', tone: 'warning' },
  'callback-scheduled': { label: 'Callback booked', tone: 'info' },
  voicemail: { label: 'No response', tone: 'neutral' },
};

const INTENT_ICON: Record<string, keyof typeof Icon> = {
  transport: 'Bus', fees: 'Money', attendance: 'Clipboard', documents: 'Document',
  admissions: 'Graduation', maintenance: 'Wrench', hours: 'Clock', emergency: 'Alert', other: 'Phone',
};

function CallBubbles({ call }: { call: ReceptionCall }) {
  return (
    <div className="u-col" style={{ gap: 10 }}>
      {call.transcript.map((t, i) => {
        const isAi = t.speaker === 'ai';
        const isStaff = t.speaker === 'human-staff';
        return (
          <div key={i} style={{ display: 'flex', justifyContent: isAi ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '82%', padding: '10px 14px', borderRadius: 14,
              borderTopRightRadius: isAi ? 4 : 14, borderTopLeftRadius: isAi ? 14 : 4,
              fontSize: 'var(--text-sm)', lineHeight: 1.6,
              background: isStaff ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                : isAi ? 'color-mix(in srgb, var(--ai) 10%, transparent)' : 'var(--surface-3)',
              border: '1px solid var(--border-subtle)',
            }}>
              <div className="u-xs u-faint" style={{ marginBottom: 3 }}>
                {isStaff ? 'Staff (joined live)' : isAi ? 'Reception AI' : 'Caller'} · {t.at}s
              </div>
              {t.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Reception() {
  const { session } = useStore();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<'calls' | 'visitors' | 'passes'>('calls');
  const a = d.deskAnalytics();
  const call = openId ? d.callById(openId) : undefined;
  const onCampus = d.visitors.filter(v => !v.out);
  const isDeskStaff = ['coordinator', 'principal', 'owner', 'facilities'].includes(session.roleId);

  return (
    <div>
      <PageHead
        title="Front desk"
        sub={`The AI receptionist — every call answered in ${a.avgAnswerSec}s from school records · ${d.deskSettings.hours}`}
        actions={
          <div className="u-inline" style={{ gap: 8 }}>
            <Badge tone="success" dot>Desk online</Badge>
            {isDeskStaff && (
              <Button variant="secondary" icon={<Icon.Phone size={14} />} onClick={() => toast({
                title: 'Simulated call ringing…', tone: 'info',
                sub: 'Demo: the AI answers in 3s with the consent line, then grounds every answer in school records.',
              })}>Test call</Button>
            )}
          </div>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
        <Stat label="Calls today" value={a.callsToday} sub={`${a.missedCalls} missed · 0 hold time`} />
        <Stat label="Answered by AI" value={`${Math.round((a.answeredByAi / a.callsToday) * 100)}%`} sub="rest handed off with full context" />
        <Stat label="Avg first answer" value={`${a.avgAnswerSec}s`} sub="vs 26s industry ring average" />
        <Stat label="On campus now" value={onCampus.length} sub={`${d.gatePasses.length} gate passes issued today`} />
      </div>

      <div className="maint-grid">
        <div className="u-col" style={{ gap: 'var(--s-4)' }}>
          <Card
            head={tab === 'calls' ? 'Today\u2019s calls' : tab === 'visitors' ? 'Visitor register' : 'Gate passes'}
            actions={
              <div className="u-inline" style={{ gap: 4 }}>
                {([['calls', 'Calls'], ['visitors', 'Visitors'], ['passes', 'Gate passes']] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setTab(id)} className={`btn btn-sm ${tab === id ? 'btn-secondary' : 'btn-ghost'}`}>{label}</button>
                ))}
              </div>
            }
          >
            {tab === 'calls' && (
              <div className="u-col" style={{ gap: 8 }}>
                {d.calls.map(c => {
                  const I = Icon[INTENT_ICON[c.intents[0]] ?? 'Phone'];
                  return (
                    <button key={c.id} onClick={() => setOpenId(c.id)} className="u-inline" style={{
                      gap: 12, alignItems: 'center', textAlign: 'left', width: '100%',
                      padding: '10px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)', background: 'var(--surface-1)', cursor: 'pointer',
                    }}>
                      <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-3)', display: 'grid', placeItems: 'center', color: 'var(--text-2)' }}><I size={16} /></span>
                      <div className="u-col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                        <span className="u-inline" style={{ gap: 8 }}>
                          <span style={{ fontWeight: 570, fontSize: 'var(--text-sm)' }}>{c.callerName ?? 'Unknown caller'}</span>
                          <span className="u-mono u-xs u-faint">{c.id} · {c.channel}</span>
                        </span>
                        <span className="u-small u-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.transcript[1]?.text ?? c.transcript[0]?.text}
                        </span>
                      </div>
                      <div className="u-col" style={{ gap: 3, alignItems: 'flex-end' }}>
                        <Badge tone={OUTCOME_META[c.outcome].tone}>{OUTCOME_META[c.outcome].label}</Badge>
                        <span className="u-xs u-faint">{fmtTime(c.on)} · {c.durationSec}s · {c.language}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {tab === 'visitors' && (
              <div className="u-col" style={{ gap: 8 }}>
                {d.visitors.map(v => (
                  <div key={v.id} className="u-inline" style={{ gap: 12, alignItems: 'center' }}>
                    <Avatar name={v.name} size="sm" />
                    <div className="u-col" style={{ gap: 2, flex: 1 }}>
                      <span className="u-inline" style={{ gap: 8 }}>
                        <span style={{ fontWeight: 560, fontSize: 'var(--text-sm)' }}>{v.name}</span>
                        <Badge tone={v.preRegistered ? 'info' : 'neutral'}>{v.preRegistered ? 'Pre-registered' : 'Walk-in'}</Badge>
                      </span>
                      <span className="u-small u-muted">{v.purpose} · host {v.host} · badge {v.badgeNo} · in {fmtTime(v.on)}{v.out ? ` · out ${fmtTime(v.out)}` : ''}</span>
                    </div>
                    {v.photoVerified ? <Badge tone="success" dot>ID verified</Badge> : <Badge tone="warning">ID pending</Badge>}
                  </div>
                ))}
                <div className="u-small u-muted" style={{ marginTop: 4 }}>
                  Visitors on campus: {onCampus.length}. Badge expiry + host-check reminders fire automatically 2 hours after sign-in.
                </div>
              </div>
            )}

            {tab === 'passes' && (
              <div className="u-col" style={{ gap: 8 }}>
                {d.gatePasses.map(g => (
                  <div key={g.id} className="u-col" style={{ gap: 4, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                    <span className="u-inline" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 570, fontSize: 'var(--text-sm)' }}>{g.student} · {g.section}</span>
                      <span className="u-mono u-xs u-faint">{g.id} · {fmtTime(g.on)}</span>
                    </span>
                    <span className="u-small u-muted">{g.reason} · approved by {g.approvedBy} · collected by {g.collectedBy}</span>
                    <span className="u-xs" style={{ color: g.guardianSms ? 'var(--success-text, var(--accent-text))' : 'var(--warning)' }}>
                      {g.guardianSms ? 'Guardian informed on WhatsApp before departure (Safeguarding §2.1)' : 'Guardian confirmation pending'}
                    </span>
                  </div>
                ))}
                {d.gatePasses.length === 0 && <Empty icon={<Icon.Document size={20} />} title="No gate passes today" />}
              </div>
            )}
          </Card>

          <Card head="What the desk answers" sub="Intent mix today — and what resolves without a human">
            <div className="u-col" style={{ gap: 9 }}>
              {d.deskIntents.map(i => (
                <div key={i.id} className="u-col" style={{ gap: 3 }}>
                  <div className="u-between">
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 540 }}>{i.label}</span>
                    <span className="u-small u-muted u-mono">{i.callsToday} calls · {i.resolvedByAiPct}% AI</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden' }}>
                    <div style={{ width: `${i.resolvedByAiPct}%`, height: '100%', background: 'var(--ai)', borderRadius: 4 }} />
                  </div>
                  <span className="u-xs u-faint">“{i.example}”</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="u-col" style={{ gap: 'var(--s-4)' }}>
          <Card head="How this desk works" sub="Grounded, consented, hand-off ready">
            <KeyValue items={[
              { k: 'Answers from', v: 'Calendar · transport GPS · fee ledger · attendance · documents · asset records' },
              { k: 'Languages', v: d.deskSettings.languages.join(' · ') },
              { k: 'Never does', v: 'Disclose student data to unverified callers · negotiate fees · medical or safeguarding advice' },
              { k: 'Handoff', v: `${d.deskSettings.escalationNumber} — with call summary, caller history, and sentiment attached` },
              { k: 'Emergency', v: d.deskSettings.emergencyPolicy },
              { k: 'Recording', v: d.deskSettings.recordingConsentLine },
            ]} cols={1} />
            <div className="divider" />
            <div className="u-small u-muted" style={{ lineHeight: 1.65 }}>
              Every answer is grounded in a record and cited on the call log. When confidence is low or the topic is sensitive,
              the desk says so and connects a human — a handoff is a success, not a failure.
            </div>
          </Card>

          <Card head="Today's desk performance" sub="Recomputed from the call log">
            <KeyValue items={[
              { k: 'Handoff rate', v: `${a.handoffRate}% (target ≤ 15%)` },
              { k: 'Avg call', v: `${Math.round(a.avgDurationSec)}s` },
              { k: 'Guardrail triggers', v: `${a.guardrailTriggers} — hazard report auto-handoff (Front Desk §1.3)` },
              { k: 'Cost today', v: '₹11.40 (voice minutes + ASR + LLM) vs ₹1,200 part-time desk hour' },
            ]} cols={1} />
            <AiTraceCard
              trace={{
                trigger: 'Live call answering (phone/WhatsApp)',
                policy: 'Front Desk §1.1–1.4 — grounded answers only; student data only after caller verification',
                dataUsed: ['calendar', 'transport GPS', 'fee ledger', 'attendance register', 'document requests'],
                reasoningRole: 'Voice receptionist (deterministic retrieval + templates)',
                action: 'Answers, files reports, books callbacks — never approves anything',
                approvalStatus: 'Not required (read-only + message filing)',
                verification: 'Transcript stored beside parsed fields; wrong parses are visible and editable',
                model: 'Voice ASR (hi/en) + Fast (classification) · ap-south-1',
                latencyMs: 900,
                tokens: 640,
                cost: '₹0.23/call avg',
              }}
            />
          </Card>

          <Card head="Escalation ladder" sub="Who gets woken up, in order">
            <EvidenceChain
              title="Front Desk §1.4"
              steps={[
                { label: '1 · Answer from records', detail: 'Facts only — timings, status, balances, references', source: 'Read-only retrieval', refType: 'reception' },
                { label: '2 · Book a callback', detail: 'Route to owning team with transcript + records attached', source: 'Callback queue', refType: 'reception' },
                { label: '3 · Live human handoff', detail: 'Low confidence, frustration, or sensitive topics — summary travels with the call', source: 'Front office', refType: 'reception' },
                { label: '4 · Emergency interrupt', detail: 'Safety/medical keywords ring the duty principal and nurse immediately', source: 'Front Desk §1.4', refType: 'reception' },
              ]}
            />
          </Card>
        </div>
      </div>

      <Drawer open={!!call} onClose={() => setOpenId(null)} title={call ? `${call.id} — ${call.callerName ?? 'Unknown caller'}` : ''} sub={call ? `${fmtDateTime(call.on)} · ${call.channel} · ${call.durationSec}s · ${call.language}` : ''}>
        {call && (
          <div className="u-col" style={{ gap: 14 }}>
            <CallBubbles call={call} />
            <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Badge tone={OUTCOME_META[call.outcome].tone}>{OUTCOME_META[call.outcome].label}</Badge>
              {call.handedOffTo && <Badge tone="warning">Handed to {call.handedOffTo} — {call.handoffReason}</Badge>}
              {call.callbackFor && <Badge tone="info">Callback: {call.callbackFor}</Badge>}
              <Badge tone={call.callerSentiment === 'frustrated' ? 'warning' : 'neutral'}>Sentiment: {call.callerSentiment}</Badge>
              <Badge tone="neutral">{call.recordingConsent ? 'Recording consented' : 'Recording off'}</Badge>
            </div>
            {call.linkedRecords && (
              <EvidenceChain
                title="What grounded the answers"
                steps={call.linkedRecords.map(r => ({ label: r, detail: 'Retrieved live during the call', source: 'School records · read-only', refType: 'reception' }))}
              />
            )}
            <AiTraceCard
              trace={{
                trigger: `Call ${call.id} — intent: ${call.intents.join(', ')}`,
                policy: 'Front Desk §1.1 — grounded answers only; no student data to unverified callers',
                dataUsed: call.linkedRecords ?? ['general knowledge base'],
                reasoningRole: 'Voice receptionist (deterministic retrieval + templates)',
                action: call.outcome === 'handoff' ? `Connected ${call.handedOffTo} with full context` : 'Answered and logged; nothing executed',
                approvalStatus: 'Not required (read-only)',
                verification: 'Transcript + parsed outcomes stored for spot-check and tuning',
                model: 'Voice ASR (hi/en) + Fast (classification) · ap-south-1',
                latencyMs: 820,
                tokens: Math.round(call.durationSec * 14),
                cost: '₹0.21',
              }}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
