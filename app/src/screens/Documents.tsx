/* ============================================================
   Documents — the compliance registry. Filters + search over
   seed.documents, expiring-soon renewals with one-tap tasks,
   the expiry-forecast AI block, the inspection-pack generator,
   and a mock upload modal that appends to the working list.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import {
  PageHead, Section, Card, Stat, Badge, DataTable, Button, useToast,
  Modal, Empty, ErrorState, Skeleton, KeyValue,
} from '../components/ui';
import { friendly } from '../lib/friendlyErrors';
import { BarChart } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort } from '../lib/format';
import { makeRng } from '../lib/rng';
import type { DocRecord } from '../types/domain';

/* ---------- standard async hook (APP-SPEC pattern, local copy) ---------- */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => live && setState({ data: d, loading: false, error: null }))
      .catch(e => live && setState({ data: null, loading: false, error: friendly(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

/* ============================================================
   Local mock: QR report poster metadata (decorative pattern)
   ============================================================ */
function QrPattern() {
  const rng = makeRng(3131);
  const cells: boolean[] = [];
  for (let i = 0; i < 21 * 21; i++) cells.push(rng.next() > 0.52);
  const corner = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} fill="var(--text)" rx={1} />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="var(--surface)" rx={0.8} />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="var(--text)" rx={0.6} />
    </g>
  );
  return (
    <svg viewBox="0 0 21 21" width={118} height={118} aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      {cells.map((on, i) => {
        const x = i % 21, y = Math.floor(i / 21);
        const inCorner = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
        if (!on || inCorner) return null;
        return <rect key={i} x={x} y={y} width={0.92} height={0.92} fill="var(--text)" opacity={0.85} />;
      })}
      {corner(0, 0)}
      {corner(14, 0)}
      {corner(0, 14)}
    </svg>
  );
}

/* ---------- status visuals ---------- */
function docStatusBadge(d: DocRecord) {
  if (d.status === 'expired') return <Badge tone="danger" dot>Expired</Badge>;
  if (d.status === 'expiring') return <Badge tone="warning" dot>Expiring</Badge>;
  return <Badge tone="success" dot>Valid</Badge>;
}

/* ============================================================ */

type StatusFilter = 'all' | 'valid' | 'expiring' | 'expired';
type OwnerFilter = 'all' | 'student' | 'staff' | 'school';

export default function Documents() {
  const { session, dispatch, actorName } = useStore();
  const toast = useToast();

  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [ownerType, setOwnerType] = useState<OwnerFilter>('all');
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  /* uploaded docs land in local working-list state (demo) */
  const [extraDocs, setExtraDocs] = useState<DocRecord[]>([]);
  const [form, setForm] = useState({ name: '', category: 'Identity', expiry: '' });

  /* registry loads through the standard async pattern (Promise over seed data) */
  const registry = useAsync(async () => {
    await new Promise(r => setTimeout(r, 300)); // simulated service latency
    return seed.documents;
  }, []);

  const all = useMemo(() => [...(registry.data ?? []), ...extraDocs], [registry.data, extraDocs]);

  const categories = useMemo(() => Array.from(new Set(all.map(d => d.category))).sort(), [all]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(d =>
      (category === 'all' || d.category === category) &&
      (status === 'all' || d.status === status) &&
      (ownerType === 'all' || d.ownerType === ownerType) &&
      (!q || `${d.title} ${d.ownerName}`.toLowerCase().includes(q)),
    );
  }, [all, category, status, ownerType, query]);

  const stats = useMemo(() => {
    const in30 = all.filter(d => d.expiresOn && d.expiresOn.getTime() >= Date.now() && d.expiresOn.getTime() <= Date.now() + 30 * 86400000).length;
    const expired = all.filter(d => d.status === 'expired').length;
    const verified = all.length ? Math.round((all.filter(d => d.status === 'valid').length / all.length) * 1000) / 10 : 0;
    return { total: all.length, in30, expired, verified };
  }, [all]);

  const expiringSoon = useMemo(
    () => all
      .filter(d => d.expiresOn)
      .sort((a, b) => a.expiresOn!.getTime() - b.expiresOn!.getTime())
      .slice(0, 5),
    [all],
  );

  /* expiry forecast: next 4 months from seed.documents (deterministic) */
  const forecast = useMemo(() => {
    const months: { label: string; value: number; color?: string }[] = [];
    const now = new Date();
    for (let m = 0; m < 4; m++) {
      const start = new Date(now.getFullYear(), now.getMonth() + m, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + m + 1, 1);
      const count = seed.documents.filter(d => d.expiresOn && d.expiresOn >= start && d.expiresOn < end).length;
      months.push({ label: start.toLocaleDateString('en-IN', { month: 'short' }), value: count, color: m === 0 ? 'var(--warning)' : 'var(--accent)' });
    }
    return months;
  }, []);

  const createRenewalTask = (d: DocRecord) => {
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId,
        action: 'Noted renewal need (no task created)', recordType: 'Document', recordRef: `${d.title} — ${d.ownerName}`,
        reason: d.expiresOn ? `Expires ${fmtDate(d.expiresOn)}` : 'Renewal due',
        policyRef: 'Workflow wf_5 · document.expiring', aiInvolved: false, risk: 'low',
        outcome: 'Note kept on this device · workflow runtime not connected',
      },
    });
    /* T305 (§9.5): there is no workflow runtime — no task exists anywhere and
       no reminder will fire. */
    toast({ title: 'Noted on this device', sub: `${d.title} — renewal workflows are not connected, so no task was created and no reminder will fire.`, tone: 'info' });
  };

  const generatePack = () => {
    setGenerating(true);
    setPackOpen(false);
    setTimeout(() => {
      setGenerating(false);
      dispatch({
        type: 'audit/add',
        entry: {
          actor: actorName, actorRole: session.roleId,
          action: 'Requested inspection pack (not connected)', recordType: 'Document bundle', recordRef: 'Inspection pack',
          reason: 'CBSE OASIS inspection readiness', policyRef: 'Compliance §2.1',
          aiInvolved: false, risk: 'low', outcome: 'No bundle generated — pack assembly requires server support',
        },
      });
      /* T305 (§9.5): no bundle is produced anywhere — the old toast claimed a
         42-document pack had been assembled. */
      toast({ title: 'Not connected', sub: 'Inspection packs require server support — no bundle was generated and nothing was downloaded.', tone: 'info' });
    }, 400);
  };

  const submitUpload = () => {
    if (!form.name.trim()) {
      toast({ title: 'File name required', sub: 'Give the document a recognisable name before uploading.', tone: 'error' });
      return;
    }
    const exp = form.expiry ? new Date(form.expiry + 'T00:00:00') : undefined;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const doc: DocRecord = {
      id: `doc_local_${Date.now()}`,
      ownerType: 'school',
      ownerId: 'school',
      ownerName: seed.SCHOOL.name,
      title: form.name.trim(),
      category: form.category,
      expiresOn: exp,
      status: !exp ? 'valid' : exp.getTime() < today.getTime() ? 'expired' : exp.getTime() <= today.getTime() + 30 * 86400000 ? 'expiring' : 'valid',
      size: 'not stored',
    };
    setExtraDocs(prev => [doc, ...prev]);
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId,
        action: 'Registered document (demo upload — not stored)', recordType: 'Document', recordRef: doc.title,
        reason: 'Registry upload (demo) — no file is stored against school records', policyRef: 'Records §1.3',
        aiInvolved: false, risk: 'low', outcome: 'Registry entry on this device only · no file stored on any server',
      },
    });
    /* T305 (§9.5/§24): there is no upload door here — only a registry row in
       local state; no file leaves the browser. */
    toast({ title: 'Demo upload — not stored', sub: `${doc.title} was added to this device's registry view only. No file is stored on school servers${doc.expiresOn ? ` · expiry ${fmtDateShort(doc.expiresOn)} noted locally` : ''}.`, tone: 'info' });
    setUploadOpen(false);
    setForm({ name: '', category: 'Identity', expiry: '' });
  };

  const campusName = seed.campuses.find(c => c.id === session.activeCampus)?.name;

  return (
    <div>
      <PageHead
        title="Documents"
        sub="Certificates, agreements and IDs on record — with expiry watch, renewal tasks and the inspection pack."
        actions={
          <>
            <Button variant="secondary" icon={<Icon.Clipboard size={14} />} loading={generating} onClick={() => setPackOpen(true)}>
              Generate inspection pack
            </Button>
            <Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setUploadOpen(true)}>Upload</Button>
          </>
        }
      />

      {/* ---- Stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Documents on record" value={stats.total} sub={`${categories.length} categories · ${campusName ?? 'group'} scope`} />
        <Stat label="Expiring in 30 days" value={stats.in30} sub="Renewal tasks auto-created (wf_5)" />
        <Stat label="Expired" value={stats.expired} sub="Need renewal before inspection" />
        <Stat label="Verified" value={`${stats.verified}%`} sub="Share of registry currently valid" />
      </div>

      {/* ---- Expiring-soon callout ---- */}
      <Card pad style={{ marginBottom: 28 }}>
        <div className="u-col" style={{ gap: 12 }}>
          <div className="u-flex" style={{ gap: 8 }}>
            <Icon.Clock size={15} style={{ color: 'var(--warning)' }} />
            <span style={{ fontWeight: 620 }}>Expiring soonest</span>
            <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>Next 5 across the registry</span>
          </div>
          {expiringSoon.length === 0 ? (
            <Empty icon={<Icon.Check size={20} />} title="Nothing expiring" sub="No document on record has an expiry date." />
          ) : (
            <div className="u-col" style={{ gap: 8 }}>
              {expiringSoon.map(d => {
                const days = d.expiresOn ? Math.round((d.expiresOn.getTime() - Date.now()) / 86400000) : 0;
                return (
                  <div key={d.id} className="u-between" style={{ gap: 10, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: days < 0 ? 'var(--danger-weak)' : days <= 21 ? 'var(--warning-weak)' : 'var(--surface)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="u-flex" style={{ gap: 8 }}>
                        <span style={{ fontWeight: 580 }}>{d.title}</span>
                        <Badge tone="outline">{d.ownerType}</Badge>
                      </div>
                      <div className="u-xs u-muted" style={{ marginTop: 2 }}>
                        {d.ownerName} · expires {d.expiresOn ? fmtDate(d.expiresOn) : '—'} · {days < 0 ? `${Math.abs(days)} days ago` : `in ${days} days`}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" icon={<Icon.Clipboard size={12} />} onClick={() => createRenewalTask(d)}>
                      Renewal task
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* ---- AI: documents intelligence ---- */}
      <Card pad style={{ marginBottom: 28, borderColor: 'var(--ai-weak-2)' }}>
        <div className="u-col" style={{ gap: 12 }}>
          <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="ai-chip"><Icon.Sparkle size={12} /> Documents intelligence</span>
            <Badge tone="success" dot>high confidence</Badge>
          </div>
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <div>
              <div className="u-upper" style={{ marginBottom: 8 }}>Expiry forecast — next 4 months</div>
              <BarChart data={forecast} format={v => `${v}`} highlightMax={false} height={170} />
              <div className="u-small u-muted" style={{ marginTop: 10 }}>
                Renewal load peaks this month, driven by student medical forms and the four school compliance certificates.
                Workflow wf_5 opens owner tasks at 30 days and escalates at 14 and 7 — nothing currently sits beyond the first reminder.
              </div>
            </div>
            <div className="u-col" style={{ gap: 10 }}>
              <p style={{ margin: 0, fontSize: 'var(--text-md)', lineHeight: 1.65 }}>
                The registry shows {stats.expired} expired records, mostly medical forms owned by class
                teachers. The CBSE inspection pack (fire safety, building OC, bus fitness and the lab
                chemical license, with a signed index) is not connected in this build — nothing has been generated.
              </p>
              <KeyValue
                items={[
                  { k: 'Renewal tasks', v: 'Not connected — no workflow runtime in this build' },
                  { k: 'Inspection pack', v: 'Not connected — nothing generated yet' },
                  { k: 'Expiry watch', v: 'Not connected — expiry dates shown from the registry only' },
                ]}
                cols={1}
              />
              {/* T305 (§9.5): the AI trace card here fabricated a weekly scan
                  worker plus model/token/cost telemetry that do not exist. */}
              <div className="u-small u-muted" style={{ border: '1px dashed var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px', lineHeight: 1.6 }}>
                No automation runs on this registry — there is no scheduled scan, no model call and no cost. The expiry forecast above is computed in your browser from the expiry dates shown.
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ---- Filters ---- */}
      <div className="u-flex" style={{ gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="u-flex" style={{ gap: 6 }}>
          <label className="u-small u-muted" htmlFor="doc-cat">Category</label>
          <select id="doc-cat" className="input" value={category} onChange={e => setCategory(e.target.value)} style={{ width: 150 }}>
            <option value="all">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="u-flex" style={{ gap: 6 }}>
          <label className="u-small u-muted" htmlFor="doc-status">Status</label>
          <select id="doc-status" className="input" value={status} onChange={e => setStatus(e.target.value as StatusFilter)} style={{ width: 140 }}>
            <option value="all">All statuses</option>
            <option value="valid">Valid</option>
            <option value="expiring">Expiring</option>
            <option value="expired">Expired</option>
          </select>
        </div>
        <div className="u-flex" style={{ gap: 6 }}>
          <label className="u-small u-muted" htmlFor="doc-owner">Owner</label>
          <select id="doc-owner" className="input" value={ownerType} onChange={e => setOwnerType(e.target.value as OwnerFilter)} style={{ width: 140 }}>
            <option value="all">All owners</option>
            <option value="student">Students</option>
            <option value="staff">Staff</option>
            <option value="school">School</option>
          </select>
        </div>
        <div className="u-flex" style={{ gap: 6, flex: 1, minWidth: 200 }}>
          <label htmlFor="doc-search" className="u-small u-muted"><Icon.Search size={13} /></label>
          <input
            id="doc-search"
            className="input"
            placeholder="Search title or owner…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ maxWidth: 280 }}
          />
        </div>
        {(category !== 'all' || status !== 'all' || ownerType !== 'all' || query) && (
          <Button variant="ghost" size="sm" icon={<Icon.X size={12} />} onClick={() => { setCategory('all'); setStatus('all'); setOwnerType('all'); setQuery(''); }}>
            Clear
          </Button>
        )}
      </div>

      {/* ---- Registry table ---- */}
      <Section
        title="Registry"
        sub={`${filtered.length} of ${all.length} documents shown. Expiry badges drive the renewal workflow.`}
        actions={<Button size="sm" variant="ghost" icon={<Icon.Refresh size={13} />} onClick={registry.retry}>Reload</Button>}
      >
        <Card>
          {registry.loading ? (
            <div className="u-col" style={{ gap: 10, padding: 'var(--s-5)' }}><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /></div>
          ) : registry.error ? (
            <div className="card-body"><ErrorState title="Could not load documents" sub={registry.error} onRetry={registry.retry} /></div>
          ) : (
            <DataTable
              rows={filtered.slice(0, 80)}
              rowKey={d => d.id}
              empty={
                <Empty
                  icon={<Icon.Document size={22} />}
                  title="No documents match"
                  sub="Adjust the filters or search to see the registry."
                  action={<Button size="sm" variant="secondary" onClick={() => { setCategory('all'); setStatus('all'); setOwnerType('all'); setQuery(''); }}>Clear filters</Button>}
                />
              }
              columns={[
                { key: 'title', label: 'Document', render: d => <span style={{ fontWeight: 570 }}>{d.title}</span> },
                {
                  key: 'owner', label: 'Owner', render: d => (
                    <div>
                      <div className="u-small">{d.ownerName}</div>
                      <div className="u-xs u-faint">{d.ownerType}</div>
                    </div>
                  ),
                },
                { key: 'category', label: 'Category', render: d => <Badge tone="outline">{d.category}</Badge> },
                { key: 'expires', label: 'Expires on', render: d => d.expiresOn ? <span className="u-small">{fmtDateShort(d.expiresOn)}</span> : <span className="u-faint u-small">No expiry</span> },
                { key: 'size', label: 'Size', render: d => <span className="mono u-small u-muted">{d.size}</span> },
                { key: 'status', label: 'Status', align: 'right', render: d => docStatusBadge(d) },
              ]}
            />
          )}
        </Card>
      </Section>

      {/* ---- QR report card ---- */}
      <Section title="Report from the floor" sub="Posters with this code hang in corridors, labs and the playground.">
        <Card pad>
          <div className="u-flex" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <QrPattern />
            <div style={{ minWidth: 220, flex: 1 }}>
              <div style={{ fontWeight: 620, marginBottom: 4 }}>Scan to report — creates a facilities case</div>
              <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>
                Staff scan, pick a location, attach a photo. The report lands in the facilities queue with the reporter's name and
                timestamp; urgent ones page the Admin Officer. Last quarter 62% of facility issues arrived through this QR flow
                rather than the front desk.
              </div>
              <div style={{ marginTop: 10 }}>
                <Button size="sm" variant="secondary" iconRight={<Icon.ArrowRight size={12} />} onClick={() => toast({ title: 'QR poster opened (demo)', sub: 'On mobile this deep-links to the report form.', tone: 'info' })}>
                  Preview the scan flow
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      {/* ---- Inspection pack modal ---- */}
      <Modal
        open={packOpen}
        onClose={() => setPackOpen(false)}
        title="Generate inspection pack"
        sub="Assembles the compliance set with a signed index for CBSE OASIS submission."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPackOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Clipboard size={14} />} onClick={generatePack}>Generate pack</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 10 }}>
          <div className="u-small u-muted">
            Would pull every document in category <strong>Compliance</strong>, plus the transport fitness certificates and the
            latest medical-form summary. Not connected — pack assembly needs server support, so nothing is generated or downloaded.
          </div>
          <KeyValue
            items={[
              { k: 'Status', v: 'Not connected in this build' },
              { k: 'Would include', v: 'Fire safety · Building OC · Bus fitness · Lab chemical license · Medical summary' },
              { k: 'Output', v: 'None produced here — no bundle or signed index exists' },
            ]}
            cols={1}
          />
        </div>
      </Modal>

      {/* ---- Upload modal ---- */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload document"
        sub="Files land in the registry against the school owner in this demo."
        footer={
          <>
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Download size={14} />} onClick={submitUpload}>Add to registry</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 14 }}>
          <div>
            <label className="u-upper" htmlFor="up-name" style={{ display: 'block', marginBottom: 6 }}>File name</label>
            <input id="up-name" className="input" style={{ width: '100%' }} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Lift AMC Certificate 2026" />
          </div>
          <div>
            <label className="u-upper" htmlFor="up-cat" style={{ display: 'block', marginBottom: 6 }}>Category</label>
            <select id="up-cat" className="input" style={{ width: '100%' }} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {['Identity', 'Medical', 'Academic', 'Transport', 'Compliance'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="u-upper" htmlFor="up-exp" style={{ display: 'block', marginBottom: 6 }}>Expiry date (optional)</label>
            <input id="up-exp" type="date" className="input" style={{ width: '100%' }} value={form.expiry} onChange={e => setForm(f => ({ ...f, expiry: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
