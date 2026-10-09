/* ============================================================
   Statutory returns & accounting exports.

   Three add-ons whose product IS a file a school has to file or hand to an
   accountant — and none of them had a screen, so switching one on produced a
   card in the Add-ons board and nothing else:

     · ops.udise        — the UDISE+-style statistical return (aggregates only)
     · pack.cbse        — the CBSE OASIS result upload, and the rules that gate it
     · accounting.tally — the Tally voucher XML, and the day-book it is built from

   They live together because a school's office person thinks of them as one job
   ("the returns we have to file"), and because each has the same shape: read the
   contract, check what the records say, produce the file.

   Two rules this screen follows, both learned from doors that refuse honestly:
     · A file door is FETCHED, not linked. A plain <a href> to an authenticated
       door 401s, so "download this link" is an instruction that always fails
       silently. Every download here goes through the session bearer.
     · Where a door refuses for a missing setting (no UDISE code, no board
       affiliation), the refusal is shown as the door's own words. The export
       cannot be faked around, and the screen says which setting is missing.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, DataTable, Empty, ErrorState, PageHead, Section, SkeletonCard, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useRoleOrGrant } from '../lib/access';
import { friendly } from '../lib/friendlyErrors';
import {
  apiCbseRules, apiCbseValidateExam, apiExams, apiTallyDaybook, apiTallyExports,
  apiUdiseColumns, downloadCbseOasis, downloadUdiseExport, type ExamSummary,
} from '../services/liveApi';
import { infraGet, infraSave, type SchoolInfra } from '../services/complianceApi';

/* Indian academic year, April–March, in IST — the same rule the export door applies. */
const currentAy = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const y = Number(p.find(x => x.type === 'year')?.value);
  const m = Number(p.find(x => x.type === 'month')?.value);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: unknown }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: e }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

interface DaybookRow {
  receipt_no: string; student_name: string; amount_cents: number;
  method: string; status: string; gateway_ref?: string | null; paid_at?: string | null;
}

/* UDISE readiness: profile + people + money + affiliation, each named before the return
   is produced — the filing conversation starts here, not at the export button. */
function UdiValidate() {
  const [state, setState] = useState<{ checks: { key: string; label: string; status: string; detail: string }[]; ready: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    import('../services/liveApi').then(({ apiGet }) => apiGet<{ checks: { key: string; label: string; status: string; detail: string }[]; ready: boolean }>('/returns/udise/validate')
      .then(r => { if (live) { setState(r); setError(null); } })
      .catch(e => { if (live) { setState(null); setError(String(e)); } }));
    return () => { live = false; };
  }, [tick]);
  if (error) return <ErrorState title="Could not check readiness" sub={friendly(error)} onRetry={() => setTick(t => t + 1)} />;
  if (!state) return <SkeletonCard lines={3} />;
  return (
    <Card pad={false}>
      <DataTable<{ key: string; label: string; status: string; detail: string }>
        columns={[
          { key: 'label', label: 'Requirement', render: r => <span style={{ fontWeight: 570 }}>{r.label}</span> },
          { key: 'detail', label: 'State', render: r => <span className="u-small u-muted">{r.detail}</span> },
          { key: 'status', label: '', width: 130, render: r => <Badge tone={r.status === 'ok' ? 'success' : 'warning'} dot>{r.status === 'ok' ? 'Ready' : 'Missing'}</Badge> },
        ]}
        rows={state.checks}
        rowKey={r => r.key}
      />
      <div className="u-small u-muted" style={{ padding: '10px 16px' }}>
        {state.ready ? 'Ready to file — every requirement names its evidence above.' : 'Fill the missing rows on Routes & stops (profile), the MPD desk (affiliation) and the NEP desk (third language), then produce the return below.'}
      </div>
    </Card>
  );
}

export default function Returns() {
  const toast = useToast();
  /* Three doors, three gates. Reading the matrix rather than a role list keeps the screen honest
     about who can do what: UDISE and CBSE are the office/coordinator tier, Tally is finance. */
  const canUdise = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator'], ['GET /plugins/ops.udise/columns']);
  const canCbse = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator'], ['GET /plugins/pack.cbse/rules']);
  const canTally = useRoleOrGrant(['owner', 'itadmin', 'finance', 'finance_head', 'finance_clerk'], ['GET /plugins/accounting.tally/daybook']);
  /* The infrastructure profile is the office's own record (UDISE+ tables need room/lab/toilet
     counts and the pupil-teacher ratio derives from the live roster). Reading mirrors the
     GET door; writing is the owner/principal/IT admin tier, like the PUT door. */
  const canReadInfra = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator', 'finance', 'finance_head'], ['GET /school/infra']);
  const canWriteInfra = useRoleOrGrant(['owner', 'principal', 'itadmin'], ['PUT /school/infra']);
  const [infra, setInfra] = useState<{ infra: SchoolInfra | null; ptr: number | null } | null>(null);
  const [infraError, setInfraError] = useState<string | null>(null);
  const [infraForm, setInfraForm] = useState({ classrooms: '', labs: '', toiletsBoys: '', toiletsGirls: '', libraryVolumes: '', drinkingWater: false, playground: false, boundaryWall: false });
  const loadInfra = () => {
    if (!canReadInfra) return;
    infraGet().then(r => {
      setInfra(r); setInfraError(null);
      const v = r.infra;
      if (v) setInfraForm({
        classrooms: String(v.classrooms ?? ''), labs: String(v.labs ?? ''),
        toiletsBoys: String(v.toilets_boys ?? ''), toiletsGirls: String(v.toilets_girls ?? ''),
        libraryVolumes: String(v.library_volumes ?? ''),
        drinkingWater: !!v.drinking_water, playground: !!v.playground, boundaryWall: !!v.boundary_wall,
      });
    }).catch(e => setInfraError(friendly(e)));
  };
  useEffect(() => { loadInfra(); }, [canReadInfra]);
  const saveInfra = async () => {
    const ints: Record<string, number> = {};
    for (const [k, v] of Object.entries({ classrooms: infraForm.classrooms, labs: infraForm.labs, toiletsBoys: infraForm.toiletsBoys, toiletsGirls: infraForm.toiletsGirls, libraryVolumes: infraForm.libraryVolumes })) {
      if (String(v).trim() === '') continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) { toast({ title: `${k} must be a whole number 0 or above`, tone: 'info' }); return; }
      ints[k] = n;
    }
    if (!Object.keys(ints).length && !infra) { toast({ title: 'Fill at least one count first', tone: 'info' }); return; }
    try {
      const r = await infraSave({ ...ints, drinkingWater: infraForm.drinkingWater, playground: infraForm.playground, boundaryWall: infraForm.boundaryWall });
      toast({ title: 'Infrastructure profile saved', sub: 'The UDISE return reads these counts.', tone: 'success' });
      loadInfra();
      void r;
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  const [year, setYear] = useState(currentAy());
  const [busy, setBusy] = useState<string | null>(null);
  const [pickedExam, setPickedExam] = useState<string>('');

  const columns = useAsync(() => apiUdiseColumns(), []);
  const rules = useAsync(() => apiCbseRules(), []);
  const exams = useAsync(async () => (await apiExams()).exams ?? [], []);
  const daybook = useAsync(() => apiTallyDaybook(), []);
  const tallyExports = useAsync(() => apiTallyExports(), []);

  const published = useMemo(() => (exams.data ?? []).filter((e: ExamSummary) => e.status === 'published'), [exams.data]);

  const udiseDownload = async () => {
    setBusy('udise');
    try {
      await downloadUdiseExport(year, `udise-style-${year}.csv`, 'csv');
      toast({ title: `UDISE return produced — ${year}`, sub: 'Aggregates only: no names or phones leave the door.', tone: 'success' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(null); }
  };

  const oasisDownload = async () => {
    if (!pickedExam) { toast({ title: 'Pick an exam first', tone: 'info' }); return; }
    setBusy('oasis');
    try {
      const e = (exams.data ?? []).find((x: ExamSummary) => x.id === pickedExam);
      await downloadCbseOasis(pickedExam, `cbse-oasis-${(e?.name ?? 'exam').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.csv`);
      toast({ title: 'OASIS file produced', sub: 'Upload it in the board portal. Nothing was sent anywhere from here.', tone: 'success' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(null); }
  };

  const validateExam = async () => {
    if (!pickedExam) { toast({ title: 'Pick an exam first', tone: 'info' }); return; }
    setBusy('validate');
    try {
      const r = await apiCbseValidateExam(pickedExam);
      const v = r.violations ?? [];
      toast({
        title: v.length ? `${v.length} rule${v.length === 1 ? '' : 's'} not met` : 'Exam passes the board checks',
        sub: v.length ? v.slice(0, 3).map(x => `${x.rule ?? ''} ${x.detail ?? ''}`).join(' · ') : `Checked ${r.checked ?? 0} report(s).`,
        tone: v.length ? 'info' : 'success',
      });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(null); }
  };

  const rows: DaybookRow[] = ((daybook.data?.entries ?? []) as unknown[]).map(e => e as DaybookRow);

  return (
    <div>
      <PageHead
        title="Statutory returns & exports"
        sub="The files a school has to file or hand over — UDISE, the board's result upload, and the accountant's voucher export. Each one is produced from the school's own records, and each refuses rather than guesses when something is missing."
      />

      {/* ── UDISE ─────────────────────────────────────────────────────────────── */}
      <Section title="UDISE readiness" sub="Profile, people, money and affiliation — each named before the return is produced.">
        <UdiValidate />
      </Section>

      {/* ── Infrastructure profile (the counts the UDISE tables need) ─────────── */}
      {canReadInfra ? (
        <Section title="School infrastructure" sub="Room, lab and toilet counts plus drinking water, playground and boundary wall — the UDISE profile. The pupil-teacher ratio derives from the live roster.">
          {infraError ? <ErrorState title="Could not read the infrastructure profile" sub={infraError.replace('Error: ', '')} onRetry={loadInfra} />
            : !infra ? <SkeletonCard lines={3} />
              : (
                <Card pad={false}>
                  <div className="u-flex u-gap-2 u-wrap" style={{ padding: 'var(--s-5)' }}>
                    <Stat label="Pupil–teacher ratio" value={infra.ptr ?? '—'} sub="Live roster, not a typed number" />
                    <Stat label="Classrooms" value={infra.infra?.classrooms ?? '—'} sub="On record" />
                    <Stat label="Labs" value={infra.infra?.labs ?? '—'} sub="On record" />
                  </div>
                  {canWriteInfra ? (
                    <div style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                      <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
                        {[['classrooms', 'Classrooms'], ['labs', 'Labs'], ['toiletsBoys', 'Toilets (boys)'], ['toiletsGirls', 'Toilets (girls)'], ['libraryVolumes', 'Library volumes']].map(([k, label]) => (
                          <label key={k} className="u-small">{label}
                            <input className="input" inputMode="numeric" value={infraForm[k as 'classrooms' | 'labs' | 'toiletsBoys' | 'toiletsGirls' | 'libraryVolumes']} onChange={e => setInfraForm(f => ({ ...f, [k]: e.target.value }))} style={{ display: 'block', marginTop: 4, maxWidth: 120 }} />
                          </label>
                        ))}
                      </div>
                      <div className="u-flex u-gap-2 u-wrap" style={{ marginTop: 10, alignItems: 'center' }}>
                        {[['drinkingWater', 'Drinking water'], ['playground', 'Playground'], ['boundaryWall', 'Boundary wall']].map(([k, label]) => (
                          <label key={k} className="u-small u-flex" style={{ gap: 6, alignItems: 'center' }}>
                            <input type="checkbox" checked={infraForm[k as 'drinkingWater' | 'playground' | 'boundaryWall']} onChange={e => setInfraForm(f => ({ ...f, [k]: e.target.checked }))} aria-label={label} /> {label}
                          </label>
                        ))}
                        <Button variant="secondary" onClick={saveInfra}>Save profile</Button>
                      </div>
                    </div>
                  ) : <div className="u-xs u-faint" style={{ padding: '0 var(--s-5) var(--s-5)' }}>Editing the profile is the owner, principal and IT admin desk.</div>}
                </Card>
              )}
        </Section>
      ) : null}

      <Section title="UDISE statistical return" sub="Aggregate counts only — no pupil name or phone leaves this door.">
        {!canUdise ? (
          <Card pad><Empty title="Not for your role" sub="The UDISE return is the office and coordinator desk." /></Card>
        ) : (
          <Card pad={false}>
            <div className="u-flex u-gap-2 u-wrap" style={{ padding: 'var(--s-5)', alignItems: 'flex-end' }}>
              <label className="u-small">Academic year (April–March)
                <input className="input" value={year} onChange={e => setYear(e.target.value)} placeholder="2026-27" style={{ display: 'block', marginTop: 4, minWidth: 140 }} />
              </label>
              <Button variant="primary" icon={<Icon.Download size={14} />} disabled={busy === 'udise'} onClick={udiseDownload}>
                {busy === 'udise' ? 'Producing…' : 'Produce the return (CSV)'}
              </Button>
              <span className="u-xs u-faint">
                Two exports over unchanged records are byte-identical — that is the point of the door.
              </span>
            </div>
            {columns.error ? <div style={{ padding: '0 var(--s-5) var(--s-5)' }}>
              <ErrorState title="Could not read the column mapping" sub={friendly(columns.error)} onRetry={columns.retry} />
            </div>
              : columns.loading ? <div style={{ padding: '0 var(--s-5) var(--s-5)' }}><span className="u-small u-muted">Reading the mapping…</span></div>
                : <div style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                  <div className="u-xs u-muted" style={{ marginBottom: 6 }}>What the file contains — the door's own mapping, not a description of it:</div>
                  <div className="u-flex u-gap-2 u-wrap">
                    {Object.entries((columns.data?.sections ?? {}) as Record<string, { grain?: string }>).map(([name, sec]) => (
                      <Badge key={name} tone="outline">{name} · {sec.grain ?? ''}</Badge>
                    ))}
                  </div>
                  {columns.data && 'determinism' in columns.data
                    ? <div className="u-xs u-faint" style={{ marginTop: 8 }}>{String((columns.data as { determinism?: string }).determinism)}</div>
                    : null}
                </div>}
          </Card>
        )}
      </Section>

      {/* ── CBSE ──────────────────────────────────────────────────────────────── */}
      <Section title="Board result upload (CBSE OASIS)" sub="One row per published report, with the report digest. Publish an exam first — reports do not exist before publication.">
        {!canCbse ? (
          <Card pad><Empty title="Not for your role" sub="Board compliance is the office and coordinator desk." /></Card>
        ) : (
          <Card pad={false}>
            <div className="u-flex u-gap-2 u-wrap" style={{ padding: 'var(--s-5)', alignItems: 'flex-end' }}>
              <label className="u-small">Exam
                <select className="input" value={pickedExam} onChange={e => setPickedExam(e.target.value)} style={{ display: 'block', marginTop: 4, minWidth: 260 }}>
                  <option value="">Choose an exam…</option>
                  {published.map(e => <option key={e.id} value={e.id}>{e.name} · {e.classGrade ?? ''}</option>)}
                </select>
              </label>
              <Button variant="secondary" disabled={!pickedExam || busy === 'validate'} onClick={validateExam}>
                {busy === 'validate' ? 'Checking…' : 'Check against the board rules'}
              </Button>
              <Button variant="primary" icon={<Icon.Download size={14} />} disabled={!pickedExam || busy === 'oasis'} onClick={oasisDownload}>
                {busy === 'oasis' ? 'Producing…' : 'Produce the OASIS file'}
              </Button>
              {published.length === 0 && <span className="u-xs u-faint">No published exam yet — publish one on Learning first.</span>}
            </div>
            {rules.data && (
              <div style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                <div className="u-xs u-muted" style={{ marginBottom: 6 }}>
                  {rules.data.pack} v{rules.data.version} · the rules this door enforces:
                </div>
                <div className="u-flex u-gap-2 u-wrap">
                  {Object.entries(rules.data.rules ?? {}).map(([k, v]) => (
                    <span key={k} title={v}><Badge tone="outline">{k}</Badge></span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}
      </Section>

      {/* ── Tally ─────────────────────────────────────────────────────────────── */}
      <Section title="Accountant's export (Tally)" sub="The fee ledger as vouchers, from the same records the school sees. Nothing is pushed to Tally — you download the file.">
        {!canTally ? (
          <Card pad><Empty title="Not for your role" sub="The accountant's export is the owner, IT admin and finance lane." /></Card>
        ) : daybook.loading ? (
          <Card pad><span className="u-small u-muted">Reading the day-book…</span></Card>
        ) : daybook.error ? (
          <ErrorState title="Could not read the day-book" sub={friendly(daybook.error)} onRetry={daybook.retry} />
        ) : (
          <>
            <div className="grid grid-3" style={{ marginBottom: 16 }}>
              <Stat label="Ledger entries" value={rows.length} sub="Fee payments on record" />
              <Stat label="Settled" value={rows.filter(r => r.status === 'settled' || r.status === 'confirmed').length} sub="Confirmed receipts" />
              <Stat label="Exports made" value={(tallyExports.data?.exports ?? []).length} sub="Each one audited with a content hash" />
            </div>
            <Card pad={false}>
              <DataTable<DaybookRow>
                columns={[
                  { key: 'receipt', label: 'Receipt', render: r => <span className="mono u-xs">{r.receipt_no ?? '—'}</span> },
                  { key: 'who', label: 'Pupil', render: r => <span>{r.student_name ?? '—'}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', render: r => <span className="tnum">₹{(Number(r.amount_cents ?? 0) / 100).toLocaleString('en-IN')}</span> },
                  { key: 'method', label: 'Method', render: r => <span className="u-small u-muted">{r.method ?? '—'}</span> },
                  { key: 'status', label: 'Status', render: r => <Badge tone={r.status === 'settled' || r.status === 'confirmed' ? 'success' : 'outline'}>{r.status ?? '—'}</Badge> },
                ]}
                rows={rows.slice(0, 60)}
                rowKey={(r: DaybookRow) => r.receipt_no || `${r.method}-${r.amount_cents}`}
                empty={<Empty icon={<Icon.Wallet size={22} />} title="Nothing in the ledger yet" sub="Fee payments appear here once finance records them." />}
              />
            </Card>
            <div className="u-xs u-faint" style={{ marginTop: 10 }}>
              The voucher XML is produced by the add-on's export door with a date window and is audited with a
              content hash (never with amounts). {(tallyExports.data?.exports ?? []).length === 0
                ? 'No export has been run yet.'
                : `Last ${Math.min(3, (tallyExports.data?.exports ?? []).length)}:`}
              {(tallyExports.data?.exports ?? []).slice(0, 3).map((e: Record<string, unknown>) => (
                <div key={String(e.created_at)}>{String(e.outcome ?? '')}</div>
              ))}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
