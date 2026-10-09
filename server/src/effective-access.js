// Effective access — what a signed-in caller may reach, computed from the SAME registry the doors enforce.
//
// PERFECT-100 §6.2 item 14 / RBAC-6 / FE-2. The client used to re-derive its own permission model: a
// 12-branch role `switch` for navigation (with no `default`, so an unknown role became the broadest), a
// 43-entry `staffOnly` prefix list for the route guard, and a command palette with 21 unconditional staff
// destinations shown to every signed-in user. Any server-side role change therefore needed a frontend
// release, and the two layers drifted silently. `GET /me/effective` answers the question the client
// actually has — "which surfaces may I render?" — from the server's own route registry and the caller's
// custom-role mask, so the client never invents a permission. It is a RENDER hint only: every door still
// re-decides per request and refuses regardless of what the client shows.
//
// This module is deliberately PURE (no DB import, no privileged query sites): it takes the registry the
// kernel already maintains (`registeredRoutes` / `doorRoles`) and the shared mask matcher, so it cannot
// drift from the gates it mirrors and cannot grow the owner-path privilege count.

/**
 * A user-facing surface maps to the ONE door that represents it; the surface is renderable when that door
 * is reachable. Surfaces absent from this map are structural/general and are handled by the role switch.
 * Keeping the map server-side — and asserting in a test that every target door is actually registered —
 * is what makes a typo fail CI instead of silently hiding (or revealing) a screen.
 */
export const SURFACE_DOOR = Object.freeze({
  '/today': 'GET /actions',
  '/attention': 'GET /actions',
  '/next': 'GET /events',
  '/people': 'GET /students',
  '/people/:id': 'GET /students/:id',
  '/attendance': 'GET /attendance',
  /* the class/section structure editor: owner, principal and IT admin (the write door is the gate) */
  '/classes': 'PUT /school/classes',
  /* the School profile screen: the read door is owner-gated, so canSurface answers exactly
     where both profile doors admit (writes go through POST /onboard/school, also owner-only) */
  '/school-profile': 'GET /school/profile',
  /* the Setup guide: the read door admits owner/principal/itadmin — the people-chain stages —
     so each role sees the guide exactly where its stage doors admit */
  '/setup': 'GET /school/setup',
  /* M3: the timetable write surface — renderable when the grid read door is reachable (the writes re-gate) */
  '/timetable': 'GET /plugins/ops.timetable/grid',
  '/admissions': 'GET /admissions/followups',
  '/learning': 'GET /plugins/exams.assessment/exams',
  '/fees': 'GET /fees/obligations',
  '/fees/plans': 'GET /fee-plans',
  /* FEE-RBAC-7: the surfaces added by the fees-to-100 work name their real doors, so canSurface answers
     correctly instead of failing every one of them closed. */
  '/fees/heads': 'GET /fees/heads',
  '/fees/installments': 'GET /fees/installments',
  '/student/fees': 'GET /student/fees',
  '/audit': 'GET /audit',
  '/cases': 'GET /cases',
  '/cases/:id': 'GET /cases',
  '/communications': 'GET /communications',
  '/events': 'GET /events',
  '/operations': 'GET /work-orders',
  '/maintenance': 'GET /work-orders',
  '/facilities': 'GET /work-orders',
  '/maintenance/work-orders': 'GET /work-orders',
  '/maintenance/work-orders/:id': 'GET /work-orders',
  '/maintenance/technician': 'GET /work-orders',
  '/maintenance/assets': 'GET /assets',
  '/maintenance/assets/:id': 'GET /assets',
  '/maintenance/preventive': 'GET /work-orders',
  '/maintenance/inspections': 'GET /work-orders',
  '/maintenance/inventory': 'GET /assets',
  '/maintenance/vendors': 'GET /work-orders',
  '/maintenance/intelligence': 'GET /work-orders',
  '/maintenance/map': 'GET /work-orders',
  '/maintenance/report': 'GET /work-orders',
  /* OPP-FE-1: `/documents`, `/operations/hr`, `/calendar`, `/constitution`, `/data-health`,
     `/ai-governance`, `/ai-usage`, `/automation` and `/reception` render SAMPLE data and have no live
     data door of their own. They used to be authorized by an unrelated live door (a files door, an
     academic-years door, an audit door) — a surface claiming a door it does not use. They are now
     authorized by the explicit SAMPLE_SURFACES role list below. */
  '/incidents': 'GET /cases',
  '/memory': 'GET /memory',
  /* FEX-5: these admin surfaces used to proxy to `GET /plugins`, which is a `me` door — so every
     authenticated caller (including a parent) was told they could render the group, settings, rails
     and plugin-settings screens. Each now names a door whose real gate is owner/itadmin, so the
     server's own answer hides them exactly where the doors would refuse. */
  /* OPP-FE-3: the group console's audience is Owner/Principal/Finance (its own copy), so it maps to a
     cross-domain management read those roles hold rather than the owner/itadmin-only metrics door. */
  '/group': 'GET /reports/fees/summary',
  '/transport': 'GET /transport/routes',
  /* H1: the transport write screen. Gated on the plugin's OWN route door rather than the kernel read,
     because a school with the add-on off has no routes to write — and canSurface fails closed, so an
     unmapped surface would hide a real screen (FEX-5). */
  '/transport/setup': 'GET /plugins/transport.gps/routes',
  /* health.clinic: the infirmary log's own read door. Gated on the plugin's read rather than a role
     list, because the read is nurse-lane PII by design (DPDP) — the map inherits that decision instead
     of restating it, and the screen asks the same question before it calls anything. */
  '/clinic': 'GET /plugins/health.clinic/visits',
  /* The returns surface is three add-ons in one place (UDISE, CBSE OASIS, Tally). It is mapped to the
     office-tier UDISE read so the surface is renderable for the roles that file returns; each CARD
     inside asks its own door's gate, so a finance-only role sees the accountant's card alone. */
  '/returns': 'GET /plugins/ops.udise/columns',
  /* Safety (4.5): the audit wall + verification ledger read their own doors. Mapped to the
     checklist read so the surface renders for the desks that attest; each card re-gates. */
  '/safety': 'GET /safety/checklist',
  '/migration': 'GET /migration/sources',
  '/roles': 'GET /roles',
  '/plugins': 'GET /plugins',
  '/plugins/settings': 'POST /plugins/:id/settings',
  '/plugins/settings/:id': 'POST /plugins/:id/settings',
  /* OPP-FE-2: Settings is a personal + school-profile surface every signed-in user is linked to; its
     tabs gate their own content (roles owner/itadmin, DSR DPO tier). Mapping it to the owner/itadmin-only
     `/metrics` door told parents/students/principal "Not available for your role" while the account menu
     linked them to it. `GET /me` is the honest floor: authenticated, role-scoped inside. */
  '/settings': 'GET /me',
  '/account/password': 'GET /me',
  '/rails': 'GET /metrics',
  '/it': 'GET /metrics',
  /* library v2 (docs/LIBRARY-DESIGN.md): the borrower catalog is open to every non-parent role; the desk
     is librarian-only and the ops dashboard is librarian/owner/principal — each names its real door so the
     server's own answer hides the management surfaces exactly where the doors refuse. */
  '/library': 'GET /plugins/library/catalog',
  '/library/desk': 'GET /plugins/library/desk/overview',
  '/library/insights': 'GET /plugins/library/ops/overview',
  '/library/setup': 'POST /plugins/:id/settings',
  '/visitors': 'GET /plugins/ops.visitors/visitors',
  '/insights': 'GET /reports/fees/summary',
  '/reports': 'GET /plugins/ops.bi/fees/aging',
  '/people-admin': 'GET /plugins/people.admin/users',
  /* Master Action Plan (MPD center, RTE ledger, payroll-lite, billing): kernel doors, each names
     its real read door so Guard/canSurface render exactly where the doors admit. */
  '/mpd': 'GET /compliance/mpd',
  '/rte': 'GET /rte/overview',
  '/payroll': 'GET /payroll/overview',
  '/billing': 'GET /billing',
  /* Action Plan batch 3 (NEP pack): the classroom-policy surface names its profile door. */
  '/nep': 'GET /nep/profile',
  /* OPP: owner/principal oversight product surfaces each name their real door. */
  '/board-pack': 'GET /reports/board-pack',
  '/principal-brief': 'GET /brief/principal',
  '/owner/home': 'GET /owner/home',
  '/principal/home': 'GET /principal/home',
  '/compliance': 'GET /compliance',
  '/certificates': 'GET /certificates',
  '/announcements': 'GET /announcements',
  '/delegations': 'GET /delegations',
  '/appraisals': 'GET /staff/appraisals', /* OPP-PRD-11 */
  /* These staff surfaces previously existed only in the client's hardcoded
     palette. Their backing doors are now part of the same answer. */
  '/action-center': 'GET /actions',
  '/teacher': 'GET /teacher/home',
  '/teacher/homework': 'GET /plugins/teacher.classroom/homework',
  '/teacher/submissions': 'GET /plugins/teacher.classroom/submissions',
  '/teacher/leave': 'GET /teacher/leave/mine',
  '/teacher/copilot': 'POST /copilot/ask',
  '/teacher/support': 'GET /teacher/concerns',
  '/teacher/concerns': 'GET /teacher/concerns',
  '/counselor/concerns': 'GET /teacher/concerns', /* OPP-PRD-8 */
  '/teacher/doubts': 'GET /teacher/support/doubts',
  '/teacher/interventions': 'GET /interventions',
  '/teacher/ptm': 'GET /ptm/slots',
  '/teacher/safety': 'GET /safety/box',
  '/teacher/lessons': 'GET /plugins/teacher.classroom/lessons',
  '/teacher/duties': 'GET /duty/roster',
  '/teacher/mastery': 'GET /mastery/class/:grade',
  '/teacher/curriculum': 'GET /curriculum/tree',
  '/teacher/progress-story': 'GET /progress/story/:studentId',
  '/teacher/exam-marks': 'GET /plugins/exams.assessment/exams',
  '/teacher/analytics': 'GET /analytics/class/:grade',
  '/print-queue': 'GET /student/print/queue',
  '/noticeboard': 'GET /student/noticeboard',
  '/wellbeing-queue': 'GET /student/wellbeing',
  '/parent': 'GET /parent/home',
  '/parent/family': 'GET /parent/home',
  '/parent/consents': 'GET /parent/consents',
  '/parent/requests': 'GET /parent/requests',
  '/parent/complaints': 'GET /parent/requests',
  '/parent/chat': 'GET /parent/brief',
  '/parent/child/:id': 'GET /parent/home',
  '/parent/fees': 'GET /fees/obligations',
  '/parent/copilot': 'GET /parent/brief',
  '/student': 'GET /student/home',
  '/student/home2': 'GET /student/home',
  '/student/learning': 'GET /student/homework',
  '/student/portfolio': 'GET /student/results',
  '/student/homework': 'GET /student/homework',
  '/student/mistakes': 'GET /student/mistakes',
  '/student/flashcards': 'GET /student/flashcards',
  '/student/tasks': 'GET /student/tasks',
  '/student/results': 'GET /student/results',
  '/coord/home': 'GET /coord/home',
  '/coord/substitutions': 'GET /coord/teacher-workload',
  '/coord/workload': 'GET /coord/teacher-workload',
  '/coord/escalations': 'GET /coord/escalations',
  '/coord/curriculum': 'GET /coord/curriculum-monitor',
  '/coord/approvals': 'GET /actions',
});

/**
 * OPP-FE-1 · seed-only surfaces. Each renders SAMPLE data and has no live data door of its own, so it
 * is authorized by an explicit role list rather than by a live door it does not use. These surfaces
 * carry a `SampleNote` in the UI (the honesty gate enforces that); this map only decides who may
 * render the labelled sample. A surface absent from both maps still fails closed.
 */
export const SAMPLE_SURFACES = Object.freeze({
  '/documents': ['owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'admissions', 'transport', 'facilities', 'technician', 'finance', 'finance_head', 'finance_clerk'],
  '/operations/hr': ['owner', 'principal', 'itadmin', 'coordinator', 'admissions', 'finance', 'finance_head', 'finance_clerk'],
  '/calendar': ['owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'admissions', 'finance', 'finance_head', 'finance_clerk'],
  '/constitution': ['owner', 'principal', 'itadmin'],
  '/data-health': ['owner', 'principal', 'itadmin'],
  '/ai-governance': ['owner', 'principal', 'itadmin'],
  '/ai-usage': ['owner', 'principal', 'itadmin'],
  '/automation': ['owner', 'principal', 'itadmin'],
  '/reception': ['owner', 'principal', 'itadmin', 'coordinator', 'facilities', 'transport'],
});

/**
 * Every door in `registeredRoutes` this caller may reach. A door with no role gate is reachable by any
 * authenticated caller. A gated door is reachable when the built-in role is in the gate OR the caller's
 * custom mask explicitly ALLOWS it; a mask DENY always removes it (deny wins, exactly as at the gates).
 * Pure by design: `doorRoles` is a Map (or plain object) and `maskDecides` is injected so there is one
 * matcher definition (src/custom-roles.js) rather than a second implementation here.
 */
export function reachableDoors({ role, mask, doorRoles, registeredRoutes, maskDecides }) {
  const out = [];
  for (const door of registeredRoutes ?? []) {
    const sp = door.indexOf(' ');
    if (sp < 0) continue;
    const method = door.slice(0, sp);
    const url = door.slice(sp + 1);
    const decision = mask ? maskDecides(mask, method, url) : null;
    if (decision === 'deny') continue;
    const gate = typeof doorRoles?.get === 'function' ? doorRoles.get(door) : doorRoles?.[door];
    const baseOk = !gate || gate.includes(role);
    if (baseOk || decision === 'allow') out.push(door);
  }
  return out.sort();
}

/** Which named surfaces this caller may render. Every surface in SURFACE_DOOR gets an explicit
 *  true/false; the client fails closed on a surface the server did not name, so the map must cover
 *  every renderable route (FEX-5). Surfaces deliberately absent are structural/public ones that never
 *  reach this gate. */
export function capabilitiesFor(doors, surfaces = SURFACE_DOOR, role = null) {
  const set = new Set(doors);
  const out = {};
  for (const [surface, door] of Object.entries(surfaces)) out[surface] = set.has(door);
  // OPP-FE-1: seed-only surfaces are authorized by an explicit role list, not a live door.
  if (role) {
    for (const [surface, roles] of Object.entries(SAMPLE_SURFACES)) {
      if (out[surface] === undefined) out[surface] = roles.includes(role);
    }
  }
  return out;
}
