/* ============================================================
   WellbeingQueue — StudentOS staff side (SU-3 lane, unit: staff/student).

   Students can raise a wellbeing request from a school computer
   (POST /student/wellbeing → routed to the counselor via the
   teacher.support concern flow). This is the STAFF read side:
   who asked, what category, what they wrote, when, and where it
   stands. No reply/engage features — students have no phones, and
   wellbeing is handled by people, not by an inbox. The counselor
   team works concerns in teacher.support; physical support routes
   (meet the counselor, class teacher, drop a note) stay open
   alongside.

   Door consumed (frozen v0; SS-1 lane): POST /student/wellbeing
   is frozen; a staff LIST door is not in the freeze — the plan
   says "counselor sees wellbeing routing". This screen calls
   GET /student/wellbeing (the natural list door beside the POST)
   and DEGRADES CALMLY to the contract-based empty state if the
   door 404s/403s or is still mid-build — the screen is never
   broken, it is honest.
   Server errors surface verbatim (house law) via friendly().
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHead, Card, Stat, Badge, Empty, ErrorState, SkeletonCard, DataTable, Tabs,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { friendly } from '../../lib/friendlyErrors';
import { apiRequest } from '../../services/liveApi';
import { useSession } from '../../App';
import { canSurface } from '../../lib/effective';
import { useRoleOrGrant } from '../../lib/access';

/* authorized staff (plan: "counselor sees wellbeing routing"). The server
   decides who actually sees rows — this is a UI mirror, not authority. */
/* FEX-8: `teacher` was admitted here while the empty-state copy on this very screen promises requests are
   shown "never to subject teachers". The server gate (`WELLBEING_READERS`) refuses teachers; this mirror
   now matches it rather than offering a list door the API would 403. */
const STAFF_ROLES: string[] = ['counselor', 'principal', 'owner', 'itadmin', 'coordinator'];

const STATUS_META: Record<string, { label: string; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  new: { label: 'New', tone: 'warning' },
  open: { label: 'Open', tone: 'info' },
  routed: { label: 'With counselor', tone: 'info' },
  in_progress: { label: 'Counselor following up', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
};
const NEWISH = new Set(['new', 'open']);

const CATEGORY_LABEL: Record<string, string> = {
  stress: 'Stress or worry',
  anxiety: 'Stress or worry',
  friend: 'Friendships',
  friends: 'Friendships',
  bullying: 'Bullying',
  family: 'Family at home',
  health: 'Health',
  study: 'Study pressure',
  other: 'Something else',
};
const CATEGORY_TONE: Record<string, 'info' | 'accent' | 'warning' | 'danger' | 'neutral'> = {
  bullying: 'danger', health: 'warning', stress: 'info', anxiety: 'info',
  friend: 'accent', friends: 'accent', family: 'accent', study: 'neutral', other: 'neutral',
};

interface WellbeingRow {
  id: string;
  studentName: string;
  category: string;
  detail: string;
  status: string;
  createdAt: string | null;
}

/* FEX-6: staff doors ride the ONE transport (`liveApi.apiRequest`) — same bearer, same 401 session-reset,
   same CSRF echo. The hand-rolled copy this replaces missed the session-reset path entirely. */
const staffCall = apiRequest;

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
function parseRows(raw: unknown): WellbeingRow[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : (() => { const r = (raw ?? {}) as Record<string, unknown>; const arr = [r.requests, r.rows, r.items, r.concerns, r.wellbeing].find(Array.isArray); return Array.isArray(arr) ? arr : []; })();
  return list.map((e, i) => {
    const r = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
    const student = typeof r.student === 'object' && r.student !== null ? r.student as Record<string, unknown> : null;
    return {
      id: firstStr(r.id, r.request_id) ?? `wb-${i}`,
      studentName: firstStr(r.student_name, r.studentName, student?.name, typeof r.student === 'string' ? r.student : null) ?? 'Student',
      category: (firstStr(r.category) ?? 'other').toLowerCase(),
      detail: firstStr(r.detail, r.note, r.what, r.message) ?? '',
      status: (firstStr(r.status) ?? 'open').toLowerCase(),
      createdAt: firstStr(r.created_at, r.createdAt, r.requested_at, r.at),
    };
  });
}

export default function WellbeingQueue() {
  const live = useSession();
  /* FEX-4/FEX-7: the wellbeing desk's server gate is `GET /student/wellbeing`; a mask-granted
     custom role reaches it through the grant, not a built-in role string. */
  const staffGranted = useRoleOrGrant(STAFF_ROLES, ['GET /student/wellbeing']);
  const allowed = live.effective ? canSurface(live.effective, '/wellbeing-queue') : staffGranted;

  const [rows, setRows] = useState<WellbeingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState('open');

  useEffect(() => {
    if (!allowed) return;
    let liveReq = true;
    setLoading(true); setError(null);
    staffCall<unknown>('/student/wellbeing')
      .then(d => { if (liveReq) { setRows(parseRows(d)); setLoading(false); } })
      .catch(e => { if (liveReq) { setError(friendly(e)); setLoading(false); } });
    return () => { liveReq = false; };
  }, [tick, allowed]);

  const openCount = useMemo(() => (rows ?? []).filter(r => NEWISH.has(r.status) || r.status === 'routed' || r.status === 'in_progress').length, [rows]);

  const filtered = useMemo(() => {
    const all = rows ?? [];
    if (tab === 'open') return all.filter(r => NEWISH.has(r.status) || r.status === 'routed' || r.status === 'in_progress');
    if (tab === 'resolved') return all.filter(r => r.status === 'resolved' || r.status === 'closed');
    return all;
  }, [rows, tab]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtered) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  if (!allowed) {
    return (
      <div>
        <PageHead title="Wellbeing requests" sub="What students have asked the counselor team to know." />
        <Empty icon={<Icon.Lock size={22} />} title="Only authorized staff see this" sub="Wellbeing requests are private. They show for the counselor team and the principal's office — never to subject teachers, and never to other students." />
      </div>
    );
  }
  if (loading) return <SkeletonCard lines={8} />;
  if (error) {
    /* the list door is NOT in the frozen v0 set — SS-1 may not have built it.
       Contract-based calm degradation: say what this screen is, list the
       physical routes that exist TODAY, and offer retry (door may land later). */
    return (
      <div>
        <PageHead title="Wellbeing requests" sub="What students have asked the counselor team to know." />
        <ErrorState title="Wellbeing requests did not load" sub={error} onRetry={() => setTick(t => t + 1)} />
        <p className="u-small u-faint" style={{ marginTop: 10 }}>
          Requests students raise in the app are routed to the counselor team. Until this list door is live, students can always use the physical support routes —
          meet the counselor directly, tell the class teacher, or drop a note. Nothing a student shares is ever lost.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHead
        title="Wellbeing requests"
        sub="What students have asked the counselor team to know — read, understand, and follow up as people. There is no reply button here on purpose."
      />

      {/* privacy banner */}
      <Card pad style={{ marginBottom: 20, borderColor: 'var(--warning-weak-2)' }}>
        <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
          <Icon.Lock size={13} style={{ color: 'var(--warning)' }} />
          <span className="u-small" style={{ fontWeight: 600 }}>Only authorized staff see this.</span>
          <span className="u-small u-faint">
            Every view of a request is recorded. Students are told their message goes to the counselor team, and that physical support routes stay open.
          </span>
        </div>
      </Card>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Waiting on the team" value={openCount} sub="New, routed or being followed up" />
        <Stat label="All requests" value={(rows ?? []).length} sub="Since the school started using the form" />
        <Stat label="Categories in view" value={categories.length} sub="In the list below" />
      </div>

      <Tabs
        tabs={[
          { id: 'open', label: 'Needs the team', count: openCount },
          { id: 'resolved', label: 'Resolved', count: (rows ?? []).filter(r => r.status === 'resolved' || r.status === 'closed').length },
          { id: 'all', label: 'All', count: (rows ?? []).length },
        ]}
        active={tab}
        onChange={setTab}
        panelId="wb-queue"
      />
      <div role="tabpanel" id="wb-queue-panel-all" aria-labelledby="wb-queue-tab-all">
        {(rows ?? []).length === 0 ? (
          <Empty
            icon={<Icon.Heart size={22} />}
            title="No wellbeing requests yet"
            sub="When a student raises something from a school computer, it lands here for the counselor team. The physical routes — meeting the counselor, the class teacher, a note in the box — work today and always."
          />
        ) : filtered.length === 0 ? (
          <Empty
            icon={<Icon.Check size={22} />}
            title="Nothing in this view"
            sub="No requests match this tab right now — switch to All to see every recorded request."
          />
        ) : (
          <DataTable<WellbeingRow>
            caption={`Student wellbeing requests — ${filtered.length} row${filtered.length === 1 ? '' : 's'}. Only authorized staff see this.`}
            rows={filtered}
            rowKey={r => r.id}
            columns={[
              {
                key: 'student', label: 'Student', sortable: true, sortValue: r => r.studentName,
                render: r => <span style={{ fontWeight: 570 }}>{r.studentName}</span>,
              },
              {
                key: 'category', label: 'Category', sortable: true, sortValue: r => CATEGORY_LABEL[r.category] ?? r.category,
                render: r => <Badge tone={CATEGORY_TONE[r.category] ?? 'neutral'}>{CATEGORY_LABEL[r.category] ?? r.category}</Badge>,
              },
              {
                key: 'detail', label: 'What they wrote', render: r => (
                  <span className="u-small" style={{ display: 'block', maxWidth: 420, whiteSpace: 'normal', lineHeight: 1.5 }}>{r.detail || <span className="u-faint">—</span>}</span>
                ),
              },
              {
                key: 'created', label: 'Date', sortable: true, sortValue: r => r.createdAt ? new Date(r.createdAt).getTime() : 0,
                render: r => r.createdAt
                  ? <span className="u-small u-muted" title={fmtDateTime(r.createdAt)}>{fmtRelative(r.createdAt)}</span>
                  : <span className="u-faint u-small">—</span>,
              },
              {
                key: 'status', label: 'Status', sortable: true,
                render: r => <Badge tone={STATUS_META[r.status]?.tone ?? 'neutral'} dot={NEWISH.has(r.status)}>{STATUS_META[r.status]?.label ?? r.status}</Badge>,
              },
            ]}
          />
        )}
      </div>

      {/* routing note */}
      <Card pad style={{ marginTop: 20, background: 'var(--accent-weak)' }}>
        <div className="u-flex" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Icon.Users size={14} style={{ color: 'var(--accent-text)', marginTop: 2 }} />
          <div className="u-small" style={{ lineHeight: 1.6 }}>
            <b>Goes to the counselor team</b> — requests raised by students are routed to the counselor, and urgent ones reach the principal's desk too.
            Students can also use the physical support routes: meet the counselor in person, tell the class teacher, or drop a note. Those need no app and no phone.
          </div>
        </div>
      </Card>

      <div style={{ height: 20 }} />
      <div className="u-small u-muted">
        This desk is read-only on purpose: no reply buttons, no status toggles, no student-facing feed. Follow-up happens face to face by the counselor team —
        the way wellbeing should work. The school's engagement rules (§88) forbid turning support into a chat.
      </div>
    </div>
  );
}
