/* ============================================================
   PrintQueue — StudentOS staff side (SU-3 lane, unit: staff/student).

   Students carry no phones — paper is how information reaches
   them (docs/STUDENTOS-PLAN.md, frozen contracts). This is the
   office desk behind the student Print Center: requests students
   queue from school computers land here, staff print them, then
   mark them done.

   Doors consumed (frozen v0; built by the SS-1 lane — may be
   mid-build, so every failure degrades calmly):
   - GET  /student/print/queue     staff door (office/teacher): queued jobs
   - POST /student/print/:id/done  mark a job printed
   Shapes are tolerant (v0 freezes door paths, not every field).
   Server errors surface verbatim (house law) via friendly().

   Every print request is recorded — audit-friendly by design.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHead, Card, Stat, Badge, Button, useToast, Empty, ErrorState, SkeletonCard, DataTable,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { friendly } from '../../lib/friendlyErrors';
import { LIVE_BASE } from '../../services/liveApi';
import { useStore } from '../../state/store';
import { useSession } from '../../App';

/* staff surface: teacher/office/coordinator/principal (the plan: "teacher/office
   see print queue"). Owner + IT admin mirror the house DESK set (VisitorsBoard);
   the server decides — this is a UI mirror, not authority. */
const STAFF_ROLES: string[] = ['teacher', 'coordinator', 'principal', 'owner', 'itadmin'];

const KIND_LABEL: Record<string, string> = {
  timetable: 'Timetable',
  study_plan: 'Study plan',
  checklist: 'Checklist',
  portfolio: 'Portfolio',
  mistake_sheet: 'Mistake sheet',
  flashcards: 'Flashcards',
  noticeboard: 'Noticeboard',
};

const STATUS_META: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  queued: { label: 'Waiting to print', tone: 'warning' },
  printed: { label: 'Printed', tone: 'success' },
};

interface PrintJob {
  id: string;
  studentName: string;
  kind: string;
  status: string;
  requestedAt: string | null;
}

/* staff doors live beside the student ones (studentApi.ts precedent): the same
   Bearer transport, implemented add-only here because liveApi.call() is not
   exported. Errors throw raw; the screen surfaces them verbatim via friendly(). */
async function staffCall<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('schoolos_token');
  const res = await fetch(`${LIVE_BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};
const firstStr = (...vals: unknown[]): string | null => {
  for (const v of vals) { const s = str(v); if (s) return s; }
  return null;
};

/* v0 freezes the door path, not the element shape — accept the loose shapes
   the server plausibly emits (array, or an object holding the array). */
function parseJobs(raw: unknown): PrintJob[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : (() => { const r = (raw ?? {}) as Record<string, unknown>; const arr = [r.printJobs, r.jobs, r.queue, r.print_queue].find(Array.isArray); return Array.isArray(arr) ? arr : []; })();
  return list.map((e, i) => {
    const r = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
    const student = typeof r.student === 'object' && r.student !== null ? r.student as Record<string, unknown> : null;
    return {
      id: firstStr(r.id) ?? `print-${i}`,
      studentName: firstStr(r.student_name, r.studentName, student?.name, typeof r.student === 'string' ? r.student : null) ?? 'Unnamed student',
      kind: firstStr(r.kind, r.type) ?? 'checklist',
      status: (firstStr(r.status) ?? 'queued').toLowerCase(),
      requestedAt: firstStr(r.requested_at, r.requestedAt, r.created_at, r.at),
    };
  });
}

export default function PrintQueue() {
  const toast = useToast();
  const { session } = useStore();
  const live = useSession();
  const allowed = STAFF_ROLES.includes(live.role) || STAFF_ROLES.includes(session.roleId);

  const [jobs, setJobs] = useState<PrintJob[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [kind, setKind] = useState('all');

  useEffect(() => {
    if (!allowed) return;
    let liveReq = true;
    setLoading(true); setError(null);
    staffCall<unknown>('/student/print/queue')
      .then(d => { if (liveReq) { setJobs(parseJobs(d)); setLoading(false); } })
      .catch(e => { if (liveReq) { setError(friendly(e)); setLoading(false); } });
    return () => { liveReq = false; };
  }, [tick, allowed]);

  const markPrinted = async (j: PrintJob) => {
    setBusyId(j.id);
    try {
      await staffCall(`/student/print/${encodeURIComponent(j.id)}/done`, { method: 'POST', body: '{}' });
      toast({ title: `${j.studentName}'s ${KIND_LABEL[j.kind] ?? j.kind} marked printed`, sub: 'Recorded on the print log — nothing else to do.', tone: 'success' });
      setTick(t => t + 1);
    } catch (e) {
      /* server law surfaces verbatim */
      toast({ title: 'Could not mark printed', sub: friendly(e), tone: 'error' });
    } finally { setBusyId(null); }
  };

  /* kind tabs follow the frozen kind list, but only kinds that actually
     appear in the queue get a tab (plus All) */
  const kinds = useMemo(() => {
    const present = new Set((jobs ?? []).map(j => j.kind));
    return ['all', ...Object.keys(KIND_LABEL).filter(k => present.has(k)), ...[...present].filter(k => !KIND_LABEL[k])];
  }, [jobs]);

  const filtered = useMemo(() => {
    const rows = jobs ?? [];
    if (kind === 'all') return rows;
    return rows.filter(j => j.kind === kind);
  }, [jobs, kind]);

  const stats = useMemo(() => {
    const rows = jobs ?? [];
    return {
      waiting: rows.filter(j => j.status !== 'printed').length,
      printed: rows.filter(j => j.status === 'printed').length,
      students: new Set(rows.map(j => j.studentName)).size,
    };
  }, [jobs]);

  if (!allowed) {
    return (
      <div>
        <PageHead title="Print queue" sub="The office desk behind the student Print Center." />
        <Empty icon={<Icon.Lock size={22} />} title="Staff surface" sub="Print requests show for office and teaching staff (teacher, coordinator, principal, owner, IT admin). The server checks every request — nothing here is public." />
      </div>
    );
  }
  if (loading) return <SkeletonCard lines={8} />;
  if (error) {
    /* the queue door (SS-1 lane) may still be mid-build — degrade calmly */
    return (
      <div>
        <PageHead title="Print queue" sub="The office desk behind the student Print Center." />
        <ErrorState title="Could not load the print queue" sub={error} onRetry={() => setTick(t => t + 1)} />
        <p className="u-small u-faint" style={{ marginTop: 10 }}>
          Students queue printouts from school computers — the requests are recorded on the server, so nothing is lost while this door is unreachable.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHead
        title="Print queue"
        sub="Students have no phones — what they ask to print lands here. Print it, hand it over, mark it done."
        actions={<Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={() => setTick(t => t + 1)}>Refresh</Button>}
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Waiting to print" value={stats.waiting} sub="Queued by students" />
        <Stat label="Printed" value={stats.printed} sub="Marked done by staff" />
        <Stat label="Students this batch" value={stats.students} sub="Distinct names on the queue" />
      </div>

      <Card pad style={{ marginBottom: 20 }}>
        <div className="u-flex u-wrap" style={{ gap: 12, alignItems: 'center' }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
            <label htmlFor="pq-kind">Filter by kind</label>
            <select id="pq-kind" className="select" value={kind} onChange={e => setKind(e.target.value)}>
              {kinds.map(k => <option key={k} value={k}>{k === 'all' ? 'All kinds' : KIND_LABEL[k] ?? k}</option>)}
            </select>
          </div>
          <span className="u-small u-faint" style={{ marginTop: 18 }}>
            Every print request is recorded — who asked, what, and when. Marking a job printed joins the same record.
          </span>
        </div>
      </Card>

      {(jobs ?? []).length === 0 ? (
        <Empty
          icon={<Icon.Document size={22} />}
          title="No print requests right now"
          sub="When a student queues a printout from a school computer — timetable, study plan, checklist, flashcards — it appears here with their name. Nothing to print at the moment."
        />
      ) : filtered.length === 0 ? (
        <Empty
          icon={<Icon.Filter size={22} />}
          title="No requests of this kind"
          sub="Nothing in the queue matches this kind right now. Choose All kinds to see the full queue."
        />
      ) : (
        <DataTable<PrintJob>
          caption={`Student print queue — ${filtered.length} request${filtered.length === 1 ? '' : 's'}. Every print request is recorded.`}
          rows={filtered}
          rowKey={j => j.id}
          columns={[
            {
              key: 'student', label: 'Student', sortable: true, sortValue: j => j.studentName,
              render: j => (
                <div className="u-flex" style={{ gap: 9, minWidth: 0 }}>
                  <span className="avatar sm" style={{ background: 'var(--accent-weak)', color: 'var(--accent-text)' }} aria-hidden="true">
                    {j.studentName.split(' ').map(w => w[0]).slice(0, 2).join('')}
                  </span>
                  <div style={{ fontWeight: 570 }}>{j.studentName}</div>
                </div>
              ),
            },
            {
              key: 'kind', label: 'What they need', sortable: true, sortValue: j => KIND_LABEL[j.kind] ?? j.kind,
              render: j => <span className="u-small">{KIND_LABEL[j.kind] ?? j.kind}</span>,
            },
            {
              key: 'requested', label: 'Requested', sortable: true, sortValue: j => j.requestedAt ? new Date(j.requestedAt).getTime() : 0,
              render: j => j.requestedAt
                ? <span className="u-small u-muted" title={fmtDateTime(j.requestedAt)}>{fmtRelative(j.requestedAt)}</span>
                : <span className="u-faint u-small">—</span>,
            },
            {
              key: 'status', label: 'Status', sortable: true,
              render: j => <Badge tone={STATUS_META[j.status]?.tone ?? 'neutral'} dot={j.status === 'queued'}>{STATUS_META[j.status]?.label ?? j.status}</Badge>,
            },
            {
              key: 'actions', label: 'Actions', align: 'right',
              render: j => j.status === 'printed'
                ? <span className="u-faint u-small">Done</span>
                : (
                  <Button
                    size="sm" variant="primary" icon={<Icon.Check size={13} />}
                    disabled={busyId === j.id}
                    aria-label={`Mark printed — ${j.studentName}, ${KIND_LABEL[j.kind] ?? j.kind}`}
                    onClick={() => markPrinted(j)}
                  >
                    {busyId === j.id ? 'Marking…' : 'Mark printed'}
                  </Button>
                ),
            },
          ]}
        />
      )}

      <div style={{ height: 20 }} />
      <div className="u-small u-muted">
        Paper is the delivery channel: students cannot receive links or notifications, so every handout is printed by the office or the class teacher.
        Requests keep their record after printing — nothing is deleted, and each job shows who asked and when.
      </div>
    </div>
  );
}
