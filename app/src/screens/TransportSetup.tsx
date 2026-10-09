/* ============================================================
   TransportSetup — routes & stops (H1, SPEC parity with the timetable write doors).

   `app.routes` / `app.route_stops` were seed-only, so a self-signup school had no
   transport. This screen lets the transport authority create and edit routes and
   their stops. Retirement is a status update — nothing is deleted.

   Doors (transport.gps): GET/POST/PATCH /routes, /routes/:id/retire,
   POST/PATCH /stops, /stops/:id/retire.
   ============================================================ */
import { useEffect, useState } from 'react';
import { PageHead, Card, Badge, Button, Empty, ErrorState, SkeletonCard, Modal, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { friendly } from '../lib/friendlyErrors';
import { apiRequest } from '../services/liveApi';
import { useRoleOrGrant } from '../lib/access';

interface Stop { id: string; route_id: string; seq: number; name: string; eta_offset_mins: number }
interface Route { id: string; code: string; name: string; vehicle: string | null; capacity: number; permit_capacity: number | null; riders: number; stops: Stop[] }

const BASE = '/plugins/transport.gps';
const ROUTE_ROLES = ['owner', 'principal', 'transport', 'coordinator'];

export default function TransportSetup() {
  const toast = useToast();
  const canWrite = useRoleOrGrant(ROUTE_ROLES, [`POST ${BASE}/routes`, `POST ${BASE}/stops`]);
  const canRead = useRoleOrGrant([...ROUTE_ROLES, 'facilities', 'itadmin'], [`GET ${BASE}/routes`]);

  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [routeForm, setRouteForm] = useState<null | { id?: string; code: string; name: string; vehicle: string; capacity: string }>(null);
  const [stopForm, setStopForm] = useState<null | { routeId: string; id?: string; name: string; eta: string }>(null);

  /* Compliance core (Action Plan 4.4): fares, attendants (+police verification), inspections,
     daily runs with board/de-board timestamps. Same authority tier as routes. */
  const [fare, setFare] = useState<{ academic_year: string; per_km_cents: number } | null>(null);
  const [fareForm, setFareForm] = useState({ year: '2026-27', rate: '' });
  const [attendants, setAttendants] = useState<{ id: string; name: string; route_id?: string | null; police_verified_on?: string | null; staff_name?: string | null }[]>([]);
  const [attForm, setAttForm] = useState({ name: '', verify: '' });
  const [inspections, setInspections] = useState<{ id: string; title: string; inspected_on: string }[]>([]);
  const [inspForm, setInspForm] = useState({ title: '', date: '' });
  const [runInfo, setRunInfo] = useState<{ run?: { id: string }; boardings?: { student_id: string; name: string; direction: string }[]; completeness?: number | null; riders?: number } | null>(null);
  const [boardForm, setBoardForm] = useState({ studentId: '', direction: 'board' });
  const [pupils, setPupils] = useState<{ id: string; name: string }[]>([]);
  /* Fare quote: distance in, rupees out, at the recorded ₹/km rate. A quote is arithmetic,
     not a promise — the office still confirms any charge. */
  const [quoteKm, setQuoteKm] = useState('');
  const [quote, setQuote] = useState<{ amountCents: number; perKmCents: number; academicYear: string } | null>(null);
  const runQuote = async () => {
    const km = Number(quoteKm);
    if (!Number.isFinite(km) || km < 0 || km > 200) { toast({ title: 'Distance must be 0–200 km', tone: 'info' }); return; }
    setBusy(true);
    try {
      const { faresQuote } = await import('../services/complianceApi');
      setQuote(await faresQuote(km));
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  /* Quarterly compliance pack: runs, boarding marks, attendant verification and inspections,
     straight from the registers — the district-committee quarter in one card. */
  const curQuarter = () => {
    const d = new Date();
    return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  };
  const [quarter, setQuarter] = useState(curQuarter());
  const [pack, setPack] = useState<{ quarter: string; runs: number; boardings: number; attendants: { total: number; verified: number }; inspections: number; note: string } | null>(null);
  const loadPack = async () => {
    if (!/^[0-9]{4}-Q[1-4]$/.test(quarter.trim())) { toast({ title: 'Quarter must look like 2026-Q3', tone: 'info' }); return; }
    setBusy(true);
    try {
      const { complianceReport } = await import('../services/complianceApi');
      setPack(await complianceReport(quarter.trim()));
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const reloadCompliance = () => {
    apiRequest<{ fares: { academic_year: string; per_km_cents: number }[] }>('/transport/fares').then(r => setFare(r.fares[0] ?? null)).catch(() => setFare(null));
    apiRequest<{ attendants: { id: string; name: string; route_id?: string | null; police_verified_on?: string | null; staff_name?: string | null }[] }>('/transport/attendants').then(r => setAttendants(r.attendants ?? [])).catch(() => setAttendants([]));
    apiRequest<{ inspections: { id: string; title: string; inspected_on: string }[] }>('/transport/inspections').then(r => setInspections(r.inspections ?? [])).catch(() => setInspections([]));
    apiRequest<{ students: { id: string; name: string }[] }>('/students?limit=500').then(r => setPupils((r.students ?? []).map(s => ({ id: String(s.id), name: String(s.name) })))).catch(() => {});
  };
  useEffect(() => { if (canRead) reloadCompliance(); }, [canRead]);
  const saveFare = async () => {
    const perKm = Math.round(Number(fareForm.rate) * 100);
    if (!fareForm.year.trim() || !Number.isInteger(perKm) || perKm < 0) { toast({ title: 'Year and paise-per-km are needed', tone: 'info' }); return; }
    setBusy(true);
    try {
      await apiRequest('/transport/fares', { method: 'PUT', body: JSON.stringify({ academicYear: fareForm.year.trim(), perKmCents: perKm }) });
      toast({ title: 'Fare rate on record', sub: 'Quotes now use this rate.', tone: 'success' });
      reloadCompliance();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const addAttendant = async () => {
    const v = attForm.verify.trim();
    if (!attForm.name.trim()) { toast({ title: 'Name the attendant', sub: 'Contract drivers have names, not accounts.', tone: 'info' }); return; }
    setBusy(true);
    try {
      const r = await apiRequest<{ attendant: { id: string } }>('/transport/attendants', { method: 'POST', body: JSON.stringify({ name: attForm.name.trim() }) });
      if (v) await apiRequest(`/transport/attendants/${r.attendant.id}/verify`, { method: 'PUT', body: JSON.stringify({ policeVerifiedOn: v }) });
      toast({ title: 'Attendant rostered', sub: v ? 'Police verification recorded.' : 'Police verification still pending.', tone: 'success' });
      setAttForm({ name: '', verify: '' });
      reloadCompliance();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const addInspection = async () => {
    if (!inspForm.title.trim() || !inspForm.date) { toast({ title: 'Title and date are needed', tone: 'info' }); return; }
    setBusy(true);
    try {
      await apiRequest('/transport/inspections', { method: 'POST', body: JSON.stringify({ title: inspForm.title.trim(), inspectedOn: inspForm.date }) });
      toast({ title: 'Inspection logged', tone: 'success' });
      setInspForm({ title: '', date: '' });
      reloadCompliance();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const startRun = async (routeId: string) => {
    setBusy(true);
    try {
      const r = await apiRequest<{ run: { id: string } }>('/transport/runs', { method: 'POST', body: JSON.stringify({ routeId }) });
      const b = await apiRequest<{ run: unknown; boardings: { student_id: string; name: string; direction: string }[]; riders: number; completeness: number | null }>(`/transport/runs/${r.run.id}/board`);
      setRunInfo({ run: r.run, boardings: b.boardings, completeness: b.completeness, riders: b.riders });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const markBoard = async () => {
    if (!runInfo?.run || !boardForm.studentId) { toast({ title: 'Start a run and pick a pupil', tone: 'info' }); return; }
    setBusy(true);
    try {
      await apiRequest(`/transport/runs/${runInfo.run.id}/board`, { method: 'POST', body: JSON.stringify({ studentId: boardForm.studentId, direction: boardForm.direction }) });
      const b = await apiRequest<{ boardings: { student_id: string; name: string; direction: string }[]; riders: number; completeness: number | null }>(`/transport/runs/${runInfo.run.id}/board`);
      setRunInfo({ run: runInfo.run, boardings: b.boardings, completeness: b.completeness, riders: b.riders });
      setBoardForm(f => ({ ...f, studentId: '' }));
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!canRead) return;
    let dead = false;
    setLoading(true); setError(null);
    apiRequest<{ routes: Route[] }>(`${BASE}/routes`)
      .then((r) => { if (!dead) { setRoutes(r.routes ?? []); setLoading(false); } })
      .catch((e) => { if (!dead) { setError(friendly(e)); setLoading(false); } });
    return () => { dead = true; };
  }, [tick, canRead]);

  const reload = () => setTick((t) => t + 1);

  const saveRoute = async () => {
    if (!routeForm) return;
    if (!routeForm.code.trim() || !routeForm.name.trim()) { toast({ title: 'A route code and name are required', tone: 'info' }); return; }
    setBusy(true);
    const body = { code: routeForm.code.trim(), name: routeForm.name.trim(), vehicle: routeForm.vehicle.trim() || null, capacity: Number(routeForm.capacity) || 40 };
    try {
      if (routeForm.id) await apiRequest(`/plugins/transport.gps/routes/${routeForm.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiRequest('/plugins/transport.gps/routes', { method: 'POST', body: JSON.stringify(body) });
      toast({ title: routeForm.id ? 'Route updated' : 'Route added', tone: 'success' });
      setRouteForm(null); reload();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const retireRoute = async (r: Route) => {
    setBusy(true);
    try {
      await apiRequest(`/plugins/transport.gps/routes/${r.id}/retire`, { method: 'POST', body: '{}' });
      toast({ title: `Retired ${r.code}`, sub: 'Its stops left the board too. Nothing was deleted.', tone: 'success' });
      reload();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const saveStop = async () => {
    if (!stopForm) return;
    if (!stopForm.name.trim()) { toast({ title: 'A stop name is required', tone: 'info' }); return; }
    setBusy(true);
    const body = { routeId: stopForm.routeId, name: stopForm.name.trim(), etaOffsetMins: Number(stopForm.eta) || 0 };
    try {
      if (stopForm.id) await apiRequest(`/plugins/transport.gps/stops/${stopForm.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiRequest('/plugins/transport.gps/stops', { method: 'POST', body: JSON.stringify(body) });
      toast({ title: stopForm.id ? 'Stop updated' : 'Stop added', tone: 'success' });
      setStopForm(null); reload();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const retireStop = async (id: string) => {
    setBusy(true);
    try {
      await apiRequest(`/plugins/transport.gps/stops/${id}/retire`, { method: 'POST', body: '{}' });
      toast({ title: 'Stop retired', tone: 'success' });
      setStopForm(null); reload();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  if (!canRead) {
    return (
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <PageHead title="Routes & stops" sub="Create the school's bus routes and their stops." />
        <Empty icon={<Icon.Lock size={22} />} title="Not available on this account" sub="Transport setup is for the transport desk and the principal's office." />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <PageHead
        title="Routes & stops"
        sub="The school's bus routes and their stops. Retiring keeps the record — nothing is deleted."
        actions={canWrite ? <Button onClick={() => setRouteForm({ code: '', name: '', vehicle: '', capacity: '40' })}>Add route</Button> : undefined}
      />

      {loading ? <SkeletonCard lines={6} /> : error ? (
        <ErrorState title="Could not load routes" sub={error.replace('Error: ', '')} onRetry={reload} />
      ) : !routes?.length ? (
        <Empty icon={<Icon.Bus size={22} />} title="No routes yet" sub="Add the first route; a self-signup school starts empty." />
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {routes.map((r) => (
            <Card key={r.id} pad headAs="h2"
              head={<span>{r.code} · {r.name} <Badge tone="info">{r.riders} rider{r.riders === 1 ? '' : 's'}</Badge></span>}
              sub={`Capacity ${r.capacity}${r.vehicle ? ` · ${r.vehicle}` : ''}`}
              actions={canWrite ? (
                <div className="u-flex" style={{ gap: 8 }}>
                  <Button variant="ghost" size="sm" onClick={() => setRouteForm({ id: r.id, code: r.code, name: r.name, vehicle: r.vehicle ?? '', capacity: String(r.capacity) })} disabled={busy}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => retireRoute(r)} disabled={busy}>Retire</Button>
                  <Button variant="secondary" size="sm" onClick={() => { void startRun(r.id); }} disabled={busy}>Start today’s run</Button>
                  <Button variant="secondary" size="sm" onClick={() => setStopForm({ routeId: r.id, name: '', eta: '0' })} disabled={busy}>Add stop</Button>
                </div>
              ) : undefined}>
              {r.stops.length ? (
                <div className="u-col" style={{ gap: 4 }}>
                  {r.stops.map((s) => (
                    <div key={s.id} className="u-between u-small" style={{ padding: '3px 0' }}>
                      <span>{s.seq}. {s.name} <span className="u-faint u-xs">+{s.eta_offset_mins} min</span></span>
                      {canWrite && <button type="button" className="u-xs u-faint" style={{ border: 0, background: 'transparent', cursor: 'pointer' }}
                        onClick={() => setStopForm({ routeId: r.id, id: s.id, name: s.name, eta: String(s.eta_offset_mins) })}>edit</button>}
                    </div>
                  ))}
                </div>
              ) : <div className="u-small u-faint">No stops yet.</div>}
            </Card>
          ))}
        </div>
      )}

      <div style={{ marginTop: 22, display: 'grid', gap: 14 }}>
        <Card headAs="h2" head="Fare rate" sub="Rupees per kilometre, per academic year. Quotes and fee planning read this rate.">
          <div className="u-small" style={{ marginBottom: 10 }}>
            {fare ? <>Current: <strong>₹{(fare.per_km_cents / 100).toFixed(2)}/km</strong> <span className="u-faint">({fare.academic_year})</span></> : 'No rate on record — quotes refuse until the office sets one.'}
          </div>
          {canWrite && (
            <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
              <label className="u-small">Year
                <input className="input" value={fareForm.year} onChange={e => setFareForm(f => ({ ...f, year: e.target.value }))} style={{ display: 'block', marginTop: 4, maxWidth: 130 }} /></label>
              <label className="u-small">₹ per km
                <input className="input" type="number" min={0} step={0.5} value={fareForm.rate} onChange={e => setFareForm(f => ({ ...f, rate: e.target.value }))} style={{ display: 'block', marginTop: 4, maxWidth: 130 }} /></label>
              <Button variant="secondary" disabled={busy} onClick={saveFare}>{busy ? 'Saving…' : 'Set rate'}</Button>
            </div>
          )}
          <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end', marginTop: 10 }}>
            <label className="u-small">Distance (km)
              <input className="input" type="number" min={0} max={200} step={0.5} value={quoteKm} onChange={e => setQuoteKm(e.target.value)} placeholder="e.g. 12" aria-label="Distance in kilometres" style={{ display: 'block', marginTop: 4, maxWidth: 130 }} /></label>
            <Button variant="ghost" size="sm" disabled={busy} onClick={runQuote}>{busy ? 'Quoting…' : 'Quote a fare'}</Button>
            {quote && <span className="u-small">₹{(quote.amountCents / 100).toFixed(2)} <span className="u-faint">at ₹{(quote.perKmCents / 100).toFixed(2)}/km ({quote.academicYear}) — arithmetic, not a charge.</span></span>}
          </div>
        </Card>

        <Card headAs="h2" head="Attendants" sub="Who rides along — staff or named contractors — and whose police verification is on file.">
          {attendants.length === 0 ? <div className="u-small u-muted">Nobody rostered yet.</div> : (
            <div className="u-col" style={{ gap: 6 }}>
              {attendants.map(a => (
                <div key={a.id} className="u-flex" style={{ gap: 10, alignItems: 'center' }}>
                  <span style={{ fontWeight: 570 }} className="u-small">{a.name}</span>
                  {a.police_verified_on
                    ? <Badge tone="success">verified {new Date(a.police_verified_on).toLocaleDateString()}</Badge>
                    : <Badge tone="warning">verification pending</Badge>}
                </div>
              ))}
            </div>
          )}
          {canWrite && (
            <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end', marginTop: 10 }}>
              <label className="u-small">Name
                <input className="input" value={attForm.name} onChange={e => setAttForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Suresh Mane" style={{ display: 'block', marginTop: 4, minWidth: 200 }} /></label>
              <label className="u-small">Police verified on (optional)
                <input className="input" type="date" value={attForm.verify} onChange={e => setAttForm(f => ({ ...f, verify: e.target.value }))} style={{ display: 'block', marginTop: 4 }} /></label>
              <Button variant="secondary" disabled={busy} onClick={addAttendant}>{busy ? 'Adding…' : 'Roster attendant'}</Button>
            </div>
          )}
        </Card>

        <Card headAs="h2" head="Inspections" sub="Joint RTO–education inspections and internal checks, on record.">
          {inspections.length === 0 ? <div className="u-small u-muted">No inspections logged.</div> : (
            <div className="u-col" style={{ gap: 6 }}>
              {inspections.map(i => (
                <div key={i.id} className="u-small"><strong>{i.title}</strong> <span className="u-faint">· {new Date(i.inspected_on).toLocaleDateString()}</span></div>
              ))}
            </div>
          )}
          {canWrite && (
            <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end', marginTop: 10 }}>
              <label className="u-small">Title
                <input className="input" value={inspForm.title} onChange={e => setInspForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Joint RTO–education inspection" style={{ display: 'block', marginTop: 4, minWidth: 260 }} /></label>
              <label className="u-small">Date
                <input className="input" type="date" value={inspForm.date} onChange={e => setInspForm(f => ({ ...f, date: e.target.value }))} style={{ display: 'block', marginTop: 4 }} /></label>
              <Button variant="secondary" disabled={busy} onClick={addInspection}>{busy ? 'Logging…' : 'Log inspection'}</Button>
            </div>
          )}
        </Card>

        <Card headAs="h2" head="Quarterly compliance pack" sub="Runs, boarding marks, attendant verification and inspections for one quarter — the district-committee pack, from the registers.">
          <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end', marginBottom: 10 }}>
            <label className="u-small">Quarter
              <input className="input" value={quarter} onChange={e => setQuarter(e.target.value)} placeholder="2026-Q3" aria-label="Quarter" style={{ display: 'block', marginTop: 4, maxWidth: 130 }} /></label>
            <Button variant="secondary" size="sm" disabled={busy} onClick={loadPack}>{busy ? 'Reading…' : 'Read the quarter'}</Button>
          </div>
          {!pack ? <div className="u-small u-muted">Pick a quarter to read its registers.</div> : (
            <div className="u-flex u-gap-2 u-wrap">
              <Stat label="Runs" value={pack.runs} sub={pack.quarter} />
              <Stat label="Boardings" value={pack.boardings} sub="Pupil board marks" />
              <Stat label="Attendants verified" value={`${pack.attendants.verified}/${pack.attendants.total}`} sub="Police verification on file" />
              <Stat label="Inspections" value={pack.inspections} sub="Logged in the quarter" />
            </div>
          )}
          {pack && <div className="u-xs u-faint" style={{ marginTop: 8 }}>{pack.note}</div>}
        </Card>

        <Card headAs="h2" head="Today's boarding" sub="Start the run, then mark each pupil boarded and de-boarded with timestamps.">          {!routes?.length ? <div className="u-small u-muted">Add a route above first.</div> : (
            <>
              <div className="u-flex u-gap-2 u-wrap" style={{ marginBottom: 10 }}>
                {routes.map(r => (
                  <Button key={r.id} variant="ghost" size="sm" disabled={busy} onClick={() => { void startRun(r.id); }}>
                    {r.code} run
                  </Button>
                ))}
              </div>
              {runInfo && (
                <div className="u-small" style={{ marginBottom: 10 }}>
                  Boarded <strong>{runInfo.boardings?.filter(b => b.direction === 'board').length ?? 0}</strong>
                  {runInfo.riders != null && <> of {runInfo.riders} riders</>}
                  {runInfo.completeness != null && <> · <strong>{runInfo.completeness}%</strong> complete</>}
                </div>
              )}
              {canWrite && runInfo && (
                <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
                  <label className="u-small">Pupil
                    <select className="input" value={boardForm.studentId} onChange={e => setBoardForm(f => ({ ...f, studentId: e.target.value }))} style={{ display: 'block', marginTop: 4, minWidth: 220 }} aria-label="Pupil">
                      <option value="">Choose…</option>
                      {pupils.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="u-small">Direction
                    <select className="input" value={boardForm.direction} onChange={e => setBoardForm(f => ({ ...f, direction: e.target.value }))} style={{ display: 'block', marginTop: 4 }}>
                      <option value="board">Boarded</option>
                      <option value="deboard">De-boarded</option>
                    </select>
                  </label>
                  <Button variant="secondary" disabled={busy} onClick={markBoard}>{busy ? 'Marking…' : 'Mark'}</Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Modal open={routeForm != null} onClose={() => setRouteForm(null)} title={routeForm?.id ? 'Edit route' : 'Add a route'}        footer={<div className="u-flex" style={{ gap: 8 }}><Button variant="ghost" onClick={() => setRouteForm(null)}>Cancel</Button><Button onClick={saveRoute} disabled={busy}>{busy ? 'Saving…' : 'Save route'}</Button></div>}>
        {routeForm && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 2fr' }}>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Code</span>
              <input value={routeForm.code} maxLength={20} placeholder="R2" onChange={e => setRouteForm({ ...routeForm, code: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Name</span>
              <input value={routeForm.name} maxLength={120} placeholder="Whitefield loop" onChange={e => setRouteForm({ ...routeForm, name: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Vehicle (optional)</span>
              <input value={routeForm.vehicle} maxLength={40} onChange={e => setRouteForm({ ...routeForm, vehicle: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Capacity</span>
              <input value={routeForm.capacity} inputMode="numeric" onChange={e => setRouteForm({ ...routeForm, capacity: e.target.value })} /></label>
          </div>
        )}
      </Modal>

      <Modal open={stopForm != null} onClose={() => setStopForm(null)} title={stopForm?.id ? 'Edit stop' : 'Add a stop'}
        footer={<div className="u-flex" style={{ gap: 8, justifyContent: 'space-between', width: '100%' }}>
          <div>{stopForm?.id && canWrite && <Button variant="danger" onClick={() => stopForm && retireStop(stopForm.id!)} disabled={busy}>Retire stop</Button>}</div>
          <div className="u-flex" style={{ gap: 8 }}><Button variant="ghost" onClick={() => setStopForm(null)}>Cancel</Button><Button onClick={saveStop} disabled={busy}>{busy ? 'Saving…' : 'Save stop'}</Button></div>
        </div>}>
        {stopForm && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '2fr 1fr' }}>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Stop name</span>
              <input value={stopForm.name} maxLength={120} onChange={e => setStopForm({ ...stopForm, name: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">ETA offset (min)</span>
              <input value={stopForm.eta} inputMode="numeric" onChange={e => setStopForm({ ...stopForm, eta: e.target.value })} /></label>
          </div>
        )}
      </Modal>
    </div>
  );
}
