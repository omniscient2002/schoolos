/* ============================================================
   Certificates — OPP-PRD-7. TC / bonafide / character certificates.
   Request raises a principal-owned signing action; the principal
   signs (POST /certificates/:id/sign). Live doors only.
   ============================================================ */
import { useEffect, useState } from 'react';
import { apiCertificates, apiRequestCertificate, apiSignCertificate, apiCertificateArtifact, apiStudents } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Button, DataTable, Empty, ErrorState, Section, SkeletonCard, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

interface Cert { id: string; kind: string; student_id: string; serial: string; status: string; action_id?: string | null; signed_at?: string | null }
interface Student { id: string; name: string; grade?: string; section?: string }
const KIND: Record<string, string> = { transfer: 'Transfer certificate', bonafide: 'Bonafide', character: 'Character', study: 'Study', other: 'Other' };

export default function Certificates() {
  const toast = useToast();
  const [rows, setRows] = useState<Cert[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState({ kind: 'bonafide', studentId: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    apiCertificates().then(r => { if (live) { setRows(r.certificates as unknown as Cert[]); setError(null); } })
      .catch(e => { if (live) { setRows(null); setError(String(e)); } });
    apiStudents().then(r => { if (live) setStudents((r.students as unknown as Student[]) ?? []); }).catch(() => {});
    return () => { live = false; };
  }, [tick]);

  const request = () => {
    if (!form.studentId) { toast({ title: 'Pick a student', tone: 'error' }); return; }
    setBusy(true);
    apiRequestCertificate(form)
      .then(() => { toast({ title: 'Certificate requested', sub: 'A principal-owned signing action was raised.', tone: 'success' }); setForm({ kind: 'bonafide', studentId: '' }); setTick(t => t + 1); })
      .catch(e => toast({ title: 'Could not request', sub: friendly(e), tone: 'error' }))
      .finally(() => setBusy(false));
  };
  const sign = (id: string) => {
    apiSignCertificate(id)
      .then(() => { toast({ title: 'Signed and issued', tone: 'success' }); setTick(t => t + 1); })
      .catch(e => toast({ title: 'Could not sign', sub: friendly(e), tone: 'error' }));
  };
  const artifact = (id: string) => {
    apiCertificateArtifact(id)
      .then(r => toast({ title: 'Artifact generated', sub: `${r.artifact.filename} · sha256 ${r.artifact.sha256.slice(0, 12)}…`, tone: 'success' }))
      .catch(e => toast({ title: 'No artifact yet', sub: friendly(e), tone: 'error' }));
  };

  const list = rows ?? [];
  const studentName = (id: string) => students.find(s => s.id === id)?.name ?? id.slice(0, 8);

  return (
    <>
      <PageHead title="Certificates" sub="Transfer, bonafide and character certificates — requested at the desk, signed by the principal." />

      <Section title="Request a certificate" style={{ marginBottom: 4 }}>
        <Card pad>
          <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
            <label className="u-small">Kind
              <select className="select" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} style={{ width: 200 }}>
                {Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="u-small" style={{ flex: 1, minWidth: 220 }}>Student
              <select className="select" value={form.studentId} onChange={e => setForm(f => ({ ...f, studentId: e.target.value }))} style={{ width: '100%' }}>
                <option value="">Select a student…</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` · ${s.grade}-${s.section ?? ''}` : ''}</option>)}
              </select>
            </label>
            <Button variant="primary" disabled={busy} onClick={request}>Request</Button>
          </div>
        </Card>
      </Section>

      <Section title="Certificates">
        {rows == null && !error ? <SkeletonCard lines={4} />
          : error ? <ErrorState title="Could not load certificates" sub={friendly(error)} onRetry={() => setTick(t => t + 1)} />
          : list.length === 0 ? <Empty icon={<Icon.File size={24} />} title="No certificates yet" sub="Request one above; the principal signs it." />
          : (
            <DataTable<Cert>
              columns={[
                { key: 'serial', label: 'Serial', render: r => <span className="mono u-small">{r.serial}</span> },
                { key: 'kind', label: 'Kind', render: r => KIND[r.kind] ?? r.kind },
                { key: 'student', label: 'Student', render: r => studentName(r.student_id) },
                { key: 'status', label: 'Status', render: r => <Badge tone={r.status === 'issued' ? 'success' : 'warning'} dot>{r.status}</Badge> },
                { key: 'act', label: '', render: r => r.status === 'pending_approval' ? <Button size="sm" variant="secondary" onClick={() => sign(r.id)}>Sign</Button> : (
                  <span className="u-flex" style={{ gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                    <span className="u-xs u-faint">signed</span>
                    <Button size="sm" variant="ghost" onClick={() => artifact(r.id)}>Artifact</Button>
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
