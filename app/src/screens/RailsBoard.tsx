/* ============================================================
   RailsBoard — system services status (owner / IT admin).
   Shows which optional rails are actually configured (SMS,
   WhatsApp, Razorpay), which plugins are on, and the health of
   the message queues. Uses the /capabilities decoupling door so
   the school never wonders "is WhatsApp actually sending?"
   ============================================================ */
import { useEffect, useState } from 'react';
import {
  PageHead, Card, Badge, Button, Empty, ErrorState, SkeletonCard, Stat,
} from '../components/ui';
import { friendly } from '../lib/friendlyErrors';
import { pluginLabel } from '../lib/labels';
import { getCapabilities, pluginEnabled, type Capabilities } from '../services/capabilitiesApi';
import { apiGet } from '../services/liveApi';

interface QueueHealth {
  outboxPending?: number;
  commsQueued?: number;
  commsFailed?: number;
}

/* Parse the handful of gauges we surface from the server's Prometheus text
   (/metrics is owner/itadmin only — a 403 here degrades to "unavailable"). */
function parsePromGauges(text: string): QueueHealth {
  const num = (name: string) => {
    const m = new RegExp(`^schoolos_${name} (\\d+)$`, 'm').exec(text);
    return m ? Number(m[1]) : undefined;
  };
  return {
    outboxPending: num('outbox_pending'),
    commsQueued: num('comms_queued'),
    commsFailed: undefined,
  };
}

const RAILS: { key: keyof Capabilities['rails']; name: string; what: string }[] = [
  { key: 'sms', name: 'SMS', what: 'Absence notes, fee receipts, OTPs — text messages to guardians.' },
  { key: 'whatsapp', name: 'WhatsApp', what: 'Approved template messages to guardians.' },
  { key: 'razorpay', name: 'Razorpay fees', what: 'Online fee payment links and automatic payment confirmation notes.' },
  { key: 'files', name: 'Document storage', what: 'Uploads and safe downloads of school documents.' },
];

export default function RailsBoard() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [queue, setQueue] = useState<QueueHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true); setError(null);
    Promise.all([
      getCapabilities(true),
      apiGet<string>('/metrics').then(parsePromGauges).catch(() => ({}) as QueueHealth),
    ])
      .then(([c, q]) => { setCaps(c); setQueue(q); setLoading(false); })
      .catch(e => { setError(friendly(e)); setLoading(false); });
  };
  useEffect(refresh, []);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <PageHead
        title="System services"
        sub="What is connected, what is optional, and what the message queues look like — in plain words"
        actions={<Button variant="ghost" onClick={refresh}>Refresh</Button>}
      />

      {loading && <SkeletonCard />}
      {error && <ErrorState title="Could not load" sub={error?.replace('Error: ', '')} onRetry={refresh} />}

      {!loading && !error && caps && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 'var(--s-4)' }}>
            <Stat
              label="SMS"
              value={caps.rails.sms.configured ? 'Connected' : caps.rails.sms.sandbox ? 'Sandbox' : 'Off'}
              sub={caps.rails.sms.configured ? caps.rails.sms.provider || 'provider set' : caps.rails.sms.sandbox ? 'messages are logged, not sent' : 'no provider'}
            />
            <Stat
              label="WhatsApp"
              value={caps.rails.whatsapp.configured ? 'Connected' : caps.rails.whatsapp.sandbox ? 'Sandbox' : 'Off'}
              sub={caps.rails.whatsapp.configured ? caps.rails.whatsapp.provider || 'provider set' : caps.rails.whatsapp.sandbox ? 'messages are logged, not sent' : 'no provider'}
            />
            <Stat label="Razorpay" value={caps.rails.razorpay.configured ? 'Connected' : 'Off'} sub="fee payments" />
            <Stat label="Documents" value={caps.rails.files.configured ? 'Ready' : 'Off'} sub="storage" />
          </div>

          <Card headAs="h2" head="Connected services" sub="Optional services work only when they are switched on — everything else keeps working without them">
            {RAILS.map(r => {
              const st = caps.rails[r.key];
              const on = 'configured' in st && st.configured;
              /* Three states, not two. "Not set up" and "sandbox" are different facts: the first is
                 nothing configured, the second is everything configured except a real provider — and
                 in the sandbox state the rail accepts messages and delivers none, which is exactly
                 what a school must be told before it promises a guardian an SMS. */
              const sandbox = 'sandbox' in st && st.sandbox && !on;
              return (
                <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                  <div>
                    <strong>{r.name}</strong>{' '}
                    <Badge tone={on ? 'success' : sandbox ? 'warning' : 'neutral'}>{on ? 'Connected' : sandbox ? 'Sandbox — not sending' : 'Not set up'}</Badge>
                    <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>{r.what}</div>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.7, textAlign: 'right' }}>
                    {'provider' in st && st.provider
                      ? `provider: ${st.provider}${sandbox ? ' — writes to the log, sends nothing' : ''}`
                      : on ? 'ready' : 'add keys in add-on settings'}
                  </div>
                </div>
              );
            })}
          </Card>

          <Card headAs="h2" head="School add-ons" sub="An add-on that is switched off simply does not appear for staff — nothing breaks">
            {['library', 'payments.upi', 'payments.razorpay', 'transport.gps', 'ops.visitors', 'admissions.funnel', 'ops.timetable', 'people.admin', 'files.store'].map(id => (
              <div key={id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13 }}>{pluginLabel(id)}</span>
                <Badge tone={pluginEnabled(id) ? 'success' : 'neutral'}>{pluginEnabled(id) ? 'On' : 'Off'}</Badge>
              </div>
            ))}
          </Card>

          <Card headAs="h2" head="Message queues" sub="Queued messages wait here until their service is connected — nothing is lost">
            {queue && (queue.commsQueued !== undefined || queue.outboxPending !== undefined) ? (
              <div className="grid grid-3">
                <Stat label="Messages waiting" value={String(queue.commsQueued ?? 0)} sub="SMS / WhatsApp queue" />
                <Stat label="Events waiting" value={String(queue.outboxPending ?? 0)} sub="internal event queue" />
                <Stat label="Stuck / failed" value={String(queue.commsFailed ?? 0)} sub="need a look" />
              </div>
            ) : (
              <Empty title="Queue counters unavailable" sub="The server did not report queue depths (harmless)." />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
