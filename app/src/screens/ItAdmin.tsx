/* ============================================================
   IT Admin console — live platform health from the protected
   metrics endpoint, integration scope (read-only, "Not
   configured" until an integration-health door exists), and data
   residency. The synthetic session list, the fabricated "platform
   activity log" and the non-functional feature switches were
   removed — see docs/REMOVALS.md. Controls with no server door
   render disabled with honest copy.
   ============================================================ */
import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Button, Card, PageHead, Section, Stat } from '../components/ui';
import { Icon } from '../components/Icon';
import { apiGet } from '../services/liveApi';

interface PlatformMetrics {
  uptimeSeconds?: number;
  requestsTotal?: number;
  errorsTotal?: number;
  poolWaiting?: number;
  schemaMigrations?: number;
}

function parsePromMetrics(text: string): PlatformMetrics {
  const value = (name: string) => {
    const match = new RegExp(`^schoolos_${name}(?:\\{[^}]*\\})?\\s+([-+]?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)$`, 'm').exec(text);
    return match ? Number(match[1]) : undefined;
  };
  return {
    uptimeSeconds: value('uptime_seconds'),
    requestsTotal: value('requests_total'),
    errorsTotal: value('errors_total'),
    poolWaiting: value('pg_pool_waiting'),
    schemaMigrations: value('schema_migrations'),
  };
}

function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `${days}d ${hours}h` : `${hours}h`;
}


/* FE-1 (PERFECT-100 §5.8): a hardcoded `HEALTH` array used to render measured-sounding infrastructure
   telemetry here — "14ms query p95 · Replication lag 0.2s · 3 read replicas", "WhatsApp BSP 99.2% delivery"
   — under a heading that claimed a status worker polled it every 30s. There are no read replicas and no
   status worker. Deleted rather than dressed up; the real sources are documented in the panel below. */

/* FEX-11: these rows used to carry a hardcoded `status` ("connected"/"active"/"degraded") and a
   `lastUse` ("12 min ago") that no door measured — the same fabrication class FE-1 removed from the
   health panel, just moved into the integration cards. The server has no integration-health door, so the
   badge now says exactly that. */
const API_KEYS = [
  { id: 'tally', name: 'Tally gateway', icon: <Icon.Refresh size={15} />, scope: 'Ledger sync · vouchers read/write' },
  { id: 'pay', name: 'Payment gateway', icon: <Icon.CreditCard size={15} />, scope: 'Collect · refunds · UPI mandates' },
  { id: 'sms', name: 'SMS (DLT)', icon: <Icon.Message size={15} />, scope: 'Send only · registered templates' },
  { id: 'wa', name: 'WhatsApp BSP', icon: <Icon.Message size={15} />, scope: 'Session + template messages' },
  { id: 'gps', name: 'GPS provider', icon: <Icon.Bus size={15} />, scope: 'Telemetry · 10s ping · geofence' },
];


/* ---------- screen ---------- */
export default function ItAdmin() {
  const { session, actorName } = useStore();
  const isIt = session.roleId === 'itadmin';
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [metricsUnavailable, setMetricsUnavailable] = useState(false);

  useEffect(() => {
    if (!isIt) return;
    apiGet<string>('/metrics')
      .then(body => { setMetrics(parsePromMetrics(body)); setMetricsUnavailable(false); })
      .catch(() => { setMetrics(null); setMetricsUnavailable(true); });
  }, [isIt]);


  return (
    <>
      <PageHead
        title="IT Admin"
        sub={isIt
          ? 'Platform posture for all three campuses. Security operations (session revoke, key rotation, exports) require server support and are disabled in this build.'
          : `Viewing as ${actorName}. Security operations require server support and are disabled in this build.`}
        actions={<Badge tone={isIt ? 'accent' : 'outline'} dot>{isIt ? 'Full access' : 'Read-only'}</Badge>}
      />

      {/* FE-3: values in this row come from the owner/IT-admin-only Prometheus endpoint.
          Metrics that the server does not export remain explicitly unavailable. */}
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Process uptime" value={formatDuration(metrics?.uptimeSeconds)} sub={metricsUnavailable ? 'Metrics unavailable' : 'Live process metric'} />
        <Stat label="API errors" value={metrics?.errorsTotal == null ? '—' : metrics.errorsTotal.toLocaleString()} sub={metricsUnavailable ? 'Metrics unavailable' : 'Since process start'} />
        <Stat label="API requests" value={metrics?.requestsTotal == null ? '—' : metrics.requestsTotal.toLocaleString()} sub={metricsUnavailable ? 'Metrics unavailable' : 'Since process start'} />
      </div>

      {/* ---------- system health ---------- */}
      <Section title="System health" sub={metricsUnavailable ? 'The metrics endpoint is unavailable for this session.' : 'Live process and database-pool telemetry from the protected metrics endpoint.'} style={{ marginBottom: 4 }}>
        <Card pad>
          {metrics ? <div className="grid grid-3">
            <Stat label="Pool waiters" value={metrics.poolWaiting == null ? '—' : String(metrics.poolWaiting)} sub="Current database waiters" />
            <Stat label="Schema migrations" value={metrics.schemaMigrations == null ? '—' : String(metrics.schemaMigrations)} sub="Applied migration count" />
            <Stat label="Source" value="/metrics" sub="Owner / IT admin only" />
          </div> : <EmptyInline title="Live service telemetry unavailable" sub="The protected /metrics endpoint could not be read for this session." />}
        </Card>
      </Section>

      {/* ---------- access & sessions ---------- */}

      {/* ---------- API keys & integrations ---------- */}
      <Section title="API keys & integrations" sub="Outbound systems on record. Not connected — key rotation requires server support." style={{ marginBottom: 4 }}>
        <div className="grid grid-3">
          {API_KEYS.map(k => (
            <Card key={k.id} pad>
              <div className="u-col" style={{ gap: 8 }}>
                <div className="u-between">
                  <span className="u-flex u-small u-bold" style={{ gap: 8 }}>{k.icon}{k.name}</span>
                  <Badge tone="neutral">Not configured</Badge>
                </div>
                <div className="u-col u-small u-muted" style={{ gap: 3 }}>
                  <span><span className="u-faint">Scope:</span> {k.scope}</span>
                  <span><span className="u-faint">Last use:</span> — (no integration-health door exists)</span>
                  <span className="mono u-xs u-faint">key •••• {k.id.padEnd(4, 'x').slice(0, 4).toUpperCase()}</span>
                </div>
                <div>
                  <Button size="sm" variant="secondary" icon={<Icon.Key size={13} />} disabled title="Not connected — operations require server support">Rotate key</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ---------- control plane registry ---------- */}

      {/* ---------- feature flags ---------- */}

      {/* ---------- residency + backup ---------- */}
      <div className="grid grid-2" style={{ alignItems: 'stretch' }}>
        <Card head="Data residency & compliance" actions={<Badge tone="accent">Compliance pack: India CBSE v2026.1</Badge>}>
          <div className="u-col u-small" style={{ gap: 10 }}>
            <div className="u-flex" style={{ gap: 8 }}>
              <Icon.Shield size={15} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 1 }} />
              <span>
                All student and guardian data is stored in <strong>ap-south-1 (Mumbai)</strong>. No cross-border transfer.
                Processing is purpose-limited under the <strong>DPDP Act 2023</strong> — consent artifacts are kept per guardian,
                and any breach is reported to the Data Protection Board within 72 hours.
              </span>
            </div>
            <div className="u-col" style={{ gap: 5, paddingLeft: 23 }}>
              <span className="u-faint">Retention — attendance <strong className="tnum">5 years</strong> · fees <strong className="tnum">10 years</strong> · chats <strong className="tnum">90 days</strong></span>
              <span className="u-faint">Guardian chat exports exclude other children&apos;s records (Privacy §1.3).</span>
            </div>
          </div>
        </Card>

        <Card head="Backup & export">
          <div className="u-col u-small" style={{ gap: 10 }}>
            <div className="u-flex" style={{ gap: 8 }}>
              <Icon.Download size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>No backups are configured for this school yet.</strong> Snapshot download, exports and
                point-in-time recovery require server support and are disabled in this build.
              </span>
            </div>
            <div className="u-faint" style={{ paddingLeft: 23 }}>
              Until a backup job is connected, treat the data in SchoolOS as the only copy.
            </div>
            <div className="u-flex" style={{ gap: 8, paddingLeft: 23 }}>
              <Button size="sm" variant="secondary" icon={<Icon.Download size={13} />} disabled title="Not connected — operations require server support">
                Download snapshot
              </Button>
              <Button size="sm" variant="ghost" icon={<Icon.File size={13} />} disabled title="Not connected — operations require server support">
                Export data
              </Button>
            </div>
            <div className="u-xs u-faint" style={{ paddingLeft: 23 }}>
              Not connected — snapshot download and data export require server support and are disabled in this build.
            </div>
          </div>
        </Card>
      </div>

    </>
  );
}

/* ---------- small pieces ---------- */
function EmptyInline({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="u-col" style={{ alignItems: 'center', gap: 4, padding: 20, textAlign: 'center' }}>
      <span style={{ fontWeight: 600 }}>{title}</span>
      {sub && <span className="u-small u-faint">{sub}</span>}
    </div>
  );
}
