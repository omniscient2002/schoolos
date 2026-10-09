/* ============================================================
   BoardPack — OPP-PRD-1. The cross-domain roll-up the owner and
   principal actually need: students, attendance, fees, cases,
   admissions and safety in one view, computed live by
   GET /reports/board-pack. Snapshots are append-only and
   content-hashed (POST /reports/board-pack/snapshot).
   ============================================================ */
import { useEffect, useState } from 'react';
import { apiBoardPack, apiBoardPackSnapshot, apiSnapshots, apiSnapshot } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Button, ErrorState, Section, Stat, SkeletonCard, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtMoney } from '../lib/format';
import { humanize } from '../lib/labels';

interface Pack {
  students?: number;
  attendance_today?: { present: number; absent: number; marked: number };
  fees?: { billed: number; collected: number; outstanding: number; open_obligations: number };
  cases?: { open: number; total: number };
  admissions_open_leads?: number;
  staff_count?: number;
  safety_open?: number;
  as_of?: string;
}

export default function BoardPack() {
  const toast = useToast();
  const [pack, setPack] = useState<Pack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [snaps, setSnaps] = useState<Record<string, unknown>[] | null>(null);
  const [viewing, setViewing] = useState<{ id: string; hash_ok: boolean; created_at?: string } | null>(null);

  const loadSnaps = () => apiSnapshots().then(r => setSnaps(r.snapshots ?? [])).catch(() => setSnaps([]));
  const viewSnap = (id: string) => apiSnapshot(id).then(r => setViewing({ id, hash_ok: r.hash_ok, created_at: String(r.snapshot?.created_at ?? '') })).catch(e => toast({ title: 'Could not load the snapshot', sub: friendly(e), tone: 'error' }));

  useEffect(() => {
    let live = true;
    apiBoardPack().then(r => { if (live) { setPack(r as Pack); setError(null); } })
      .catch(e => { if (live) { setPack(null); setError(String(e)); } });
    return () => { live = false; };
  }, [tick]);

  const snapshot = (kind: 'board_pack' | 'inspection_pack' = 'board_pack') => {
    setBusy(true);
    apiBoardPackSnapshot(kind)
      .then(r => toast({
        title: r.already ? 'That exact snapshot already exists' : (kind === 'inspection_pack' ? 'Inspection pack saved' : 'Board pack snapshot saved'),
        sub: `Security fingerprint ${String(r.content_hash).slice(0, 12)}…`, tone: 'success',
      }))
      .catch(e => toast({ title: 'Could not snapshot', sub: friendly(e), tone: 'error' }))
      .finally(() => setBusy(false));
  };

  const collectionPct = pack?.fees && pack.fees.billed > 0 ? Math.round((pack.fees.collected / pack.fees.billed) * 100) : null;

  return (
    <>
      <PageHead
        title="Board pack"
        sub={pack?.as_of ? `Live roll-up across every desk · as of ${new Date(pack.as_of).toLocaleString()}` : 'Live roll-up across every desk.'}
        actions={
          <>
            <Button variant="secondary" icon={<Icon.Clipboard size={14} />} disabled={busy || !pack} onClick={() => snapshot('inspection_pack')}>Save inspection pack</Button>
            <Button variant="secondary" icon={<Icon.Download size={14} />} disabled={busy || !pack} onClick={() => snapshot('board_pack')}>Save snapshot</Button>
          </>
        }
      />
      {!pack && !error ? <SkeletonCard lines={4} />
        : error ? <ErrorState title="Could not load the board pack" sub={friendly(error)} onRetry={() => setTick(t => t + 1)} />
        : (
          <>
            <div className="grid grid-4" style={{ marginBottom: 20 }}>
              <Stat label="Active students" value={pack?.students ?? 0} sub="Enrolled, status active" />
              <Stat label="Staff" value={pack?.staff_count ?? 0} sub="Teaching + administrative" />
              <Stat label="Attendance today" value={pack?.attendance_today ? `${pack.attendance_today.present}/${pack.attendance_today.marked}` : '—'} sub="Present / marked" />
              <Stat label="Open cases" value={pack?.cases?.open ?? 0} sub={`${pack?.cases?.total ?? 0} total`} />
            </div>

            <Section title="Money" sub="Billed, collected and outstanding across the school." style={{ marginBottom: 4 }}>
              <Card pad>
                <div className="grid grid-4">
                  <Stat label="Billed" value={fmtMoney(Math.round((pack?.fees?.billed ?? 0) / 100))} sub="All fees due" />
                  <Stat label="Collected" value={fmtMoney(Math.round((pack?.fees?.collected ?? 0) / 100))} sub={collectionPct != null ? `${collectionPct}% of billed` : 'No billing yet'} />
                  <Stat label="Outstanding" value={fmtMoney(Math.round((pack?.fees?.outstanding ?? 0) / 100))} sub="Unpaid" />
                  <Stat label="Open fee dues" value={pack?.fees?.open_obligations ?? 0} sub="Pending or partial" />
                </div>
              </Card>
            </Section>

            <div className="grid grid-3" style={{ marginTop: 14 }}>
              <Card pad><Stat label="Admissions" value={pack?.admissions_open_leads ?? 0} sub="Open leads in the funnel" /></Card>
              <Card pad><Stat label="Safety" value={pack?.safety_open ?? 0} sub="Open safety-box reports" /></Card>
              <Card pad><Stat label="Snapshot integrity" value="Protected" sub="Each save gets a security fingerprint and cannot be changed" /></Card>
            </div>

            {pack?.attendance_today?.marked === 0 && (
              <div style={{ marginTop: 14 }}>
                <Badge tone="outline">No register marked today yet — attendance will populate once a class marks it.</Badge>
              </div>
            )}
          </>
        )}

      <Section title="Saved snapshots" sub="Board and inspection packs saved with a security fingerprint." style={{ marginTop: 18 }}>
        <Card pad>
          {snaps === null ? (
            <Button variant="secondary" icon={<Icon.Clipboard size={13} />} onClick={loadSnaps}>Load saved snapshots</Button>
          ) : snaps.length === 0 ? (
            <div className="u-small u-muted">No snapshots saved yet — use “Save snapshot” or “Save inspection pack” above.</div>
          ) : (
            <div className="u-col" style={{ gap: 8 }}>
              {snaps.map(s => (
                <div key={String(s.id)} className="u-between u-wrap" style={{ gap: 10, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 570 }}>{humanize(s.kind)} · {String(s.period)}</div>
                    <div className="u-xs u-faint mono">Fingerprint {String(s.content_hash).slice(0, 16)}… · {new Date(String(s.created_at)).toLocaleString()}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => viewSnap(String(s.id))}>Verify</Button>
                </div>
              ))}
              {viewing && (
                <div className="u-small" style={{ marginTop: 6, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                  <b>{viewing.hash_ok ? 'Fingerprint verified' : 'Fingerprint mismatch'}</b>
                  {viewing.created_at ? ` · ${new Date(viewing.created_at).toLocaleString()}` : ''}
                </div>
              )}
            </div>
          )}
        </Card>
      </Section>
    </>
  );
}
