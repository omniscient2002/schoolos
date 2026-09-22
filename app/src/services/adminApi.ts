/* ============================================================
   adminApi — people.admin + library + files.store client.
   One function per server door; every screen below calls these,
   never fetch() directly. Shapes mirror the plugin doors 1:1.
   ============================================================ */
import { apiGet, apiPost, apiPut, apiDelete, apiPatch } from './liveApi';

/* ---------- people.admin ---------- */

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  forceChange?: boolean;
}

export async function adminListUsers(): Promise<{ users: AdminUser[] }> {
  return apiGet('/plugins/people.admin/users');
}

/** Provision a staff member or parent. Password is generated server-side and
 *  shown exactly once in the response. */
export async function adminCreateUser(input: {
  name: string; email: string; role: string; phone?: string;
}): Promise<{ user: AdminUser; tempPassword: string }> {
  return apiPost('/plugins/people.admin/users', input);
}

export async function adminSuspendUser(id: string, reason?: string) {
  return apiPost(`/plugins/people.admin/users/${id}/suspend`, { reason });
}

export async function adminActivateUser(id: string) {
  return apiPost(`/plugins/people.admin/users/${id}/activate`, {});
}

export async function adminResetPassword(id: string): Promise<{ tempPassword: string }> {
  return apiPost(`/plugins/people.admin/users/${id}/reset-password`, {});
}

export interface TransferResult {
  student: { id: string; name: string; grade: string; section: string };
  history: { fromGrade: string; fromSection: string; toGrade: string; toSection: string; reason?: string };
}

/** Move a student to another class — writes enrollment history server-side. */
export async function adminTransferStudent(
  studentId: string,
  input: { toGrade: string; toSection: string; reason?: string },
): Promise<TransferResult> {
  return apiPost(`/plugins/people.admin/students/${studentId}/transfer`, input);
}

export interface ImportReport {
  ok: ImportOkRow[];
  failed: ImportFailRow[];
  total: number;
}
export interface ImportOkRow { row: number; admissionNo?: string; name: string }
export interface ImportFailRow { row: number; error: string }

/** CSV import: the frontend reads the file with FileReader and sends the text. */
export async function adminImportStudents(csv: string): Promise<ImportReport> {
  return apiPost('/plugins/people.admin/import/students', { csv });
}

export async function adminStudentHistory(studentId: string): Promise<{
  history: { id: string; fromGrade: string; fromSection: string; toGrade: string; toSection: string; reason?: string; createdAt: string; changedBy: string }[];
}> {
  return apiGet(`/plugins/people.admin/students/${studentId}/history`);
}

/* ---------- library (v2, docs/LIBRARY-DESIGN.md) ---------- */

export interface LibraryBook {
  id: string; code: string; title: string; subtitle?: string | null; author: string; publisher?: string | null;
  edition?: string | null; pubYear?: number | null; isbn13?: string | null; isbn10?: string | null;
  category: string; subject?: string | null; deweyCode?: string | null; description?: string | null;
  language?: string | null; shelfLocation?: string | null; bookType?: string; status?: string;
  priceCents?: number | null; vendor?: string | null; billRef?: string | null; acquiredOn?: string | null;
  copiesTotal: number; copiesOut: number; available: number; retired?: boolean;
  coverFileId?: string | null;
}
/** LMS-23: a borrower-reachable cover image for a title (served by the library plugin, not files.store). */
export const libraryBookCoverUrl = (id: string) => `/plugins/library/books/${id}/cover`;
export interface LibraryLoan {
  id: string; bookTitle: string; bookCode: string;
  borrowerName?: string; studentName?: string; studentGrade?: string; studentSection?: string;
  borrowerType?: 'student' | 'staff'; issuedAt: string; dueOn: string; returnedAt: string | null;
  fineCents: number; renewalCount?: number; status: string; overdue?: boolean;
}
export interface LibraryReservation {
  id: string; status: string; queue_no?: number | null; requested_at?: string; ready_at?: string | null;
  expires_at?: string | null; title?: string; author?: string; book_code?: string; borrower_name?: string | null;
}
export interface LibraryFine {
  id: string; cause: string; amount_cents: number; status: string; assessed_at?: string;
  settled_at?: string | null; book_title?: string | null; borrower_name?: string | null;
}
export interface LibraryAcq {
  id: string; title: string; author?: string | null; isbn?: string | null; note?: string | null;
  status: string; vote_count: number; created_at?: string; decision_note?: string | null; added_book_id?: string | null;
}

/* borrower */
export const libraryCatalog = (search?: string) =>
  apiGet<{ books: LibraryBook[] }>(`/plugins/library/catalog${search ? `?search=${encodeURIComponent(search)}` : ''}`);
export const libraryBook = (id: string) => apiGet<{ book: LibraryBook & { queue: number } }>(`/plugins/library/catalog/${id}`);
export const libraryReserve = (bookId: string) => apiPost<{ ok: boolean }>('/plugins/library/reservations', { bookId });
export const libraryMyReservations = () => apiGet<{ reservations: LibraryReservation[] }>('/plugins/library/reservations/mine');
export const libraryCancelReservation = (id: string) => apiDelete<{ ok: boolean }>(`/plugins/library/reservations/${id}`);
export const libraryMyLoans = () => apiGet<{ loans: LibraryLoan[] }>('/plugins/library/loans/mine');
export const libraryRenewRequest = (id: string) => apiPost<{ ok: boolean; dueOn: string }>(`/plugins/library/loans/${id}/renew-request`, {});
export const libraryMyFines = () => apiGet<{ fines: LibraryFine[] }>('/plugins/library/fines/mine');
export const libraryMyRequests = () => apiGet<{ requests: LibraryAcq[] }>('/plugins/library/acquisitions/mine');
export const libraryRequestBook = (input: { title: string; author?: string; isbn?: string; note?: string }) =>
  apiPost<{ ok: boolean; request?: LibraryAcq; requestId?: string; voted?: boolean }>('/plugins/library/acquisitions', input);
export const libraryVote = (id: string) => apiPost<{ ok: boolean; voted: boolean }>(`/plugins/library/acquisitions/${id}/vote`, {});

/* desk (librarian) */
export interface LibraryDeskOverview {
  onLoan: number; overdue: number; holdsReady: number; holdsWaiting: number;
  available: number; copies: number; unavailable: number;
  purchaseRequests: number; acquisitionVotes: number;
  outstandingFines: number; outstandingCents: number; collectedCents: number; waivedCents: number;
  issuedToday: number; returnedToday: number;
  members: { students: number; staff: number };
  recent: Array<{ id: string; status: string; due_on: string; issued_at: string; returned_at: string | null; fine_cents: number; borrower_type: string; book_title: string; book_code: string; borrower: string | null }>;
}
export interface LibraryBorrower {
  id: string; type: 'student' | 'staff'; name: string; identifier: string;
  grade?: string; section?: string; role?: string; openLoans: number; duesCents: number;
}
export interface LibraryCopy {
  id: string; copy_code: string; barcode?: string | null; accession_no?: string | null; status: string;
  condition?: string | null; title: string; book_code: string; borrower?: string | null; due_on?: string | null;
}
export interface LibraryDeskBookDetail {
  book: LibraryBook & { issued: number; unavailable: number; holds: number };
  copies: LibraryCopy[];
  openLoans: Array<{ id: string; due_on: string; borrower_type: string; borrower: string | null; copy_code: string }>;
}
export interface LibraryDeskSettings {
  default_loan_days?: number; loan_days_student?: number; loan_days_teacher?: number; loan_days_staff?: number;
  max_loans_student?: number; max_loans_teacher?: number; max_loans_staff?: number;
  renewal_limit?: number; renewal_days?: number; allow_self_reserve?: boolean; max_reservations?: number;
  reservation_hold_days?: number; allow_acquisition_requests?: boolean; acquisition_votes?: boolean;
  max_open_acquisition_requests?: number; grace_days?: number; fine_per_day_cents?: number;
  fine_cap_cents?: number; lost_charge_percent?: number; damage_charge_cents?: number; allow_fine_waiver?: boolean;
  notify_channels?: string[]; notify_parent?: boolean; due_reminder_days_before?: number[];
  overdue_repeat_days?: number; quiet_hours_ist?: number[];
}

export const libraryDeskOverview = () => apiGet<LibraryDeskOverview>('/plugins/library/desk/overview');
export const libraryDeskBooks = (search?: string) => apiGet<{ books: LibraryBook[]; hasMore?: boolean }>(`/plugins/library/desk/books${search ? `?search=${encodeURIComponent(search)}` : ''}`);
export const libraryDeskBook = (id: string) => apiGet<LibraryDeskBookDetail>(`/plugins/library/desk/books/${id}`);
export const libraryAddBook = (input: Record<string, unknown>) => apiPost<{ bookId: string; book: { id: string; code: string; title: string; copies: number } }>('/plugins/library/books', input);
export const libraryAddCopies = (bookId: string, copies: number) => apiPost<{ added: number; codes: string[] }>(`/plugins/library/books/${bookId}/copies`, { copies });
export const libraryRetireBook = (bookId: string) => apiPost<{ ok: boolean }>(`/plugins/library/books/${bookId}/retire`, {});
export const libraryIssue = (input: { bookId: string; studentId?: string; userId?: string; dueOn?: string }) =>
  apiPost<{ loanId: string; dueOn: string; copy: string; loan: LibraryLoan }>('/plugins/library/loans', input);
export const libraryReturn = (loanId: string, condition?: 'ok' | 'damaged') =>
  apiPost<{ fineCents: number; daysOverdue: number }>(`/plugins/library/loans/${loanId}/return`, condition ? { condition } : {});
export const libraryRenew = (loanId: string) => apiPost<{ dueOn: string }>(`/plugins/library/loans/${loanId}/renew`, {});
export const libraryLoans = (state: 'open' | 'all' = 'open') => apiGet<{ loans: LibraryLoan[] }>(`/plugins/library/loans?state=${state}`);
export const libraryOverdue = () => apiGet<{ loans: LibraryLoan[] }>('/plugins/library/overdue');
export const libraryHolds = () => apiGet<{ reservations: LibraryReservation[] }>('/plugins/library/reservations');
export const libraryCancelHold = (id: string) => apiPost<{ ok: boolean }>(`/plugins/library/reservations/${id}/cancel`, {});
export const libraryFulfilHold = (id: string) => apiPost<{ ok: boolean; hint: string }>(`/plugins/library/reservations/${id}/fulfil`, {});
export const libraryMembers = (f: { search?: string; type?: 'student' | 'staff' | 'all'; grade?: string; section?: string; limit?: number } = {}) => {
  const p = new URLSearchParams();
  if (f.search) p.set('search', f.search);
  if (f.type && f.type !== 'all') p.set('type', f.type);
  if (f.grade) p.set('grade', f.grade);
  if (f.section) p.set('section', f.section);
  if (f.limit) p.set('limit', String(f.limit));
  const qs = p.toString();
  return apiGet<{ students: Array<{ id: string; name: string; admission_no: string; grade: string; section: string; open_loans: number; dues_cents: number }>; staff: Array<{ id: string; name: string; role: string; open_loans: number; dues_cents: number }>; borrowers: LibraryBorrower[]; filters: { type: string; grade: string | null; section: string | null }; hasMore?: boolean }>(`/plugins/library/members${qs ? `?${qs}` : ''}`);
};
export const libraryFines = (status?: string) => apiGet<{ fines: LibraryFine[] }>(`/plugins/library/fines${status ? `?status=${status}` : ''}`);
export const librarySettleFine = (id: string, action: 'pay' | 'waive', note?: string) => apiPost<{ status: string }>(`/plugins/library/fines/${id}/settle`, { action, note });
export const libraryAcquisitions = (status?: string) => apiGet<{ requests: LibraryAcq[] }>(`/plugins/library/acquisitions${status ? `?status=${status}` : ''}`);
export const libraryDecideAcq = (id: string, decision: 'approve' | 'reject' | 'ordered' | 'added', note?: string) =>
  apiPost<{ status: string; addedBookId: string | null }>(`/plugins/library/acquisitions/${id}/decide`, { decision, note });
export const libraryDeskSettingsGet = () => apiGet<{ settings: LibraryDeskSettings }>('/plugins/library/desk/settings');
export const libraryDeskSettingsSave = (body: Partial<LibraryDeskSettings>) =>
  apiPut<{ ok: boolean; settings: LibraryDeskSettings }>('/plugins/library/desk/settings', body as Record<string, unknown>);
export const libraryNotifSettings = (body: Record<string, unknown>) =>
  apiPut<{ ok: boolean }>('/plugins/library/desk/settings/notifications', body);
export const libraryCopies = () => apiGet<{ copies: LibraryCopy[]; symbology: string; identifierLabel: string }>('/plugins/library/copies');
export const librarySetCopy = (id: string, body: { status?: string; condition?: string }) =>
  apiPatch<{ ok: boolean }>(`/plugins/library/copies/${id}`, body);
export const libraryUpdateBook = (id: string, body: Record<string, unknown>) =>
  apiPatch<{ ok: boolean }>(`/plugins/library/books/${id}`, body);
export type LibraryReportKind = 'circulation' | 'overdue' | 'most-borrowed' | 'dead-stock' | 'inventory' | 'acquisitions';
export const libraryReports = (kind: LibraryReportKind, days = 30) =>
  apiGet<{ kind: string; rows: Array<Record<string, unknown>> }>(`/plugins/library/reports/${kind}?days=${days}`);

/* ops (librarian/owner/principal) */
export const libraryOps = (days = 30) => apiGet<{
  period: { days: number };
  totals: { titles: number; copies: number; available: number; onLoan: number; loansPeriod: number; overdue: number; utilizationPct: number; readerPenetrationPct: number; deadStock: number; costPerCirculationCents: number; collectionValueCents: number; fines: { outstanding: number; collected: number; waived: number } };
  trend: Array<{ day: string; loans: number }>;
  topTitles: Array<{ title: string; loans: number }>;
  overdueAging: Array<{ bucket: string; n: number }>;
  holds: { waiting: number; ready: number };
  acquisition: { open_requests: number; votes: number };
  collectionHealth: { lost: number; damaged: number; withdrawn: number };
}>(`/plugins/library/ops/overview?days=${days}`);

/* ---------- files.store ---------- */

export interface StoredFile {
  id: string; filename: string; mime: string; bytes: number; scope: string; createdAt: string;
}
export async function filesList(params: { scope?: string; refId?: string } = {}): Promise<{ files: StoredFile[] }> {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return apiGet(`/plugins/files.store${q ? `?${q}` : ''}`);
}
export async function filesUploadBase64(input: {
  filename: string; mime: string; dataBase64: string; scope: string; refId?: string;
}): Promise<{ file: StoredFile }> {
  return apiPost('/plugins/files.store/upload', input);
}
export const fileDownloadUrl = (id: string) => `/plugins/files.store/${id}/download`;
