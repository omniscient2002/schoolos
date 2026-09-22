/* ============================================================
   Announcements — OPP-PRD-3. The announcement composer: write once,
   pick an audience, approve, and see the true reach. Live doors
   GET/POST /announcements + /:id/approve. In-app is delivered as
   notifications; outbound channels are QUEUED (never claimed sent).
   ============================================================ */
import { useEffect, useState } from 'react';
import { apiAnnouncements, apiCreateAnnouncement, apiApproveAnnouncement, apiAnnouncementReceipts } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Button, DataTable, Empty, ErrorState, Section, SkeletonCard, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

interface Ann { id: string; title: string; body: string; audience_kind: string; audience_ref?: string | null; channel: string; status: string; recipients?: number | null; created_at?: string }
const AUDIENCE: Record<string, string> = { all_guardians: 'All guardians', class: 'A class', route: 'A bus route', staff: 'Staff', custom: 'Custom' };

export default function Announcements() {
  const toast = useToast();
  const [rows, setRows] = useState<Ann[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState({ title: '', body: '', audienceKind: 'all_guardians', audienceRef: '', channel: 'In-app' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    apiAnnouncements().then(r => { if (live) { setRows(r.announcements as unknown as Ann[]); setError(null); } })
      .catch(e => { if (live) { setRows(null); setError(String(e)); } });
    return () => { live = false; };
  }, [tick]);

  const compose = () => {
    if (!form.title || !form.body) { toast({ title: 'Title and message are required', tone: 'error' }); return; }
    setBusy(true);
    apiCreateAnnouncement({ ...form, audienceRef: form.audienceRef || null })
      .then(r => { toast({ title: 'Draft created', sub: `${r.recipients} recipient(s) resolved for this audience.`, tone: 'success' }); setForm({ title: '', body: '', audienceKind: 'all_guardians', audienceRef: '', channel: 'In-app' }); setTick(t => t + 1); })
      .catch(e => toast({ title: 'Could not create the draft', sub: friendly(e), tone: 'error' }))
      .finally(() => setBusy(false));
  };
  const list = rows ?? [];
  const approve = (id: string) => {
    apiApproveAnnouncement(id)
      .then(r => { toast({ title: r.announcement.status === 'queued' ? 'Approved and queued' : 'Approved', sub: 'Delivery is recorded honestly by the dispatcher.', tone: 'success' }); setTick(t => t + 1); })
      .catch(e => toast({ title: 'Could not approve', sub: friendly(e), tone: 'error' }));
  };
  const showReceipts = (id: string) => {
    apiAnnouncementReceipts(id)
      .then(r => toast({ title: `${r.total} receipt(s)`, sub: r.receipts.map(x => `${x.n} ${x.status}`).join(' · ') || 'No receipts recorded yet', tone: 'success' }))
      .catch(e => toast({ title: 'Could not load receipts', sub: friendly(e), tone: 'error' }));
  };

  return (
    <>
      <PageHead title="Announcements" sub="Write once, choose the audience, approve, and see exactly who it reached." />

      <Section title="New announcement" style={{ marginBottom: 4 }}>
        <Card pad>
          <div className="u-col u-gap-2">
            <input className="input" placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <textarea className="input" placeholder="Message body" rows={3} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
            <div className="u-flex u-gap-2 u-wrap">
              <label className="u-small">Audience
                <select className="select" value={form.audienceKind} onChange={e => setForm(f => ({ ...f, audienceKind: e.target.value }))}>
                  {Object.entries(AUDIENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              {(form.audienceKind === 'class' || form.audienceKind === 'route') && (
                <label className="u-small">{form.audienceKind === 'class' ? 'Grade' : 'Route code'}
                  <input className="input" value={form.audienceRef} onChange={e => setForm(f => ({ ...f, audienceRef: e.target.value }))} placeholder={form.audienceKind === 'class' ? '8' : 'R-12'} />
                </label>
              )}
              <label className="u-small">Channel
                <select className="select" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
                  <option>In-app</option>
                  <option>WhatsApp</option>
                  <option>SMS</option>
                  <option>Email</option>
                </select>
              </label>
              <Button variant="primary" disabled={busy} onClick={compose} style={{ alignSelf: 'flex-end' }}>Create draft</Button>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Sent & drafts">
        {rows == null && !error ? <SkeletonCard lines={4} />
          : error ? <ErrorState title="Could not load announcements" sub={friendly(error)} onRetry={() => setTick(t => t + 1)} />
          : list.length === 0 ? <Empty icon={<Icon.Message size={24} />} title="No announcements yet" sub="Compose one above." />
          : (
            <DataTable<Ann>
              columns={[
                { key: 'title', label: 'Announcement', render: r => <div><div style={{ fontWeight: 570 }}>{r.title}</div><div className="u-xs u-faint u-truncate" style={{ maxWidth: 340 }}>{r.body}</div></div> },
                { key: 'audience', label: 'Audience', render: r => <span className="u-small">{AUDIENCE[r.audience_kind] ?? r.audience_kind}{r.audience_ref ? ` · ${r.audience_ref}` : ''}</span> },
                { key: 'channel', label: 'Channel', render: r => <Badge tone="outline">{r.channel}</Badge> },
                { key: 'status', label: 'Status', render: r => <Badge tone={r.status === 'queued' || r.status === 'sent' ? 'success' : 'outline'} dot>{r.status}</Badge> },
                { key: 'act', label: '', render: r => r.status === 'draft' ? <Button size="sm" variant="secondary" onClick={() => approve(r.id)}>Approve</Button> : (
                  <span className="u-flex" style={{ gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                    <span className="u-xs u-faint">{r.recipients ?? 0} recipient(s)</span>
                    <Button size="sm" variant="ghost" onClick={() => showReceipts(r.id)}>Receipts</Button>
                  </span>
                ) },
              ]}
              rows={list}
              rowKey={r => r.id}
            />
          )}
      </Section>
    </>
  );
}
