/* ============================================================
   ImportMapper — the "understand the file" half of an import
   (the `ops.import` engine), rendered on the Migration screen.

   WHY IT EXISTS. The kernel's commit doors are the only authority
   that creates records, and they take a canonical staged row. A
   real school arrives as a spreadsheet whose columns are called
   whatever the last admin typed. This component closes that gap:
   parse the file, map its columns onto the canonical fields, and
   run the server's shadow analysis — which validates every row and
   diffs the result against the school's OWN students, guardians
   and fee records — before a single row is staged.

   It writes NOTHING. The dry run is the server's; the staging hand-
   off is the kernel's; the commit stays the operator's separate,
   explicit decision one card above.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  apiImportSchema,
  apiImportShadow,
  apiImportValidateMapping,
  apiMigrationStageRows,
  type ImportSchema,
  type ImportShadowReport,
} from '../../services/liveApi';
import { useKernel } from '../../plugins/useKernel';
import { useRoleOrGrant } from '../../lib/access';
import { friendly } from '../../lib/friendlyErrors';
import { humanize } from '../../lib/labels';
import { Badge, Button, Card, DataTable, ErrorState, KeyValue, useToast } from '../../components/ui';
import { describeField, guessMapping, parseCsv, toStagedRows } from './importMapping';

const MAX_ROWS = 5000;

interface Props {
  /** The kernel's migration sources — the dry run needs a home only when rows are staged. */
  sources: Record<string, unknown>[];
  /** The parent re-reads the source list after a successful staging. */
  onStaged: () => void;
}

export default function ImportMapper({ sources, onStaged }: Props) {
  const toast = useToast();
  const { isEnabled } = useKernel();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState('students');
  const [schema, setSchema] = useState<ImportSchema | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mapErrors, setMapErrors] = useState<{ field: string | null; error: string }[]>([]);
  const [mapOk, setMapOk] = useState<boolean | null>(null);
  const [report, setReport] = useState<ImportShadowReport | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /* The doors are gated differently on purpose: mapping advice is open to the admissions
     desk, the dry run is not (it reads the school's own records), and staging is the
     kernel's own narrower authority. `useRoleOrGrant` never offers a control the server
     refuses — server/tests/ui-role-drift.test.js enforces that pairing. */
  const canMap = useRoleOrGrant(
    ['owner', 'principal', 'coordinator', 'itadmin', 'admissions'],
    ['GET /plugins/ops.import/schema/students'],
  );
  const canDryRun = useRoleOrGrant(
    ['owner', 'principal', 'coordinator', 'itadmin'],
    ['POST /plugins/ops.import/shadow'],
  );
  const canStage = useRoleOrGrant(
    ['owner', 'coordinator', 'itadmin'],
    ['POST /migration/sources/:id/stage-rows'],
  );

  const parsed = useMemo(() => parseCsv(text), [text]);
  const fields = useMemo(() => Object.entries(schema?.fields ?? {}), [schema]);
  const staged = useMemo(
    () => (kind === 'students' ? toStagedRows(parsed.rows, mapping) : []),
    [kind, parsed.rows, mapping],
  );
  /* The schema is the server's: the browser never invents the target column set. */
  useEffect(() => {
    if (!isEnabled('ops.import')) return;
    let live = true;
    setSchema(null); setSchemaError(null); setReport(null); setMapOk(null); setMapErrors([]);
    apiImportSchema(kind)
      .then(r => {
        if (!live) return;
        setSchema(r.schema);
        setMapping(guessMapping(parsed.columns, Object.keys(r.schema.fields)));
      })
      .catch(e => { if (live) setSchemaError(String(e)); });
    return () => { live = false; };
    // re-guessing on every keystroke would overwrite a mapping the operator just fixed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, tick, isEnabled('ops.import')]);

  const onFile = async (file: File) => {
    setText(await file.text());
    setReport(null); setMapOk(null); setMapErrors([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const remap = (field: string, column: string) => {
    setMapOk(null); setMapErrors([]); setReport(null);
    setMapping(prev => {
      const next: Record<string, string> = {};
      for (const [src, tgt] of Object.entries(prev)) if (tgt && tgt !== field) next[src] = tgt;
      if (column) next[column] = field;
      return next;
    });
  };

  const checkMapping = async () => {
    setBusy('map'); setMapErrors([]); setMapOk(null); setReport(null);
    try {
      await apiImportValidateMapping(kind, mapping);
      setMapOk(true);
    } catch (e) {
      setMapErrors(readFieldErrors(e));
    } finally { setBusy(null); }
  };

  const dryRun = async () => {
    if (!parsed.rows.length) { toast({ title: 'Nothing to check', sub: 'Paste or upload a file with a header row first.', tone: 'info' }); return; }
    setBusy('shadow'); setReport(null); setMapErrors([]); setMapOk(null);
    try {
      setReport(await apiImportShadow(kind, mapping, parsed.rows));
    } catch (e) {
      const errs = readFieldErrors(e);
      setMapErrors(errs);
      toast({ title: 'The dry run was refused', sub: errs[0]?.error ?? friendly(e), tone: 'error' });
    } finally { setBusy(null); }
  };

  const stageRows = async () => {
    if (!target) { toast({ title: 'Choose a source first', sub: 'The staged rows belong to one migration source.', tone: 'info' }); return; }
    setBusy('stage');
    try {
      const res = await apiMigrationStageRows(target, staged);
      toast({
        title: `${res.staged} row(s) staged`,
        sub: 'Staged rows live in the migration area — validate and commit them above when you are ready. Nothing is in the school records yet.',
        tone: 'success',
      });
      setReport(null);
      onStaged();
    } catch (e) {
      toast({ title: 'Staging refused', sub: friendly(e), tone: 'error' });
    } finally { setBusy(null); }
  };

  const open = sources.filter(s => s.status !== 'verified' && s.status !== 'activated');

  return (
    <Card
      pad
      className="u-col"
      style={{ gap: 12 }}
    >
      <div className="card-head u-between" style={{ gap: 10 }}>
        <h3>Map a spreadsheet</h3>
        <Badge tone="info">Dry run — writes nothing</Badge>
      </div>
      <div className="card-body u-col" style={{ gap: 12 }}>
        <p className="u-small u-muted" style={{ margin: 0 }}>
          Paste a CSV with a header row, say which column is which, and read what the file would do to your
          school before anything is staged. The dry run validates every row and compares it with your own
          students, guardians and fee records.
        </p>

        {!canMap ? (
          <span className="u-small u-muted">
            Column mapping is done by the owner, principal, coordinator, IT admin or the admissions desk —
            the server enforces that, so the controls are not offered to anyone else.
          </span>
        ) : (
          <>
            <div className="u-flex u-wrap" style={{ gap: 8 }}>
              <select
                className="select"
                style={{ width: 170 }}
                value={kind}
                onChange={e => setKind(e.target.value)}
                aria-label="What the file contains"
              >
                {['students', 'guardians', 'fees'].map(k => <option key={k} value={k}>{humanize(k)}</option>)}
              </select>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="input"
                style={{ flex: 1, minWidth: 200 }}
                onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
                aria-label="CSV file to map"
              />
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="import-csv">Or paste the file — first line is the column names</label>
              <textarea
                id="import-csv"
                className="input"
                rows={4}
                value={text}
                onChange={e => { setText(e.target.value); setReport(null); setMapOk(null); }}
                placeholder={'Admission No,Name,Class,Section,Father,Mobile\nSCH-0001,Meera Nair,5,A,Ramesh,9876543210'}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </div>

            {schemaError && <ErrorState title="Could not read the field list" sub={friendly(schemaError)} onRetry={() => setTick(t => t + 1)} />}

            {parsed.columns.length > 0 && (
              <div className="u-small u-muted">
                Read <b>{parsed.rows.length}</b> row(s) and <b>{parsed.columns.length}</b> column(s)
                {parsed.skipped > 0 && <> — {parsed.skipped} line(s) did not have one value per column and were read as far as they went</>}
                {parsed.rows.length > MAX_ROWS && <> — the engine stages at most {MAX_ROWS} rows per batch, so stage the file in parts</>}
                .
              </div>
            )}

            {fields.length > 0 && (
              <div className="u-col" style={{ gap: 6 }}>
                <span className="u-small" style={{ fontWeight: 600 }}>Match each column to a {humanize(kind).toLowerCase()} field</span>
                {fields.map(([name, def]) => (
                  <div key={name} className="u-flex u-wrap u-between" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="u-small" style={{ minWidth: 190 }}>
                      <b>{name}</b>{' '}
                      {def.required
                        ? <Badge tone="danger">required</Badge>
                        : <span className="u-xs u-faint">optional</span>}
                      <span className="u-xs u-faint"> — {describeField(def)}</span>
                    </span>
                    <select
                      className="select"
                      style={{ width: 220 }}
                      value={Object.entries(mapping).find(([, t]) => t === name)?.[0] ?? ''}
                      onChange={e => remap(name, e.target.value)}
                      aria-label={`Column for ${name}`}
                    >
                      <option value="">— not in this file —</option>
                      {parsed.columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
                {parsed.columns.length === 0 && (
                  <span className="u-xs u-faint">Paste or upload the file and its columns appear here to match.</span>
                )}
              </div>
            )}

            <div className="u-flex u-wrap" style={{ gap: 8 }}>
              <Button size="sm" variant="secondary" loading={busy === 'map'} disabled={!!busy || !parsed.columns.length} onClick={checkMapping}>
                Check the mapping
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busy === 'shadow'}
                disabled={!!busy || !canDryRun || !parsed.rows.length}
                onClick={dryRun}
              >
                Dry run
              </Button>
              {!canDryRun && <span className="u-xs u-faint">The dry run reads the school&apos;s own records, so it is owner, principal, coordinator or IT admin.</span>}
            </div>

            {mapOk && <Badge tone="success" dot>The mapping is complete — every required field has a column.</Badge>}
            {mapErrors.length > 0 && (
              <div className="u-col" style={{ gap: 4 }}>
                {mapErrors.map((e, i) => (
                  <div key={i} className="u-small" style={{ color: 'var(--danger-text)' }}>
                    {e.field ? <b>{e.field}: </b> : null}{e.error}
                  </div>
                ))}
              </div>
            )}

            {report && <ShadowResult report={report} />}

            {kind === 'students' && (
              <div className="u-col" style={{ gap: 8 }}>
                <div className="u-flex u-wrap u-between" style={{ gap: 8 }}>
                  <span className="u-small">
                    Ready to stage <b>{staged.length}</b> row(s) for import?
                  </span>
                  {canStage ? (
                    <div className="u-flex u-wrap" style={{ gap: 8 }}>
                      <select
                        className="select"
                        style={{ width: 220 }}
                        value={target}
                        onChange={e => setTarget(e.target.value)}
                        aria-label="Migration source to stage into"
                      >
                        <option value="">— choose a source —</option>
                        {open.map(s => <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}
                      </select>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === 'stage'}
                        disabled={!!busy || !target || !staged.length}
                        onClick={stageRows}
                      >
                        Stage these rows
                      </Button>
                    </div>
                  ) : (
                    <span className="u-xs u-faint">Staging is the migration engine&apos;s own step — owner, coordinator or IT admin.</span>
                  )}
                </div>
                {staged.length > 0 && (
                  <>
                    <DataTable
                      columns={[
                        { key: 'rowNo', label: 'Row' },
                        { key: 'admissionNo', label: 'Admission no.' },
                        { key: 'name', label: 'Name' },
                        { key: 'class', label: 'Class' },
                        { key: 'guardian', label: 'Guardian' },
                      ]}
                      rows={staged.slice(0, 8).map(r => ({
                        rowNo: r.rowNo,
                        admissionNo: String(r.data.admissionNo ?? '—'),
                        name: String(r.data.name ?? '—'),
                        class: `${String(r.data.grade ?? '—')}-${String(r.data.section ?? '—')}`,
                        guardian: r.data.guardianPhone ? `${String(r.data.guardianName ?? 'Guardian')} ${String(r.data.guardianPhone)}` : '—',
                      }))}
                      rowKey={r => String(r.rowNo)}
                      caption={`The first ${Math.min(8, staged.length)} of ${staged.length} rows the server would be asked to stage`}
                    />
                    {staged.length > 8 && <span className="u-xs u-faint">The first 8 of {staged.length} rows are shown — staging sends all of them.</span>}
                  </>
                )}
              </div>
            )}

            {kind !== 'students' && (
              <div className="u-small u-muted">
                {kind === 'guardians'
                  ? 'Guardian rows are checked here, but guardians reach the school through a student: put the guardian columns on the students file and the commit writes both together.'
                  : 'Fee rows are checked here, but a fee reaches the school through its student: the commit takes a fees list inside a student row, so map the fees file first and stage the student rows it belongs to.'}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** The server's own numbers, in its own words. Nothing here is computed in the browser. */
function ShadowResult({ report }: { report: ImportShadowReport }) {
  const diff = (report.diff ?? {}) as Record<string, unknown>;
  const items: { k: string; v: React.ReactNode }[] = [];
  const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? '—'));
  const rupees = (v: unknown) => {
    const cents = Number(v);
    return Number.isFinite(cents) ? `₹${(cents / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';
  };
  for (const [k, v] of Object.entries(diff)) {
    if (v === null || v === undefined) continue;
    if (k === 'unresolvedAmountCents' || k === 'totalAmountCents') items.push({ k: humanize(k), v: rupees(v) });
    else if (k === 'byTermCents' && v && typeof v === 'object') {
      items.push({
        k: 'By term',
        v: Object.entries(v as Record<string, number>).map(([term, cents]) => `${term}: ${rupees(cents)}`).join(' · '),
      });
    } else if (k === 'classDistribution' && v && typeof v === 'object') {
      const pairs = Object.entries(v as Record<string, number>).sort((a, b) => b[1] - a[1]);
      items.push({ k: 'Classes in the file', v: pairs.map(([c, count]) => `${c} (${count})`).join(' · ') });
    } else if (Array.isArray(v)) items.push({ k: humanize(k), v: v.length ? v.join(', ') : 'none' });
    else items.push({ k: humanize(k), v: n(v) });
  }

  return (
    <div className="u-col" style={{ gap: 8 }}>
      <div className="u-flex u-wrap" style={{ gap: 8 }}>
        <Badge tone="success" dot>{report.validRows} valid row(s)</Badge>
        <Badge tone={report.errorRows ? 'danger' : 'neutral'}>{report.errorRows} row(s) with errors</Badge>
        <Badge tone="info">Read {report.analyzed} of {report.totalRows}</Badge>
        {report.truncated && <Badge tone="warning">Only the first {report.analyzed} rows were analysed</Badge>}
      </div>
      {items.length > 0 && <KeyValue cols={2} items={items} />}
      {report.topErrors.length > 0 && (
        <div className="u-col" style={{ gap: 4 }}>
          <span className="u-small" style={{ fontWeight: 600 }}>What the file gets wrong</span>
          {report.topErrors.map((e, i) => (
            <div key={i} className="u-small" style={{ color: 'var(--danger-text)' }}>{e.rows} row(s): {e.error}</div>
          ))}
        </div>
      )}
      <span className="u-xs u-faint">
        This is the server&apos;s own analysis of your file against your school records. Nothing was written —
        staging hands the rows to the migration engine, and committing is a separate, explicit step.
      </span>
    </div>
  );
}

/** A 400 from validate-mapping/shadow carries `{ ok:false, errors:[…] }`; anything else is a plain error. */
function readFieldErrors(e: unknown): { field: string | null; error: string }[] {
  const anyE = e as { payload?: { errors?: { field?: string | null; error?: string }[] }; message?: string };
  const list = anyE?.payload?.errors;
  if (Array.isArray(list) && list.length) {
    return list.map(x => ({ field: x.field ?? null, error: x.error ?? 'invalid value' }));
  }
  return [{ field: null, error: friendly(e) }];
}
