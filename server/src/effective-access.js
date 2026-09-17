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
  '/admissions': 'GET /admissions/followups',
  '/learning': 'GET /plugins/exams.assessment/exams',
  '/fees': 'GET /fees/obligations',
  '/fees/plans': 'GET /fee-plans',
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
  '/documents': 'GET /plugins/files.store',
  '/operations/hr': 'GET /plugins/hr.leave/leave',
  '/calendar': 'GET /academic-years',
  '/incidents': 'GET /cases',
  '/constitution': 'GET /academic-years',
  '/memory': 'GET /memory',
  '/data-health': 'GET /audit',
  '/ai-governance': 'GET /ai/calls',
  /* FEX-5: these admin surfaces used to proxy to `GET /plugins`, which is a `me` door — so every
     authenticated caller (including a parent) was told they could render the group, settings, rails
     and plugin-settings screens. Each now names a door whose real gate is owner/itadmin, so the
     server's own answer hides them exactly where the doors would refuse. */
  '/group': 'GET /metrics',
  '/transport': 'GET /transport/routes',
  '/migration': 'GET /migration/sources',
  '/roles': 'GET /roles',
  '/plugins': 'GET /plugins',
  '/plugins/settings': 'POST /plugins/:id/settings',
  '/plugins/settings/:id': 'POST /plugins/:id/settings',
  '/settings': 'GET /metrics',
  '/account/password': 'GET /me',
  '/rails': 'GET /metrics',
  '/it': 'GET /metrics',
  '/library': 'GET /plugins/library/books',
  '/visitors': 'GET /plugins/ops.visitors/visitors',
  '/reception': 'GET /plugins/ops.visitors/visitors',
  '/insights': 'GET /reports/fees/summary',
  '/people-admin': 'GET /plugins/people.admin/users',
  /* These staff surfaces previously existed only in the client's hardcoded
     palette. Their backing doors are now part of the same answer. */
  '/action-center': 'GET /actions',
  '/automation': 'GET /workflow-rules',
  '/ai-usage': 'GET /ai/calls',
  '/teacher': 'GET /plugins/teacher.classroom/homework',
  '/teacher/homework': 'GET /plugins/teacher.classroom/homework',
  '/teacher/submissions': 'GET /plugins/teacher.classroom/submissions',
  '/teacher/leave': 'GET /teacher/leave/mine',
  '/print-queue': 'GET /student/print/queue',
  '/noticeboard': 'GET /student/noticeboard',
  '/wellbeing-queue': 'GET /student/wellbeing',
  '/parent': 'GET /parent/home',
  '/parent/family': 'GET /parent/home',
  '/parent/consents': 'GET /parent/consents',
  '/parent/requests': 'GET /parent/requests',
  '/parent/complaints': 'GET /parent/requests',
  '/parent/chat': 'GET /parent/brief',
  '/parent/fees': 'GET /fees/obligations',
  '/parent/copilot': 'GET /parent/brief',
  '/student': 'GET /student/home',
  '/student/home2': 'GET /student/home',
  '/student/learning': 'GET /student/homework',
  '/student/portfolio': 'GET /student/results',
  '/coord/home': 'GET /coord/home',
  '/coord/substitutions': 'GET /coord/teacher-workload',
  '/coord/workload': 'GET /coord/teacher-workload',
  '/coord/escalations': 'GET /coord/escalations',
  '/coord/curriculum': 'GET /coord/curriculum-monitor',
  '/coord/approvals': 'GET /actions',
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
export function capabilitiesFor(doors, surfaces = SURFACE_DOOR) {
  const set = new Set(doors);
  const out = {};
  for (const [surface, door] of Object.entries(surfaces)) out[surface] = set.has(door);
  return out;
}
