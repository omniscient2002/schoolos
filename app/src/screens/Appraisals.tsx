/* ============================================================
   Appraisals — OPP-PRD-11. The principal's staff-appraisal register:
   one row per staff member per cycle, with a rating, strengths and
   improvements, saved to GET/POST /staff/appraisals and audited.
   ============================================================ */
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { Badge, Button, Card, Empty, ErrorState, Modal, PageHead, Section, SkeletonCard, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate } from '../lib/format';

interface Appraisal { id: string; staff_user_id: string; staff_name: string; staff_role: string; cycle: string; rating: number | null; strengths: string | null; improvements: string | null; status: string; updated_at: string }
interface Staff { id: string; name: string; role: string }

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success'> = { draft: 'neutral', shared: 'info', acknowledged: 'success' };

export default function Appraisals() {
  const toast = useToast();
  const [rows, setRows] = useState<Appraisal[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState('2026-27 T1');
  const [edit, setEdit] = useState<{ staffUserId: string; staffName: string; rating: number; strengths: string; improvements: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    apiGet<{ appraisals: Appraisal[]; staff: Staff[] }>(`/staff/appraisals?cycle=${encodeURIComponent(cycle)}`)
      .then(r => { setRows(r.appraisals ?? []); setStaff(r.staff ?? []); setError(null); })
      .catch(e => { setRows(null); setError(String(e)); });
  };
  useEffect(load, [cycle]);

  const openEdit = (s: Staff, existing?: Appraisal) => setEdit({
    staffUserId: s.id, staffName: s.name,
    rating: existing?.rating ?? 3, strengths: existing?.strengths ?? '', improvements: existing?.improvements ?? '', status: existing?.status ?? 'draft',
  });

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await apiPost('/staff/appraisals', { staffUserId: edit.staffUserId, cycle, rating: edit.rating, strengths: edit.strengths, improvements: edit.improvements, status: edit.status });
      toast({ title: 'Appraisal saved', tone: 'success' });
      setEdit(null);
      load();
    } catch (e) {
      toast({ title: 'Could not save the appraisal', sub: friendly(e), tone: 'error' });
    } finally { setBusy(false); }
  };

  const byStaff = new Map((rows ?? []).map(r => [r.staff_user_id, r]));

  return (
    <>
      <PageHead
        title="Staff appraisals"
        sub="One appraisal per staff member per cycle — rating, strengths and improvements, saved and audited."
        actions={
          <label className="u-small">Cycle
            <input className="input" value={cycle} onChange={e => setCycle(e.target.value)} style={{ marginLeft: 8, width: 140 }} />
          </label>
        }
      />
      <Section title={`Appraisals · ${cycle}`} sub="Edit a row to record the review; saving writes an audit entry.">
        {rows === null && !error ? <SkeletonCard lines={5} />
          : error ? <ErrorState title="Could not load appraisals" sub={friendly(error)} onRetry={load} />
          : staff.length === 0 ? <Empty icon={<Icon.Users size={22} />} title="No staff to appraise" sub="Staff appear here once the roster is populated." />
          : (
            <Card>
              <div className="u-col" style={{ gap: 10 }}>
                {staff.map(s => {
                  const a = byStaff.get(s.id);
                  return (
                    <div key={s.id} className="u-between u-wrap" style={{ gap: 10, alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 580 }}>{s.name}</span>
                          <Badge tone="outline">{s.role}</Badge>
                          {a ? <Badge tone={STATUS_TONE[a.status] ?? 'neutral'} dot>{a.status}</Badge> : <span className="u-xs u-faint">not appraised</span>}
                          {a?.rating != null && <span className="u-small u-muted">Rating {a.rating}/5</span>}
                        </div>
                        {a?.updated_at && <div className="u-xs u-faint">updated {fmtDate(new Date(a.updated_at))}</div>}
                      </div>
                      <Button size="sm" variant="secondary" icon={<Icon.Edit size={12} />} onClick={() => openEdit(s, a)}>{a ? 'Edit' : 'Appraise'}</Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
      </Section>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? `Appraise ${edit.staffName}` : 'Appraisal'}
        sub={`Cycle ${cycle}`}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save appraisal</Button></>}
      >
        {edit && (
          <div className="u-col" style={{ gap: 12 }}>
            <label className="u-small">Rating (1–5)
              <input className="input" type="number" min={1} max={5} value={edit.rating} onChange={e => setEdit(v => v && ({ ...v, rating: Number(e.target.value) }))} style={{ width: '100%', marginTop: 5 }} />
            </label>
            <label className="u-small">Strengths
              <textarea className="textarea" rows={3} value={edit.strengths} onChange={e => setEdit(v => v && ({ ...v, strengths: e.target.value }))} style={{ marginTop: 5 }} />
            </label>
            <label className="u-small">Improvements
              <textarea className="textarea" rows={3} value={edit.improvements} onChange={e => setEdit(v => v && ({ ...v, improvements: e.target.value }))} style={{ marginTop: 5 }} />
            </label>
            <label className="u-small">Status
              <select className="select" value={edit.status} onChange={e => setEdit(v => v && ({ ...v, status: e.target.value }))} style={{ width: '100%', marginTop: 5 }}>
                <option value="draft">Draft</option>
                <option value="shared">Shared with staff</option>
                <option value="acknowledged">Acknowledged</option>
              </select>
            </label>
          </div>
        )}
      </Modal>
    </>
  );
}
