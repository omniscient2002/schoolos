import { Icon } from '../components/Icon';
import { apiMyCases, apiCreateCase } from '../services/liveApi';
import { statusLabel } from '../lib/labels';
import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';

/* Parent portal — "My complaints": the parent's own view of the concern they raised.
   Server truth: POST /cases (origin=parent) + GET /cases; the board itself stays staff-only. */

type CCase = { id: string; code: string; title: string; detail: string | null; status: string; priority: string; created_at: string; origin?: string; kind?: string };

const STATUS_LABEL: Record<string, string> = {
  open: 'Received — the school will review',
  triaged: 'Being looked into',
  'in-progress': 'Action underway',
  resolved: 'Resolved',
  closed: 'Closed',
};

export default ParentComplaints;
function ParentComplaints() {
  const [rows, setRows] = useState<CCase[] | null>(null);
  const [form, setForm] = useState({ title: '', detail: '', priority: 'high' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    apiMyCases().then(r => setRows((r.cases as unknown as CCase[]).filter(c => c.origin === 'parent' || c.kind === 'complaint'))).catch(e => setErr(String((e as Error).message || e)));
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.title.trim()) { setErr('Please write a short title'); return; }
    setBusy(true); setErr(null);
    try {
      await apiCreateCase({ kind: 'complaint', title: form.title.trim(), detail: form.detail.trim() || undefined, priority: form.priority, origin: 'parent' });
      setMsg('Complaint sent to the school. You can track it here.');
      setForm({ title: '', detail: '', priority: 'high' });
      load();
    } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  return (
    <Page>
      <div className="page-head">
        <div>
          <h1>My complaints</h1>
          <p className="u-muted">Tell the school about anything that worries you about your child. The coordinator sees it and follows up.</p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ marginBottom: 10 }}><Icon.Flag size={15} /> Raise a complaint</h2>
          {msg && <div className="login-error" style={{ marginBottom: 10 }} role="status">{msg}</div>}
          {err && <div className="login-error" style={{ marginBottom: 10 }} role="alert">{err}</div>}
          <label className="u-xs u-muted" htmlFor="pc-title">What happened?</label>
          <input id="pc-title" className="input" style={{ width: '100%' }} value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Short summary — e.g. 'My child was hit by another student'" />
          <label className="u-xs u-muted" htmlFor="pc-detail" style={{ display: 'block', marginTop: 10 }}>Tell us more (optional)</label>
          <textarea id="pc-detail" className="input" style={{ width: '100%', minHeight: 84 }} value={form.detail}
            onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} placeholder="What happened, when, and who was involved" />
          <label className="u-xs u-muted" htmlFor="pc-pri" style={{ display: 'block', marginTop: 10 }}>How serious is it?</label>
          <select id="pc-pri" className="select" style={{ width: '100%' }} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
            <option value="high">Serious — needs quick action</option>
            <option value="critical">Urgent — safety issue</option>
            <option value="normal">Normal</option>
          </select>
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy || !form.title.trim()} onClick={submit}>
            {busy ? 'Sending…' : 'Send complaint to school'}
          </button>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ marginBottom: 10 }}><Icon.Check size={15} /> Your complaints</h2>
          {err && !rows && <div className="u-muted">{err}</div>}
          {rows && rows.length === 0 && <div className="empty"><Icon.Check size={22} /><h3 className="u-muted">No complaints</h3><p className="u-muted">Anything you send will appear here with its status.</p></div>}
          {rows && rows.map(c => (
            <div key={c.id} className="parent-complaint-row" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div className="parent-complaint-title">{c.title}</div>
              <div className="parent-complaint-meta"><span>{STATUS_LABEL[c.status] ?? statusLabel(c.status)}</span><span className="u-faint">{c.code}</span></div>
              {c.detail && <div className="parent-complaint-detail">{c.detail}</div>}
            </div>
          ))}
        </div>
      </div>
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gap: 14 }}>{children}</div>;
}
