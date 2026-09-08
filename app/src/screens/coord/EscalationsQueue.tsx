/* ============================================================
   EscalationsQueue — parent/student escalations landing on the
   coordinator desk (GET /coord/escalations): family requests
   owned by the coordinator + teacher concerns routed here.
   Status timelines are stepped from the append-only event lists;
   the resolve handoff writes nothing silently — handover means
   telling the next desk what was already tried.
   PRIVACY: student identity appears only where the coordinator
   is the routed authority (server tiers it; items without
   identity render anonymised on purpose).
   ============================================================ */
import { useMemo, useState } from 'react';
import {
  PageHead, Card, Badge, Button, Empty, ErrorState, SkeletonCard, Timeline, Modal, useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { friendly } from '../../lib/friendlyErrors';
import { getEscalations, type CoordEscalations, type CoordEscalation } from '../../services/coordApi';
import { useCoordAccess, useCoordData, CoordDenied, BackToCommandCenter, CoordBanner } from './shared';

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

const statusTone = (s: string): 'neutral' | 'info' | 'warning' | 'success' | 'danger' =>
  s === 'resolved' ? 'success'
    : s === 'closed' ? 'neutral'
      : s === 'escalated' ? 'danger'
        : s === 'routed' ? 'info'
          : 'warning';

const urgencyTone = (u?: string | null): 'neutral' | 'warning' | 'danger' =>
  u === 'critical' || u === 'high' ? 'danger' : u === 'medium' ? 'warning' : 'neutral';

function slaLeft(e: CoordEscalation): { label: string; tone: 'danger' | 'warning' | 'neutral' } | null {
  if (!e.sla_at) return null;
  const ms = new Date(e.sla_at).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { label: 'SLA passed — prioritise', tone: 'danger' };
  const h = ms / 3600000;
  return h < 24
    ? { label: `${Math.max(1, Math.round(h))}h to SLA`, tone: 'warning' }
    : { label: `${Math.round(h / 24)}d to SLA`, tone: 'neutral' };
}

function EscalationCard({ e, onHandoff }: { e: CoordEscalation; onHandoff: (e: CoordEscalation) => void }) {
  const sla = slaLeft(e);
  const hasIdentity = !!e.student;
  const timeline = (e.timeline ?? []).map(t => ({
    time: fmtWhen(t.at),
    title: t.to,
    body: t.note ?? undefined,
  }));

  return (
    <Card pad>
      <div className="u-col" style={{ gap: 10 }}>
        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge tone="outline">{e.source === 'family_request' ? 'Family request' : 'Teacher concern'}</Badge>
          {e.urgency && <Badge tone={urgencyTone(e.urgency)} dot>{e.urgency} urgency</Badge>}
          <Badge tone={statusTone(e.status)}>{e.status}</Badge>
          {sla && <Badge tone={sla.tone === 'danger' ? 'danger' : sla.tone === 'warning' ? 'warning' : 'neutral'}>{sla.label}</Badge>}
          <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>raised {fmtWhen(e.created_at)}</span>
        </div>

        <div style={{ fontWeight: 620, fontSize: 'var(--text-lg)', lineHeight: 1.35 }}>
          {e.title ?? `${e.category} — ${e.student ?? 'a routed concern'}`}
        </div>

        <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>
          {hasIdentity ? (
            <>Student: <b>{e.student}</b></>
          ) : (
            <>Student identity is withheld — this item is routed to another desk. You see the thread, not the name.</>
          )}
        </div>

        {timeline.length > 0 && (
          <div>
            <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>Status timeline</div>
            <Timeline items={timeline} />
          </div>
        )}

        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" icon={<Icon.ArrowUpRight size={12} />} onClick={() => onHandoff(e)}>
            Resolve with handoff note…
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function EscalationsQueue() {
  const toast = useToast();
  const { allowed } = useCoordAccess();
  const { data, loading, error, retry } = useCoordData<CoordEscalations>(getEscalations);
  const [handoffFor, setHandoffFor] = useState<CoordEscalation | null>(null);
  const [note, setNote] = useState('');

  const list = useMemo(() => data?.escalations ?? [], [data]);

  if (!allowed) return <CoordDenied what="The escalations queue" />;

  return (
    <div>
      <PageHead
        back={{ to: '/coord/home', label: 'Command Center' }}
        title="Escalations"
        sub="Family requests and concerns that land on the coordinator desk — with the full status timeline so the next handover starts from what has already been tried."
        actions={<Button variant="secondary" size="sm" icon={<Icon.Refresh size={13} />} onClick={retry}>Refresh</Button>}
      />

      <CoordBanner
        icon={<Icon.Lock size={14} />}
        strong="Only routed coordinators see this."
        faint="Student identity appears here only where the coordination desk is the routed authority. Items routed to the counsellor or the principal render without the name — the thread stays visible for continuity, the identity stays tiered."
      />

      {loading && <SkeletonCard lines={8} />}
      {!loading && error && <ErrorState title="Could not load escalations" sub={friendly(error)} onRetry={retry} />}

      {!loading && !error && data && (
        list.length === 0 ? (
          <Card pad>
            <Empty
              icon={<Icon.Check size={22} />}
              title="The escalation queue is clear"
              sub="New family requests owned by the coordinator desk and concerns routed to it will appear here with their timelines."
            />
          </Card>
        ) : (
          <div className="grid grid-2">
            {list.map(e => <EscalationCard key={e.id} e={e} onHandoff={setHandoffFor} />)}
          </div>
        )
      )}

      <Modal
        open={!!handoffFor} onClose={() => setHandoffFor(null)}
        title="Resolve with a handoff note"
        sub={handoffFor ? (handoffFor.title ?? `${handoffFor.category} — ${handoffFor.student ?? 'routed concern'}`) : undefined}
      >
        {handoffFor && (
          <>
            <p className="u-small u-muted" style={{ marginTop: 0, lineHeight: 1.65 }}>
              A resolution should hand the next desk something usable: what the concern was, what was tried,
              and what to watch for. The note travels with the record — it is never a silent close.
            </p>
            {handoffFor.timeline.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>Already on the timeline</div>
                <div className="u-col" style={{ gap: 4 }}>
                  {handoffFor.timeline.map((t, i) => (
                    <div key={i} className="u-xs u-faint">· {fmtWhen(t.at)} — {t.to}{t.note ? `: ${t.note}` : ''}</div>
                  ))}
                </div>
              </div>
            )}
            <label className="u-small u-muted" htmlFor="esc-note">Handoff note</label>
            <textarea
              id="esc-note" className="input" rows={4} maxLength={500} style={{ resize: 'vertical', marginTop: 4 }}
              value={note} onChange={ev => setNote(ev.target.value)}
              placeholder="What was tried, what changed, what the next desk should watch for…"
            />
            <div className="u-xs u-faint" style={{ marginTop: 6, lineHeight: 1.55 }}>
              v1 surfaces the full timeline here; resolution itself is recorded at the routing desk
              (family request or concern record). Copy your note and paste it into that resolution —
              nothing is closed silently from this screen.
            </div>
          </>
        )}
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setHandoffFor(null)}>Cancel</Button>
          <Button
            variant="primary" disabled={!note.trim()}
            onClick={async () => {
              try { await navigator.clipboard.writeText(note.trim()); } catch { /* clipboard unavailable — the text stays editable */ }
              toast({
                title: 'Handoff note copied',
                sub: 'Paste it into the routing desk\u2019s resolution record so the handover is written down, not remembered.',
                tone: 'info',
              });
              setHandoffFor(null); setNote('');
            }}
          >
            Copy handoff note
          </Button>
        </div>
      </Modal>
    </div>
  );
}
