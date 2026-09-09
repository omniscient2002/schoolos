/* ============================================================
   adminApi — people.admin + library + files.store client.
   One function per server door; every screen below calls these,
   never fetch() directly. Shapes mirror the plugin doors 1:1.
   ============================================================ */
import { apiGet, apiPost } from './liveApi';

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

/* ---------- library ---------- */

export interface LibraryBook {
  id: string; code: string; title: string; author: string; category: string;
  copiesTotal: number; copiesOut: number; status: string;
}
export interface LibraryLoan {
  id: string; bookTitle: string; bookCode: string; studentName: string;
  studentGrade: string; studentSection: string; issuedAt: string; dueOn: string;
  returnedAt: string | null; fineCents: number; status: string;
}

export async function libraryBooks(search?: string): Promise<{ books: LibraryBook[] }> {
  return apiGet(`/plugins/library/books${search ? `?search=${encodeURIComponent(search)}` : ''}`);
}
export async function libraryAddBook(input: {
  title: string; author: string; category?: string; copiesTotal: number; code?: string;
}): Promise<{ book: LibraryBook }> {
  return apiPost('/plugins/library/books', input);
}
export async function libraryIssue(input: { bookId: string; studentId: string; dueOn: string }): Promise<{ loan: LibraryLoan }> {
  return apiPost('/plugins/library/loans', input);
}
export async function libraryReturn(loanId: string): Promise<{ loan: LibraryLoan; fineCents: number }> {
  return apiPost(`/plugins/library/loans/${loanId}/return`, {});
}
export async function libraryLoans(state: 'open' | 'all' = 'open'): Promise<{ loans: LibraryLoan[] }> {
  return apiGet(`/plugins/library/loans?state=${state}`);
}
export async function libraryOverdue(): Promise<{ loans: LibraryLoan[] }> {
  return apiGet('/plugins/library/overdue');
}
export async function libraryMyLoans(): Promise<{ loans: LibraryLoan[] }> {
  return apiGet('/plugins/library/loans/mine');
}

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
