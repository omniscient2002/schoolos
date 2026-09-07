/* ============================================================
   teacher/TeacherNav.tsx — the §1 IA nav for the teacher role.

   Exports the nav items Shell.tsx renders for the teacher case
   (plus the routes the App router must register). Existing
   surfaces stay reachable — TeacherHome REPLACES /today as the
   teacher's default landing only in the teacher nav case; the
   principal/other navs keep pointing at /today unchanged.

   KEEP THE 9 EXISTING TEACHER ITEMS WORKING: Demo · Needs your
   attention · Ask · Next · People · Learning · Report issue ·
   Library (+ Modules kernel item) all remain in the list.
   ============================================================ */
import type { NavItem } from '../Shell';

/** §1 groups: TEACH / STUDENTS / ASSESS / COMMUNICATE / SCHEDULE / INSIGHTS / ME.
 *  Routes that other lanes own are registered in App.tsx as section
 *  landings (SectionLanding) — flagged `ready: false` here until their
 *  lane lands, at which point only this table changes. */
export const TEACHER_SECTIONS: Record<string, { entries: { label: string; to: string; note: string; ready: boolean }[] }> = {
  teach: {
    entries: [
      { label: 'My classes', to: '/learning', note: 'Timetable, class lists and today’s lessons.', ready: true },
      { label: 'Lessons', to: '/teacher/lessons', note: 'Lesson workspace and reflections.', ready: false },
      { label: 'Curriculum progress', to: '/teacher/curriculum', note: 'Tick off topics; see pace per class.', ready: false },
      { label: 'Resources', to: '/library', note: 'School resource library (Modules).', ready: true },
      { label: 'Copilot', to: '/teacher/copilot', note: 'Ask, create and adapt — scoped to your classes.', ready: false },
    ],
  },
  students: {
    entries: [
      { label: 'Class lists', to: '/people', note: 'Every student you teach, by class.', ready: true },
      { label: 'Profiles & timeline', to: '/people', note: 'One timeline per student — permitted records only.', ready: true },
      { label: 'Mastery maps', to: '/teacher/mastery', note: 'Topic-level strengths and needs with evidence.', ready: false },
      { label: 'Concerns', to: '/teacher/concerns', note: 'Flag a concern; follow the support queue.', ready: false },
      { label: 'Interventions', to: '/teacher/interventions', note: 'Support plans and their progress.', ready: false },
    ],
  },
  assess: {
    entries: [
      { label: 'Homework & submissions', to: '/teacher/submissions', note: 'Assign in 20 seconds; review what comes back.', ready: false },
      { label: 'Assessments', to: '/teacher/assessments', note: 'Build quizzes and tests; proposal flow for exams.', ready: false },
      { label: 'Question bank', to: '/teacher/assessments', note: 'School-controlled question sets.', ready: false },
      { label: 'Analytics', to: '/insights', note: 'Class performance, live today.', ready: true },
    ],
  },
  communicate: {
    entries: [
      { label: 'Announcements', to: '/teacher/announce', note: 'Class announcements with receipts.', ready: false },
      { label: 'Messages', to: '/teacher/messages', note: 'In-school parent messages, numbers masked.', ready: false },
      { label: 'Templates', to: '/teacher/announce', note: 'Approved templates for routine notes.', ready: false },
      { label: 'Parent comms drafts', to: '/teacher/messages', note: 'AI drafts — you edit and approve before send.', ready: false },
    ],
  },
  schedule: {
    entries: [
      { label: 'My timetable', to: '/learning', note: 'Periods, rooms and subjects — live today.', ready: true },
      { label: 'Duties', to: '/teacher/duties', note: 'Your invigilation and supervision roster.', ready: false },
      { label: 'Substitution', to: '/teacher/leave', note: 'Leave requests and substitute proposals.', ready: false },
      { label: 'My leave', to: '/teacher/leave', note: 'Request leave; track approval and handover.', ready: false },
      { label: 'Calendar', to: '/calendar', note: 'School calendar with exams, PTMs, events.', ready: true },
    ],
  },
  insights: {
    entries: [
      { label: 'Class analytics', to: '/insights', note: 'Live today on the Insights screen.', ready: true },
      { label: 'My workload', to: '/teacher/workload', note: 'Your teaching, duties, grading load — for fairness, never rankings.', ready: false },
      { label: 'Curriculum coverage', to: '/teacher/curriculum', note: 'Pace per topic and class.', ready: false },
      { label: 'Progress stories', to: '/teacher/mastery', note: 'Narratives instead of score-only views.', ready: false },
    ],
  },
  me: {
    entries: [
      { label: 'Profile & preferences', to: '/settings', note: 'Your account and app preferences.', ready: true },
      { label: 'Leave history', to: '/teacher/leave', note: 'Past requests and decisions.', ready: false },
      { label: 'My activity', to: '/audit', note: 'Everything done in your name, with audit trail.', ready: true },
    ],
  },
};

/** The teacher nav case content (Shell.tsx consumes this) —
 *  existing 9 items + the IA groups. */
export function teacherNavItems(openNeeds: number): NavItem[] {
  return [
    { to: '/demo', label: 'Demo', icon: 'Play' },
    { to: '/today', label: 'My day', icon: 'Today' },          // TeacherHome (was: Today briefing)
    { to: '/attention', label: 'Needs your attention', icon: 'Attention', badge: openNeeds },
    { to: '/ask', label: 'Ask', icon: 'Ask' },
    { to: '/next', label: 'Next', icon: 'Next' },
    { to: '/teacher/students', label: 'Students', icon: 'People' },
    { to: '/teacher/teach', label: 'Teach', icon: 'Learning' },
    { to: '/teacher/assess', label: 'Assess', icon: 'Clipboard' },
    { to: '/teacher/communicate', label: 'Communicate', icon: 'Message' },
    { to: '/teacher/schedule', label: 'Schedule', icon: 'Calendar' },
    { to: '/teacher/insights', label: 'Insights', icon: 'Insights' },
    { to: '/teacher/me', label: 'Me', icon: 'User' },
    { to: '/maintenance/report', label: 'Report issue', icon: 'Zap' },
    { to: '/library', label: 'Library', icon: 'Book', plugin: 'library' },
  ];
}
