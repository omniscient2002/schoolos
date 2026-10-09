/* ============================================================
   MPD center — the mandatory public disclosure desk.

   What this proves: every disclosure an inspection can ask for,
   with its current state (on file, expiring, missing) — so the
   visit finds the file, not a scramble.

   Doors: GET /compliance/mpd (all), POST /compliance/mpd/docs
   (owner/principal/itadmin), POST /compliance/mpd/docs/:id/retire.
   Coordinator reads; only owner/principal/itadmin file or retire.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, DataTable, Empty, ErrorState, Modal, PageHead, Section, SkeletonCard, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useRoleOrGrant } from '../lib/access';
import { friendly } from '../lib/friendlyErrors';
import { fmtDate } from '../lib/format';
import { mpdAddDoc, mpdOverview, mpdRetireDoc, meetingsList, meetingsAdd, type MpdChecklistItem, type MpdDoc, type Mtg } from '../services/complianceApi';

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

const statusTone = (s: string): 'success' | 'warning' | 'danger' =>
  s === 'ok' ? 'success' : s === 'expiring' ? 'warning' : 'danger';

export default function MpdCenter() {
  const toast = useToast();
  const canRead = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator'], ['GET /compliance/mpd']);
  const canWrite = useRoleOrGrant(['owner', 'principal', 'itadmin'], ['POST /compliance/mpd/docs']);

  const mpd = useAsync(() => mpdOverview(), []);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: '', expires_on: '' });

  /* PTA/SMC minutes: the paper behind the SMC/PTA checklist rows and fee-hike consultations. */
  const mtgs = useAsync(() => meetingsList(), []);
  const [mtgOpen, setMtgOpen] = useState(false);
  const [mtgBusy, setMtgBusy] = useState(false);
  const [mtgForm, setMtgForm] = useState({ kind: 'PTA', heldOn: '', minutes: '', attendees: '' });
  const addMeeting = async () => {
    if (!mtgForm.heldOn || mtgForm.minutes.trim().length < 10) { toast({ title: 'Date and real minutes are needed', sub: 'Decisions, not placeholders (10+ characters).', tone: 'info' }); return; }
    setMtgBusy(true);
    try {
      await meetingsAdd({ kind: mtgForm.kind, heldOn: mtgForm.heldOn, minutes: mtgForm.minutes.trim(), attendees: mtgForm.attendees.split(',').map(s => s.trim()).filter(Boolean) });
      toast({ title: `${mtgForm.kind} minutes recorded`, tone: 'success' });
      setMtgForm({ kind: 'PTA', heldOn: '', minutes: '', attendees: '' });
      setMtgOpen(false);
      mtgs.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setMtgBusy(false); }
  };

  if (!canRead) {
    return (
      <Card>
        <Empty icon={<Icon.Shield size={24} />} title="Disclosure files are not for your role"
          sub="Mandatory public disclosure is the owner, principal, IT admin and coordinator desk." />
      </Card>
    );
  }

  const checklist = mpd.data?.checklist ?? [];
  const docs = mpd.data?.docs ?? [];
  const ok = checklist.filter(c => c.status === 'ok').length;
  const attention = checklist.filter(c => c.status !== 'ok').length;

  const add = async () => {
    if (!form.name.trim()) { toast({ title: 'Name the document', tone: 'info' }); return; }
    if (!form.kind.trim()) { toast({ title: 'Say what kind it is', sub: 'e.g. affiliation letter, fire certificate, fee schedule.', tone: 'info' }); return; }
    setBusy(true);
    try {
      const r = await mpdAddDoc({
        name: form.name.trim(), kind: form.kind.trim(),
        ...(form.expires_on ? { expires_on: form.expires_on } : {}),
      });
      toast({ title: 'Document filed', sub: `${r.doc.name} is on record.`, tone: 'success' });
      setForm({ name: '', kind: '', expires_on: '' });
      setAddOpen(false);
      mpd.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const retire = async (d: MpdDoc) => {
    if (!window.confirm(`Retire “${d.name}”? It leaves the record but no longer counts as current.`)) return;
    setRetiring(d.id);
    try {
      await mpdRetireDoc(d.id);
      toast({ title: 'Document retired', sub: `${d.name} no longer counts as current.`, tone: 'success' });
      mpd.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setRetiring(null); }
  };

  return (
    <div>
      <PageHead
        title="MPD — mandatory public disclosure"
        sub="What this proves: every disclosure an inspection can ask for, with its current state — so the visit finds the file, not a scramble."
        actions={canWrite ? (
          <Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setAddOpen(true)}>File a document</Button>
        ) : undefined}
      />

      {mpd.loading ? (
        <div className="grid grid-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : mpd.error ? (
        <ErrorState title="Could not read the disclosure desk" sub={friendly(mpd.error)} onRetry={mpd.retry} />
      ) : (
        <>
          <div className="grid grid-4" style={{ marginBottom: 20 }}>
            <Stat label="Checklist items" value={checklist.length} sub="Disclosures the school must publish" />
            <Stat label="On file" value={ok} sub="Current and valid" />
            <Stat label="Needs attention" value={attention} sub="Missing or expiring" />
            <Stat label="Documents filed" value={docs.length} sub="Evidence on record" />
          </div>

          <Section title="Disclosure checklist" sub="Each item the school must publish, and whether it is currently covered.">
            <Card pad={false}>
              <DataTable<MpdChecklistItem>
                columns={[
                  { key: 'item', label: 'Disclosure', render: c => (
                    <span><span style={{ fontWeight: 570 }}>{c.label}</span>
                    {c.detail && <span className="u-small u-muted" style={{ display: 'block' }}>{c.detail}</span>}</span>
                  ) },
                  { key: 'status', label: 'State', width: 130, render: c => <Badge tone={statusTone(c.status)}>{c.status}</Badge> },
                  { key: 'ref', label: 'Reference', width: 150, emptyCell: 'blank', render: c => c.href ? (
                    <a href={c.href} target="_blank" rel="noreferrer" className="u-small link-action">Open the file</a>
                  ) : null },
                ]}
                rows={checklist}
                rowKey={c => c.id}
                empty={<Empty title="No checklist yet" sub="The disclosure checklist appears here once the school's compliance profile names what must be published." />}
              />
            </Card>
          </Section>

          <Section title="Filed documents" sub="Evidence on record. Retiring never deletes — the file stays in history but stops counting as current.">
            <Card pad={false}>
              <DataTable<MpdDoc>
                columns={[
                  { key: 'name', label: 'Document', render: d => <span style={{ fontWeight: 570 }}>{d.name}</span> },
                  { key: 'kind', label: 'Kind', render: d => <span className="u-small u-muted">{d.kind}</span> },
                  { key: 'expires', label: 'Valid until', width: 140, render: d => (
                    <span className="u-small">{d.expires_on ? fmtDate(d.expires_on) : <span className="u-faint">—</span>}</span>
                  ) },
                  { key: 'status', label: 'State', width: 120, render: d => d.status ? <Badge tone={statusTone(d.status)}>{d.status}</Badge> : <span className="u-faint">—</span> },
                  ...(canWrite ? [{
                    key: 'act', label: '', width: 110, render: (d: MpdDoc) => (
                      <Button size="sm" variant="ghost" disabled={retiring === d.id} onClick={() => { void retire(d); }}>
                        {retiring === d.id ? '…' : 'Retire'}
                      </Button>
                    ),
                  }] : []),
                ]}
                rows={docs}
                rowKey={d => d.id}
                empty={<Empty title="No disclosure documents on record yet"
                  sub="File the first one — the affiliation letter, the fire certificate, the fee schedule — and it appears here with its validity." />}
              />
            </Card>
            {mpd.data?.disclosure?.url && (
              <div className="u-xs u-faint" style={{ marginTop: 10 }}>
                Public disclosure page: <a href={mpd.data.disclosure.url} target="_blank" rel="noreferrer" className="link-action">{mpd.data.disclosure.url}</a>
                {mpd.data.disclosure.updatedAt && <> · updated {fmtDate(mpd.data.disclosure.updatedAt)}</>}
              </div>
            )}
          </Section>

          <Section title="PTA / SMC meetings" sub="Minutes are the paper behind the committee lists — and behind every fee consultation.">
            {canWrite && (
              <div style={{ marginBottom: 12 }}>
                <Button variant="secondary" icon={<Icon.Plus size={14} />} onClick={() => setMtgOpen(true)}>Record minutes</Button>
              </div>
            )}
            {mtgs.loading ? <SkeletonCard />
              : mtgs.error ? <ErrorState title="Could not read meetings" sub={friendly(mtgs.error)} onRetry={mtgs.retry} />
              : (mtgs.data?.meetings ?? []).length === 0 ? (
                <Empty title="No meetings minuted yet" sub="Record the first PTA or SMC meeting — date, minutes, who was there." />
              ) : (
                <Card pad={false}>
                  <DataTable<Mtg>
                    columns={[
                      { key: 'kind', label: '', width: 70, render: m => <Badge tone={m.kind === 'SMC' ? 'accent' : 'outline'}>{m.kind}</Badge> },
                      { key: 'held', label: 'Held', width: 130, render: m => <span className="u-small">{fmtDate(m.held_on)}</span> },
                      { key: 'minutes', label: 'Minutes', render: m => <span className="u-small" style={{ display: 'block', maxWidth: 520, whiteSpace: 'pre-wrap' }}>{m.minutes}</span> },
                      { key: 'who', label: 'There', render: m => <span className="u-xs u-faint">{(m.attendees ?? []).join(', ') || '—'}</span> },
                    ]}
                    rows={mtgs.data?.meetings ?? []}
                    rowKey={m => m.id}
                  />
                </Card>
              )}
          </Section>
        </>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="File a disclosure document"
        sub="Recorded with your name. An expiry date lets the checklist warn before it lapses."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" disabled={busy || !form.name.trim() || !form.kind.trim()} onClick={add}>
              {busy ? 'Filing…' : 'File it'}
            </Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div>
            <label className="u-xs" htmlFor="mpd-name">Document name</label>
            <input id="mpd-name" className="input" style={{ width: '100%', marginTop: 5 }} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Fire safety certificate 2026-27" />
          </div>
          <div>
            <label className="u-xs" htmlFor="mpd-kind">Kind</label>
            <input id="mpd-kind" className="input" style={{ width: '100%', marginTop: 5 }} value={form.kind}
              onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} placeholder="e.g. fire certificate" />
          </div>
          <div>
            <label className="u-xs" htmlFor="mpd-exp">Valid until (optional)</label>
            <input id="mpd-exp" className="input" type="date" style={{ width: '100%', marginTop: 5 }} value={form.expires_on}
              onChange={e => setForm(f => ({ ...f, expires_on: e.target.value }))} />
          </div>
        </div>
      </Modal>
      <Modal
        open={mtgOpen}
        onClose={() => setMtgOpen(false)}
        title="Record meeting minutes"
        sub="PTA and SMC minutes are the paper behind committee lists and fee consultations."
        footer={
          <>
            <Button variant="ghost" onClick={() => setMtgOpen(false)} disabled={mtgBusy}>Cancel</Button>
            <Button variant="primary" disabled={mtgBusy || !mtgForm.heldOn || mtgForm.minutes.trim().length < 10} onClick={addMeeting}>
              {mtgBusy ? 'Recording…' : 'Record it'}
            </Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div>
            <label className="u-xs" htmlFor="mtg-kind">Meeting</label>
            <select id="mtg-kind" className="input" style={{ width: '100%', marginTop: 5 }} value={mtgForm.kind}
              onChange={e => setMtgForm(f => ({ ...f, kind: e.target.value }))}>
              <option value="PTA">PTA</option>
              <option value="SMC">SMC</option>
            </select>
          </div>
          <div>
            <label className="u-xs" htmlFor="mtg-date">Held on</label>
            <input id="mtg-date" className="input" type="date" style={{ width: '100%', marginTop: 5 }} value={mtgForm.heldOn}
              onChange={e => setMtgForm(f => ({ ...f, heldOn: e.target.value }))} />
          </div>
          <div>
            <label className="u-xs" htmlFor="mtg-min">Minutes (decisions, not placeholders)</label>
            <textarea id="mtg-min" className="input" rows={4} style={{ width: '100%', marginTop: 5 }} value={mtgForm.minutes}
              onChange={e => setMtgForm(f => ({ ...f, minutes: e.target.value }))} placeholder="e.g. Approved the term fee schedule with no hike…" />
          </div>
          <div>
            <label className="u-xs" htmlFor="mtg-who">Who was there (comma-separated)</label>
            <input id="mtg-who" className="input" style={{ width: '100%', marginTop: 5 }} value={mtgForm.attendees}
              onChange={e => setMtgForm(f => ({ ...f, attendees: e.target.value }))} placeholder="e.g. Meera Deshpande, Rao" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
