/* ============================================================
   Migration — the real engine (L4-4.1).
   Connect a source → stage rows → validate → dry-run stage
   markers → commit → activate → trust receipt with the REAL
   differenceCents from the ledger. The wizard says exactly what
   the server did.
   ============================================================ */
import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { apiMigrationSources, apiMigrationCreateSource, apiMigrationStage, apiMigrationStageRows, apiMigrationValidate, apiMigrationCommit, apiMigrationActivate, type TrustReceipt } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Button, useToast, KeyValue, SkeletonCard, ErrorState } from '../components/ui';


export default function Migration() {
  return <LiveMigration />;
}

/* ============================================================
   LIVE migration — the real engine (L4-4.1).
   Connect a source → stage rows (≤5000) → validate (shape +
   admission-number checks, first-20 errors surfaced) → dry-run
   stage markers → commit (created/skipped/imported quoted) →
   activate (owner/principal) → trust receipt with the REAL
   differenceCents from the ledger. The wizard says exactly what
   the server did — never "Meridian is live" fiction.
   ============================================================ */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(st => ({ ...st, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: String(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

const rupees = (cents: string | number) => {
  const n = typeof cents === 'string' ? Number(cents) : cents;
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}₹${(Math.abs(Number(n)) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

function LiveMigration() {
  const toast = useToast();
  const { session } = useStore();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('students');
  const [selected, setSelected] = useState<string | null>(null);
  const [rowsText, setRowsText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [validate, setValidate] = useState<{ clean: number; errors: number; first: { rowNo: number; error: string }[] } | null>(null);
  const [receipt, setReceipt] = useState<TrustReceipt | null>(null);
  const [commitResult, setCommitResult] = useState<{ created: number; skipped: number; imported: number } | null>(null);

  const canMigrate = ['owner', 'coordinator', 'itadmin'].includes(session.roleId);
  const canActivate = ['owner', 'principal'].includes(session.roleId);

  const sources = useAsync(async () => {
    const res = await apiMigrationSources();
    return (res.sources ?? []) as Record<string, unknown>[];
  }, []);

  const list: Record<string, unknown>[] = sources.data ?? [];
  const sel = list.find(x => String(x.id) === selected) ?? null;

  const createSource = async () => {
    if (!name.trim()) return;
    setBusy('create');
    try {
      const res = await apiMigrationCreateSource({ name: name.trim(), kind });
      toast({ title: `Source connected — ${res.source.name ?? name}`, sub: 'Nothing imported yet. Stage rows next; live data is untouched until you commit.', tone: 'success' });
      setName('');
      setSelected(String(res.source.id));
      sources.retry();
    } catch (e) {
      toast({ title: 'Could not connect the source', sub: friendly(e), tone: 'error' });
    } finally { setBusy(null); }
  };

  const parseRows = (): { rowNo: number; data: Record<string, unknown> }[] | null => {
    try {
      const parsed = JSON.parse(rowsText);
      if (!Array.isArray(parsed)) return null;
      return parsed.map((r: { rowNo?: number; data?: Record<string, unknown> }, i: number) => ({ rowNo: Number(r.rowNo ?? i + 1), data: r.data ?? r }));
    } catch { return null; }
  };

  const stageRows = async () => {
    if (!sel) return;
    const rows = parseRows();
    if (!rows) { toast({ title: 'Rows must be a JSON array', sub: 'Each entry: { rowNo, data: { name, grade, section, fees? } }', tone: 'error' }); return; }
    if (rows.length > 5000) { toast({ title: 'Too many rows', sub: 'The engine accepts up to 5000 rows per batch — split the file.', tone: 'error' }); return; }
    setBusy('stage');
    try {
      const res = await apiMigrationStageRows(String(sel.id), rows);
      toast({ title: `${res.staged} row(s) staged`, sub: `${res.total} total in the source — staged rows live in the migration area, not the live ledger.`, tone: 'success' });
      sources.retry();
    } catch (e) {
      toast({ title: 'Staging refused', sub: friendly(e), tone: 'error' });
    } finally { setBusy(null); }
  };

  const runValidate = async () => {
    if (!sel) return;
    setBusy('validate');
    try {
      const res = await apiMigrationValidate(String(sel.id));
      setValidate(res);
      toast({
        title: res.errors === 0 ? `${res.clean} row(s) clean` : `${res.errors} row(s) have errors`,
        sub: res.errors === 0 ? 'Shape, required fields and fee amounts all pass. Commit when ready.' : 'The first 20 are listed — fix them in the legacy sheet and re-stage.',
        tone: res.errors === 0 ? 'success' : 'info',
      });
    } catch (e) {
      toast({ title: 'Validation refused', sub: friendly(e), tone: 'error' });
    } finally { setBusy(null); }
  };

  const markStage = async (to: 'analyzed' | 'mapped' | 'health-check' | 'shadow') => {
    if (!sel) return;
    setBusy(`stage-${to}`);
    try {
      await apiMigrationStage(String(sel.id), to);
      toast({ title: `Dry-run marker set: ${to}`, sub: 'Bookkeeping only — no live data changed.', tone: 'info' });
      sources.retry();
    } catch (e) {
      toast({ title: 'Could not set the marker', sub: friendly(e), tone: 'error' });
    } finally { setBusy(null); }
  };

  const commit = async () => {
    if (!sel) return;
    setBusy('commit');
    try {
      const res = await apiMigrationCommit(String(sel.id));
      setCommitResult({ created: res.created, skipped: res.skipped, imported: res.imported });
      toast({ title: `Committed — ${res.imported} record(s) created`, sub: `${res.skipped} skipped (duplicates). The source is now verified; the live ledger changed and every row is audited.`, tone: 'success' });
      sources.retry();
    } catch (e) {
      toast({ title: 'Commit refused', sub: friendly(e), tone: 'error' });
    } finally { setBusy(null); }
  };

  const activate = async () => {
    setBusy('activate');
    try {
      const res = await apiMigrationActivate();
      setReceipt(res.trustReceipt as unknown as TrustReceipt);
      toast({ title: 'Cutover recorded', sub: 'The trust receipt below is computed from the ledger — check the difference figure.', tone: 'success' });
      sources.retry();
    } catch (e) {
      toast({ title: 'Activation refused', sub: friendly(e), tone: 'error' });
    } finally { setBusy(null); }
  };

  return (
    <div className="u-col" style={{ gap: 14 }}>
      <PageHead
        title="Migration"
        sub="The real engine: connect a legacy source, stage its rows, validate, commit, then activate. Live data changes only at commit — everything before that is a dry run."
      />

      {/* ---- connect ---- */}
      <Card pad>
        <div className="card-head"><h3>1 · Connect a source</h3></div>
        <div className="card-body u-col" style={{ gap: 10 }}>
          {canMigrate ? (
            <div className="u-flex u-wrap" style={{ gap: 8 }}>
              <input className="input" style={{ flex: 2, minWidth: 200 }} placeholder="Source name — e.g. Excel “Master 2026-27”" value={name} onChange={e => setName(e.target.value)} aria-label="Source name" />
              <select className="select" style={{ width: 150 }} value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">
                {['students', 'fees', 'admissions', 'transport', 'assets'].map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <Button variant="primary" loading={busy === 'create'} disabled={!!busy || !name.trim()} onClick={createSource}>Connect</Button>
            </div>
          ) : (
            <span className="u-small u-muted">Connecting sources is done by the owner, coordinator or IT admin.</span>
          )}
          {sources.loading ? <SkeletonCard lines={2} /> : sources.error ? (
            <ErrorState title="Could not load sources" sub={friendly(sources.error)} onRetry={sources.retry} />
          ) : list.length === 0 ? (
            <span className="u-small u-muted">No sources connected yet.</span>
          ) : (
            <div className="u-col" style={{ gap: 6 }}>
              {list.map((src: Record<string, unknown>) => (
                <button
                  key={String(src.id)}
                  onClick={() => { setSelected(String(src.id)); setValidate(null); setCommitResult(null); }}
                  className="u-between card-click"
                  style={{ gap: 10, border: `1px solid ${selected === String(src.id) ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', padding: '9px 12px', background: 'transparent', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
                >
                  <span className="u-col" style={{ gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{String(src.name)}</span>
                    <span className="u-xs u-faint">{String(src.kind)} · {Number(src.row_count ?? 0)} rows staged · {Number(src.imported ?? 0)} imported · {Number(src.flagged ?? 0)} flagged</span>
                  </span>
                  <Badge tone={src.status === 'verified' || src.status === 'activated' ? 'success' : 'info'}>{String(src.status)}</Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ---- work a source ---- */}
      {sel && sel.status !== 'verified' && sel.status !== 'activated' && (
        <Card pad>
          <div className="card-head"><h3>2 · Stage, validate, commit — {String(sel.name)}</h3><Badge tone="info">{String(sel.status)}</Badge></div>
          <div className="card-body u-col" style={{ gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="mig-rows">Rows — JSON array of {'{ rowNo, data }'}; data needs name, grade, section (fees optional: [{'{'}term, label, amountCents{'}'}])</label>
              <textarea id="mig-rows" className="input" rows={6} value={rowsText} onChange={e => setRowsText(e.target.value)}
                placeholder={'[{"rowNo":1,"data":{"name":"Meera Nair","grade":"5","section":"A"}}]'}
                style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12 }} />
            </div>
            <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" variant="secondary" loading={busy === 'stage'} disabled={!!busy} onClick={stageRows}>Stage rows (≤5000)</Button>
              <Button size="sm" variant="secondary" loading={busy === 'validate'} disabled={!!busy} onClick={runValidate}>Validate</Button>
              {(['analyzed', 'mapped', 'health-check', 'shadow'] as const).map(st => (
                <Button key={st} size="sm" variant="ghost" loading={busy === `stage-${st}`} disabled={!!busy} onClick={() => markStage(st)}>
                  Mark {st}
                </Button>
              ))}
              <Button size="sm" variant="primary" loading={busy === 'commit'} disabled={!!busy || !!validate && validate.errors > 0} onClick={commit}>
                Commit to the live ledger
              </Button>
            </div>
            {validate && (
              <div className="u-col" style={{ gap: 6 }}>
                <div className="u-flex" style={{ gap: 8 }}>
                  <Badge tone={validate.errors === 0 ? 'success' : 'danger'} dot>{validate.clean} clean</Badge>
                  <Badge tone={validate.errors === 0 ? 'success' : 'danger'}>{validate.errors} error(s)</Badge>
                </div>
                {validate.first?.map((f, i) => (
                  <div key={i} className="u-small" style={{ color: 'var(--danger-text)' }}>Row {f.rowNo}: {f.error}</div>
                ))}
                {validate.errors > validate.first.length && <span className="u-xs u-faint">…and {validate.errors - validate.first.length} more</span>}
                {validate.errors === 0 && <span className="u-xs u-faint">Commit checks admission-number uniqueness again at write time — a duplicate row fails on its own, never the batch.</span>}
              </div>
            )}
            {commitResult && (
              <div className="u-small u-muted">
                Last commit: <b>{commitResult.imported}</b> created · {commitResult.skipped} skipped (duplicates). The source is verified — connect a new source to import more.
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ---- activate + trust receipt ---- */}
      <Card pad>
        <div className="card-head"><h3>3 · Activate (cutover)</h3></div>
        <div className="card-body u-col" style={{ gap: 10 }}>
          {canActivate ? (
            <Button variant="primary" loading={busy === 'activate'} disabled={!!busy} onClick={activate}>Run activation</Button>
          ) : (
            <span className="u-small u-muted">Activation is an owner or principal decision — the server enforces it.</span>
          )}
          {receipt && (
            <div className="u-col" style={{ gap: 8 }}>
              <KeyValue
                cols={1}
                items={[
                  { k: 'Rows in the ledger', v: String(receipt.totalRows) },
                  { k: 'Imported', v: String(receipt.imported) },
                  { k: 'Flagged for follow-up', v: String(receipt.flagged) },
                  { k: 'Skipped', v: String(receipt.skipped) },
                  { k: 'Fee ledger total', v: rupees(receipt.feeTotalCents) },
                  { k: 'Fee ledger paid', v: rupees(receipt.feePaidCents) },
                  { k: 'Difference (computed from the ledger)', v: <b style={{ color: receipt.differenceCents === '0' ? 'var(--success-text, var(--accent-text))' : 'var(--warning-text, var(--text-1))' }}>{rupees(receipt.differenceCents)}</b> },
                  { k: 'Rollback window', v: `${receipt.rollbackDays} days` },
                ]}
              />
              <span className="u-xs u-faint">
                This receipt is computed from the live ledger at activation time — the difference figure is the ledger's own arithmetic, not an estimate.
                {receipt.differenceCents !== '0' && ' A non-zero difference means fees and payments do not reconcile yet — open reconciliation before treating the money ledger as closed.'}
              </span>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

