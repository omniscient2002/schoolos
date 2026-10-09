/* ============================================================
   Operations — the operations hub. One card per domain, every
   figure recomputed from the school's OWN records, and a summary
   built from the same reads it names.

   P2-9, second half. The board and the case queue were made live in the
   first pass; this pass removes the rest of the sample world from this
   screen:

     · the asset register was a synthetic fleet (ten invented buses, two
       invented lab assets, invented service dates) while `GET /assets`
       sat unread — the register now renders the school's own assets;
     · the vendor register was five invented contracts plus a renewal
       workflow (`wf_5`) that exists in no table. There is no vendor
       model on the server, so the section says so and points at the
       vendor directory, which says the same thing;
     · the "Operations briefing" was a paragraph about Bus 14 running
       13 minutes late with a real-looking 82.3% collection figure — a
       fabricated number wearing the school's records. It is now
       arithmetic over the reads below it, and it is not dressed as AI:
       the sparkle implied a model that never ran.

   The one domain with no server model left is Incidents: there is no
   `app.incidents` table and no door, so its card states that instead of
   counting sample rows. Empty-world law: a card with nothing behind it
   says nothing.
   ============================================================ */
import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHead, Section, Card, Stat, Badge, DataTable, Button, useToast, Empty, ErrorState, SkeletonCard, KeyValue } from '../components/ui';
import { EvidenceChain } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtMoneyShort, fmtPct, fmtRelative } from '../lib/format';
import {
  apiAssets, apiCases, apiEvents, apiFeeObligations, apiFunnelSummary, apiSchoolStaff, apiTransportRoutes, apiWorkOrders,
} from '../services/liveApi';
import { humanize } from '../lib/labels';
import { filesList } from '../services/adminApi';

/* ============================================================
   The hub's one read. Each door settles on its own: a desk this role
   cannot reach must not blank the hub, so a failed read reports `null`
   and its card says the read is unavailable — never a zero, which would
   read as "nothing is wrong".
   ============================================================ */
interface OpsRead {
  workOrders: { open: number; total: number; overdue: number } | null;
  assets: Record<string, unknown>[] | null;
  cases: { open: number; inProgress: number; total: number } | null;
  routes: number | null;
  fees: { billed: number; collected: number; pct: number; failed: number; open: number } | null;
  admissions: { open: number; total: number } | null;
  staff: number | null;
  files: number | null;
  nextEvent: { title: string; at: string } | null;
}

const CLOSED = ['resolved', 'closed', 'cancelled'];

/** One settled read → its array, or nothing. Typed at the boundary because the nine doors answer
 *  nine different envelopes and a rejected read must not become an empty list that reads as "0". */
const list = <T,>(r: PromiseSettledResult<unknown>, key: string): T[] => {
  if (r.status !== 'fulfilled') return [];
  const arr = (r.value as Record<string, unknown> | null)?.[key];
  return Array.isArray(arr) ? (arr as T[]) : [];
};

function useOpsRead(): { data: OpsRead | null; loading: boolean; error: string | null; retry: () => void } {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ data: OpsRead | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    (async () => {
      const [wo, assets, cases, routes, obligations, funnel, staff, files, events] = await Promise.allSettled([
        apiWorkOrders(), apiAssets(), apiCases(), apiTransportRoutes(), apiFeeObligations(),
        apiFunnelSummary(), apiSchoolStaff(), filesList(), apiEvents(),
      ]);
      const woRows = list<Record<string, unknown>>(wo, 'workOrders');
      const openWo = woRows.filter(w => !CLOSED.includes(String(w.status ?? '')));
      const caseRows = list<Record<string, unknown>>(cases, 'cases');
      const openCases = caseRows.filter(c => !CLOSED.includes(String(c.status ?? '')));
      const obs = list<Record<string, unknown>>(obligations, 'obligations');
      const billed = obs.reduce((a, o) => a + Number(o.amount_cents ?? 0), 0);
      const collected = obs.reduce((a, o) => a + Number(o.paid_cents ?? 0), 0);
      const byStage = funnel.status === 'fulfilled' ? funnel.value.byStage : null;
      const funnelTotal = funnel.status === 'fulfilled' ? funnel.value.total : 0;
      const closedStages = ['enrolled', 'rejected', 'withdrawn'];
      const evs = list<Record<string, unknown>>(events, 'events');
      const upcoming = evs
        .map(e => ({ title: String((e.payload as Record<string, unknown> | undefined)?.label ?? e.label ?? e.type ?? 'Event'), at: String(e.created_at ?? '') }))
        .filter(e => e.at && new Date(e.at).getTime() >= Date.now())
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      const out: OpsRead = {
        workOrders: wo.status === 'fulfilled' ? { open: openWo.length, total: woRows.length, overdue: openWo.filter(w => w.sla_breached).length } : null,
        assets: assets.status === 'fulfilled' ? list<Record<string, unknown>>(assets, 'assets') : null,
        cases: cases.status === 'fulfilled' ? { open: openCases.length, inProgress: caseRows.filter(c => String(c.status) === 'in-progress').length, total: caseRows.length } : null,
        routes: routes.status === 'fulfilled' ? list(routes, 'routes').length : null,
        fees: obligations.status === 'fulfilled'
          ? {
            billed, collected,
            pct: billed ? Math.round((collected / billed) * 1000) / 10 : 0,
            failed: obs.filter(o => String(o.status) === 'failed').length,
            open: obs.filter(o => !['paid', 'void'].includes(String(o.status))).length,
          }
          : null,
        admissions: byStage ? { open: Object.entries(byStage).filter(([s]) => !closedStages.includes(s)).reduce((a, [, n]) => a + n, 0), total: funnelTotal } : null,
        staff: staff.status === 'fulfilled' ? list(staff, 'staff').length : null,
        files: files.status === 'fulfilled' ? list(files, 'files').length : null,
        nextEvent: upcoming[0] ?? null,
      };
      if (live) setState({ data: out, loading: false, error: null });
    })();
    return () => { live = false; };
  }, [tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

/* ---------- the asset register's own vocabulary ---------- */
const ASSET_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  operational: { label: 'Operational', tone: 'success' },
  watch: { label: 'On watch', tone: 'warning' },
  degraded: { label: 'Degraded', tone: 'warning' },
  down: { label: 'Down', tone: 'danger' },
  maintenance: { label: 'In maintenance', tone: 'warning' },
  retired: { label: 'Retired', tone: 'neutral' },
};
const needsService = (a: Record<string, unknown>) => !['operational', 'retired'].includes(String(a.status ?? ''));

/* ============================================================ */

type DomainKey = 'fees' | 'admissions' | 'transport' | 'documents' | 'facilities' | 'hr' | 'calendar' | 'cases' | 'incidents' | 'assets';

interface DomainCardDef {
  key: DomainKey;
  title: string;
  icon: (p: { size?: number }) => React.ReactElement;
  to?: string;
  summary: string;
  count: number | null;
  countLabel: string;
  tone?: 'warning' | 'danger' | 'success' | 'accent';
}

export default function Operations() {
  const navigate = useNavigate();
  const toast = useToast();
  const assetsRef = useRef<HTMLDivElement>(null);
  const ops = useOpsRead();
  const d = ops.data;

  const assets = d?.assets ?? [];
  const dueForService = assets.filter(needsService).length;

  const cards: DomainCardDef[] = useMemo(() => [
    {
      key: 'fees', title: 'Fees', icon: Icon.Money, to: '/fees',
      summary: d?.fees
        ? `${fmtPct(d.fees.pct, 1)} of ${fmtMoneyShort(d.fees.billed)} billed is recorded as collected`
        : 'The fee ledger is not readable for this desk',
      count: d?.fees ? d.fees.failed : null, countLabel: 'failed payments', tone: (d?.fees?.failed ?? 0) > 0 ? 'warning' : 'success',
    },
    {
      key: 'admissions', title: 'Admissions', icon: Icon.Graduation, to: '/admissions',
      summary: d?.admissions ? `${d.admissions.open} lead${d.admissions.open === 1 ? '' : 's'} still in the funnel` : 'The funnel is not readable for this desk',
      count: d?.admissions?.open ?? null, countLabel: 'open leads', tone: 'accent',
    },
    {
      key: 'transport', title: 'Transport', icon: Icon.Bus, to: '/transport',
      summary: d?.routes != null ? `${d.routes} route${d.routes === 1 ? '' : 's'} on the school register` : 'The route register is not readable for this desk',
      count: d?.routes ?? null, countLabel: 'routes', tone: 'success',
    },
    {
      key: 'documents', title: 'Documents', icon: Icon.Document, to: '/documents',
      summary: d?.files != null ? `${d.files} file${d.files === 1 ? '' : 's'} in the document store` : 'The document store is not readable for this desk',
      count: d?.files ?? null, countLabel: 'on file', tone: 'accent',
    },
    {
      key: 'facilities', title: 'Maintenance & Facilities', icon: Icon.Building, to: '/maintenance',
      summary: d?.workOrders
        ? `${d.workOrders.open} open work order${d.workOrders.open === 1 ? '' : 's'}${d.workOrders.overdue ? ` · ${d.workOrders.overdue} past the SLA` : ''}`
        : 'The work-order board is not readable for this desk',
      count: d?.workOrders?.open ?? null, countLabel: 'open jobs', tone: (d?.workOrders?.overdue ?? 0) > 0 ? 'warning' : 'accent',
    },
    {
      key: 'hr', title: 'People', icon: Icon.People, to: '/operations/hr',
      summary: d?.staff != null ? `${d.staff} staff account${d.staff === 1 ? '' : 's'} active` : 'The staff roster is not readable for this desk',
      count: d?.staff ?? null, countLabel: 'on the roster', tone: 'accent',
    },
    {
      key: 'calendar', title: 'Events', icon: Icon.Calendar, to: '/calendar',
      summary: d?.nextEvent ? `Next: ${d.nextEvent.title} · ${fmtRelative(new Date(d.nextEvent.at))}` : 'No dated events on the feed',
      count: null, countLabel: '', tone: 'accent',
    },
    {
      key: 'cases', title: 'Cases', icon: Icon.Clipboard, to: '/cases',
      summary: d?.cases ? `${d.cases.inProgress} in progress · ${d.cases.open} open of ${d.cases.total} on the log` : 'The case log is not readable for this desk',
      count: d?.cases?.open ?? null, countLabel: 'open', tone: (d?.cases?.open ?? 0) > 3 ? 'warning' : undefined,
    },
    {
      key: 'incidents', title: 'Incidents', icon: Icon.Alert, to: '/incidents',
      // no app.incidents table and no door: the count would be the demo world's, not the school's
      summary: 'Not connected yet — there is no incident register on the server, so this screen counts nothing',
      count: null, countLabel: '', tone: undefined,
    },
    {
      key: 'assets', title: 'Assets', icon: Icon.Grid, to: '/maintenance/assets',
      summary: d?.assets
        ? `${d.assets.length} asset${d.assets.length === 1 ? '' : 's'} on the register${dueForService ? ` · ${dueForService} need attention` : ''}`
        : 'The asset register is not readable for this desk',
      count: d?.assets ? dueForService : null, countLabel: 'need attention', tone: dueForService > 0 ? 'warning' : 'success',
    },
  ], [d, dueForService]);

  const openCard = (c: DomainCardDef) => {
    if (c.key === 'assets' && c.to) { navigate(c.to); return; }
    if (c.to) navigate(c.to);
    else if (c.key === 'assets') assetsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* The summary is arithmetic over the reads above — no model ran, so it is not dressed as one. */
  const summarySentence = useMemo(() => {
    if (!d) return null;
    const parts: string[] = [];
    if (d.cases && d.cases.open) parts.push(`${d.cases.open} case${d.cases.open === 1 ? '' : 's'} open (${d.cases.inProgress} being worked)`);
    if (d.workOrders && d.workOrders.open) parts.push(`${d.workOrders.open} work order${d.workOrders.open === 1 ? '' : 's'} open${d.workOrders.overdue ? `, ${d.workOrders.overdue} past the SLA` : ''}`);
    if (d.fees && d.fees.billed) parts.push(`${fmtPct(d.fees.pct, 1)} of billed fees recorded as collected, ${d.fees.failed} failed payment${d.fees.failed === 1 ? '' : 's'}`);
    if (d.assets && dueForService) parts.push(`${dueForService} asset${dueForService === 1 ? '' : 's'} not operational`);
    if (d.admissions && d.admissions.open) parts.push(`${d.admissions.open} admission lead${d.admissions.open === 1 ? '' : 's'} in the funnel`);
    if (d.routes) parts.push(`${d.routes} transport route${d.routes === 1 ? '' : 's'} on the register`);
    if (!parts.length) return 'Nothing needs attention in the records this desk can read. Add a work order, a case or a fee plan and it will show up here.';
    return `${parts.join('; ')}.`;
  }, [d, dueForService]);

  const evidence = useMemo(() => {
    if (!d) return [];
    const steps: { label: string; detail: string; source: string; refType: string }[] = [];
    if (d.workOrders) steps.push({ label: 'Work orders', detail: `${d.workOrders.open} open of ${d.workOrders.total} · ${d.workOrders.overdue} past the SLA`, source: 'GET /work-orders', refType: 'maintenance' });
    if (d.cases) steps.push({ label: 'Case log', detail: `${d.cases.open} open · ${d.cases.inProgress} in progress`, source: 'GET /cases', refType: 'case' });
    if (d.fees && d.fees.billed) steps.push({ label: 'Fee ledger', detail: `${fmtPct(d.fees.pct, 1)} collected · ${d.fees.open} obligations still open`, source: 'GET /fees/obligations', refType: 'fees' });
    if (d.assets) steps.push({ label: 'Asset register', detail: `${d.assets.length} assets · ${dueForService} not operational`, source: 'GET /assets', refType: 'maintenance' });
    if (d.admissions) steps.push({ label: 'Admissions funnel', detail: `${d.admissions.open} open of ${d.admissions.total} leads`, source: 'GET /plugins/admissions.funnel/summary', refType: 'admissions' });
    if (d.staff != null) steps.push({ label: 'Staff roster', detail: `${d.staff} active staff accounts`, source: 'GET /school/staff', refType: 'hr' });
    return steps;
  }, [d, dueForService]);

  return (
    <div>
      <PageHead
        title="Operations"
        sub="Every figure below is read from this school's own records. A door this desk cannot reach says so rather than showing a zero."
        actions={<Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={() => { ops.retry(); toast({ title: 'Operations summary refreshed', sub: 'Re-read from the live registers.', tone: 'info' }); }}>Refresh</Button>}
      />

      {/* ---- Stats row ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Open cases" value={d?.cases?.open ?? '—'} sub={d?.cases ? `${d.cases.inProgress} in progress now` : 'case log not readable'} onClick={() => navigate('/cases')} />
        <Stat label="Open work orders" value={d?.workOrders?.open ?? '—'} sub={d?.workOrders ? `${d.workOrders.overdue} past the SLA` : 'work orders not readable'} onClick={() => navigate('/maintenance')} />
        <Stat label="Fees collected" value={d?.fees ? fmtPct(d.fees.pct, 1) : '—'} sub={d?.fees ? `${fmtMoneyShort(d.fees.collected)} of ${fmtMoneyShort(d.fees.billed)}` : 'ledger not readable'} onClick={() => navigate('/fees')} />
        <Stat label="Assets needing attention" value={d?.assets ? dueForService : '—'} sub={d?.assets ? `${d.assets.length} on the register` : 'register not readable'} onClick={() => navigate('/maintenance/assets')} />
      </div>

      {/* ---- Operations summary ---- */}
      {ops.loading ? (
        <div className="grid grid-3" style={{ marginBottom: 28 }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : ops.error ? (
        <Card pad style={{ marginBottom: 28 }}><ErrorState title="Could not read the operations registers" sub={ops.error} onRetry={ops.retry} /></Card>
      ) : summarySentence ? (
        <Card pad style={{ marginBottom: 28 }}>
          <div className="u-col" style={{ gap: 12 }}>
            <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="u-upper">Operations summary</span>
              <Badge tone="info" dot>computed from records · {fmtRelative(new Date())}</Badge>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--text-md)', lineHeight: 1.65, maxWidth: 880 }}>{summarySentence}</p>
            {evidence.length > 0 && <EvidenceChain title="Where this came from" steps={evidence} />}
            <span className="u-xs u-faint">
              Arithmetic over the reads named above, at the moment you opened this page. No model generated it and no
              figure here is estimated — a register this desk cannot read is left out rather than filled in.
            </span>
          </div>
        </Card>
      ) : null}

      {/* ---- Domain cards ---- */}
      <Section
        title="Domains"
        sub="One card per operations domain. Each summary is the record behind that screen, not a demo figure."
      >
        <div className="grid grid-3">
          {cards.map(c => {
            const Ic = c.icon;
            return (
              <Card key={c.key} onClick={() => openCard(c)} className="card-click">
                <div className="u-flex" style={{ gap: 12, alignItems: 'flex-start', padding: 'var(--s-5)' }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-3)', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'var(--accent-text)' }}>
                    <Ic size={16} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 620, fontSize: 'var(--text-lg)' }}>{c.title}</span>
                      {c.tone && c.count != null && (
                        <Badge tone={c.tone === 'accent' ? 'accent' : c.tone === 'warning' ? 'warning' : c.tone === 'danger' ? 'danger' : 'success'} dot>{c.count} {c.countLabel}</Badge>
                      )}
                    </div>
                    <div className="u-small u-muted" style={{ marginTop: 4 }}>{c.summary}</div>
                  </div>
                  <Icon.ChevronRight size={15} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
                </div>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* ---- Asset register — the school's own assets ---- */}
      <div ref={assetsRef}>
        <Section
          title="Asset register"
          sub={assets.length ? 'Every asset registered in this school, with its own service state.' : 'Assets you register — nothing here yet.'}
          actions={assets.length ? <Badge tone={dueForService ? 'warning' : 'success'} dot>{dueForService} need attention</Badge> : undefined}
          style={{ marginTop: 8 }}
        >
          <Card>
            <DataTable
              rows={assets}
              rowKey={a => String(a.id)}
              columns={[
                { key: 'code', label: 'Code', render: a => <span className="mono u-small">{String(a.code ?? '—')}</span> },
                { key: 'name', label: 'Asset', render: a => <span style={{ fontWeight: 580 }}>{String(a.name ?? '—')}</span> },
                { key: 'category', label: 'Category', render: a => <Badge tone="outline">{humanize(String(a.category ?? ''))}</Badge> },
                {
                  key: 'where', label: 'Where',
                  sortValue: a => `${a.building ?? ''} ${a.room ?? ''}`,
                  render: a => [a.building, a.room].filter(Boolean).join(' · ') || '—',
                },
                {
                  key: 'health_score', label: 'Health', align: 'right',
                  render: a => <span className="mono">{a.health_score != null ? `${a.health_score}%` : '—'}</span>,
                },
                {
                  key: 'status', label: 'Status', align: 'right',
                  render: a => {
                    const s = ASSET_STATUS[String(a.status ?? '')] ?? { label: humanize(String(a.status ?? '')), tone: 'neutral' as const };
                    return <Badge tone={s.tone} dot>{s.label}</Badge>;
                  },
                },
              ]}
              empty={<Empty icon={<Icon.Grid size={22} />} title="No assets on register" sub="Register a bus, a projector or a water cooler and it appears here with its own service state." />}
            />
            {assets.length > 0 && (
              <div style={{ padding: 'var(--s-4) var(--s-5)' }}>
                <KeyValue
                  cols={3}
                  items={[
                    { k: 'On the register', v: String(assets.length) },
                    { k: 'Operational', v: String(assets.filter(a => String(a.status) === 'operational').length) },
                    { k: 'Need attention', v: <b style={{ color: dueForService ? 'var(--warning-text, var(--text-1))' : 'var(--success-text, var(--accent-text))' }}>{dueForService}</b> },
                  ]}
                />
              </div>
            )}
          </Card>
        </Section>
      </div>

      {/* ---- Vendor contracts — no model, so no fiction ---- */}
      <Section
        title="Vendor contracts"
        sub="Service contracts need a vendor register, which the server does not have yet."
        style={{ marginTop: 8 }}
      >
        <Card pad>
          <Empty
            icon={<Icon.Offline size={22} />}
            title="Not connected yet"
            sub="There is no vendor register on the server, so no contract is shown here — an invented one would be worse than an empty list. The vendor directory says the same thing."
            action={<Button size="sm" variant="secondary" onClick={() => navigate('/maintenance/vendors')}>Open the vendor directory</Button>}
          />
        </Card>
      </Section>

      <div style={{ height: 24 }} />
      <div className="u-xs u-faint" style={{ textAlign: 'center' }}>
        {ops.loading ? 'Reading the registers…' : d?.fees ? `${fmtMoneyShort(d.fees.collected)} recorded as collected against ${fmtMoneyShort(d.fees.billed)} billed` : 'Fee ledger not readable for this desk'}
      </div>
    </div>
  );
}