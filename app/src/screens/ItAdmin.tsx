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
import { Badge, Button, Card, DataTable, PageHead, Section, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { apiDelete, apiGet, apiPost } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';

/* G-7 · API keys. `POST /api-keys`, `GET /api-keys` and `DELETE /api-keys/:id` have existed on the
   server for the whole life of this console, and `grep -rn "api-keys" app/src` returned NOTHING — so a
   key minted for an integration could not be reviewed, rotated or revoked by a human in the product,
   only by opening a console and writing a request. That is a security gap wearing a feature's
   clothes, and it is why "a door with no caller" deserves the build-time audit in
   `server/tests/api-key-surface.test.js`. */
const API_KEY_SCOPES = [
  { value: 'core.read', label: 'Core read' },
  { value: 'students.read', label: 'Students' },
  { value: 'fees.read', label: 'Fees' },
  { value: 'attendance.read', label: 'Attendance' },
  { value: 'events.read', label: 'Events' },
  { value: 'metrics.read', label: 'Metrics' },
  { value: 'audit.verify', label: 'Audit verification' },
];

interface ApiKeyRow { id: string; name: string; scopes: string[] | null; revoked_at?: string | null; last_used_at?: string | null; created_at?: string }

function ApiKeysCard() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['core.read']);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    apiGet<{ keys: ApiKeyRow[] }>('/api-keys')
      .then(r => { if (!dead) { setKeys(r.keys ?? []); setError(null); } })
      .catch(e => { if (!dead) { setError(friendly(e)); setKeys([]); } });
    return () => { dead = true; };
  }, [tick]);

  const create = async () => {
    if (!name.trim()) { toast({ title: 'Give the key a name', sub: 'So you know which integration it belongs to.', tone: 'info' }); return; }
    setBusy(true);
    try {
      const r = await apiPost<{ id: string; key: string }>('/api-keys', { name: name.trim(), scopes });
      setFresh(r.key);
      setName('');
      setTick(t => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const revoke = async (k: ApiKeyRow) => {
    if (!window.confirm(`Revoke “${k.name}”? Any integration using it starts failing at its next request. This cannot be undone.`)) return;
    try {
      await apiDelete(`/api-keys/${encodeURIComponent(k.id)}`);
      toast({ title: `“${k.name}” revoked`, sub: 'Requests with it now fail at the API.', tone: 'success' });
      setTick(t => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  const live = (keys ?? []).filter(k => !k.revoked_at);
  return (
    <Card head="API keys"
      sub="Keys for integrations that read your school's data. Each key is stored as a hash — the key itself is shown once, at creation.">
      <div className="u-col" style={{ gap: 12 }}>
        {fresh && (
          <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--warning)', background: 'var(--warning-weak)' }}>
            <strong>This key is shown once.</strong> Copy it into your integration now — only its hash is stored.
            <div className="u-flex u-gap-2" style={{ marginTop: 6 }}>
              <code style={{ fontSize: 13, wordBreak: 'break-all' }}>{fresh}</code>
              <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(fresh); toast({ title: 'Copied', tone: 'info' }); }}>Copy</Button>
              <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Dismiss</Button>
            </div>
          </div>
        )}
        <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
          <label className="u-small">Key name
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Attendance tablet" style={{ minWidth: 200 }} />
          </label>
          <div className="u-small">
            <div>Scopes</div>
            <div className="u-flex u-gap-2 u-wrap" style={{ marginTop: 4 }}>
              {API_KEY_SCOPES.map(s => (
                <label key={s.value} className="u-small u-inline" style={{ gap: 4 }}>
                  <input type="checkbox" checked={scopes.includes(s.value)}
                    onChange={e => setScopes(prev => (e.target.checked ? [...prev, s.value] : prev.filter(x => x !== s.value)))} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <Button variant="primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create key'}</Button>
        </div>
        {error ? <div className="u-small" style={{ color: 'var(--danger-text)' }}>{error}</div>
          : live.length === 0 ? <EmptyInline title="No active API keys" sub="Nothing outside the app is reading your school's data." />
            : (
              <DataTable
                columns={[
                  { key: 'name', label: 'Key' },
                  { key: 'scopes', label: 'Scopes', render: (k: ApiKeyRow) => <span className="u-xs u-muted">{(k.scopes ?? []).join(', ') || 'none'}</span> },
                  { key: 'used', label: 'Last used', render: (k: ApiKeyRow) => <span className="u-xs u-faint">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</span> },
                  { key: 'act', label: '', render: (k: ApiKeyRow) => <Button size="sm" variant="ghost" onClick={() => revoke(k)}>Revoke</Button> },
                ]}
                rows={live}
                rowKey={(k: ApiKeyRow) => k.id}
              />
            )}
        {(keys?.length ?? 0) > live.length && (
          <div className="u-xs u-faint">{keys!.length - live.length} revoked key/keys kept on the record (a revoked key is dead, not deleted).</div>
        )}
      </div>
    </Card>
  );
}

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
  { id: 'tally', name: 'Tally gateway', icon: <Icon.Refresh size={15} />, scope: 'School records sync · vouchers read/write' },
  { id: 'pay', name: 'Payment gateway', icon: <Icon.CreditCard size={15} />, scope: 'Collect · refunds · UPI mandates' },
  { id: 'sms', name: 'SMS (DLT)', icon: <Icon.Message size={15} />, scope: 'Send only · registered templates' },
  { id: 'wa', name: 'WhatsApp BSP', icon: <Icon.Message size={15} />, scope: 'Session + template messages' },
  { id: 'gps', name: 'GPS provider', icon: <Icon.Bus size={15} />, scope: 'Telemetry · 10s ping · geofence' },
];


/* ---------- screen ---------- */
export default function ItAdmin() {
  const { session, actorName } = useStore();
  /* FE-11: the owner reaches `/it` through the same owner/itadmin `GET /metrics` door, but the screen
     only fetched when `roleId === 'itadmin'`, so an owner saw "Metrics unavailable" on a door that would
     have answered. Fetch for any role the door admits. */
  const canViewMetrics = session.roleId === 'itadmin' || session.roleId === 'owner';
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [metricsUnavailable, setMetricsUnavailable] = useState(false);

  useEffect(() => {
    if (!canViewMetrics) return;
    apiGet<string>('/metrics')
      .then(body => { setMetrics(parsePromMetrics(body)); setMetricsUnavailable(false); })
      .catch(() => { setMetrics(null); setMetricsUnavailable(true); });
  }, [canViewMetrics]);


  return (
    <>
      <PageHead
        title="IT Admin"
        sub={canViewMetrics
          ? `Platform posture for this school. Security operations (session revoke, key rotation, exports) require server support and are disabled in this build.`
          : `Viewing as ${actorName}. Security operations require server support and are disabled in this build.`}
        actions={<Badge tone={canViewMetrics ? 'accent' : 'outline'} dot>{canViewMetrics ? 'Full access' : 'Read-only'}</Badge>}
      />

      {/* FE-3: values in this row come from the owner/IT-admin-only Prometheus endpoint.
          Metrics that the server does not export remain explicitly unavailable. */}
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Process uptime" value={formatDuration(metrics?.uptimeSeconds)} sub={metricsUnavailable ? 'Metrics unavailable' : 'Live process metric'} />
        <Stat label="Request errors" value={metrics?.errorsTotal == null ? '—' : metrics.errorsTotal.toLocaleString()} sub={metricsUnavailable ? 'Metrics unavailable' : 'Since process start'} />
        <Stat label="Requests" value={metrics?.requestsTotal == null ? '—' : metrics.requestsTotal.toLocaleString()} sub={metricsUnavailable ? 'Metrics unavailable' : 'Since process start'} />
      </div>

      {/* ---------- system health ---------- */}
      <Section title="System health" sub={metricsUnavailable ? 'Live service metrics are unavailable for this session.' : 'Live process and database-pool telemetry from this school’s private metrics.'} style={{ marginBottom: 4 }}>
        <Card pad>
          {metrics ? <div className="grid grid-3">
            <Stat label="Pool waiters" value={metrics.poolWaiting == null ? '—' : String(metrics.poolWaiting)} sub="Current database waiters" />
            <Stat label="Schema migrations" value={metrics.schemaMigrations == null ? '—' : String(metrics.schemaMigrations)} sub="Applied migration count" />
            <Stat label="Metrics" value="Private" sub="Owner / IT admin only" />
          </div> : <EmptyInline title="Live service telemetry unavailable" sub="Live service metrics could not be read for this session." />}
        </Card>
      </Section>

      {/* ---------- access & sessions ---------- */}

      {/* ---------- API keys & integrations ---------- */}
      <Section title="Access keys & integrations" sub="Outbound systems on record. Not connected — key rotation requires server support." style={{ marginBottom: 4 }}>
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
                  <span><span className="u-faint">Last use:</span> — (no health check available yet)</span>
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

        {canViewMetrics && <ApiKeysCard />}
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
