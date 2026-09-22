/* Onboarding service — self-serve school signup (Platform §1.1, migration 053).
   Shares the single fetch brain: one token source, one 401 path. */
import { apiGet, apiPost, apiPut, setToken } from './liveApi';

/* School classes & sections (school structure). Read is open to any signed-in caller so class
   pickers can render; the write door is owner/principal/IT admin (server-enforced). */
export interface SchoolClass { grade: string; sections: string[] }
export const apiSchoolClasses = () => apiGet<{ classes: SchoolClass[] }>('/school/classes');
export const apiSaveSchoolClasses = (classes: SchoolClass[]) =>
  apiPut<{ ok: boolean; classes: SchoolClass[] }>('/school/classes', { classes });

/* Subjects (F3) — the school's own list, the real references behind free-text subject columns. */
export interface SchoolSubject { id: string; name: string; code: string | null }
export const apiSchoolSubjects = () => apiGet<{ subjects: SchoolSubject[] }>('/school/subjects');
export const apiAddSchoolSubject = (name: string, code?: string) =>
  apiPost<{ subject: SchoolSubject }>('/school/subjects', { name, code });

export interface SignupOk {
  token: string;
  user: { id: string; name: string; role: string; email: string; tenantId: string };
  tenant: { id: string; slug: string; name: string };
}
export interface OnboardStatus {
  school: { name: string; slug: string; onboardedAt: string | null; sections: { grade: string; sections: string[] }[] };
  counts: { students: number; itadmins: number; accounts: number; plugins_enabled: number };
  checklist: { id: string; label: string; done: boolean; href: string }[];
}

export async function apiSignup(body: {
  schoolName: string; address?: string; board?: string; phone?: string;
  ownerName: string; ownerEmail: string; ownerPassword: string;
}): Promise<SignupOk> {
  const r = await apiPost<SignupOk>('/onboard/signup', body);
  setToken(r.token); // the owner is signed in the moment their school exists
  return r;
}

export const apiOnboardSchool = (body: { schoolName?: string; address?: string; board?: string; phone?: string }) =>
  apiPost<{ ok: boolean; school: { name: string; config: Record<string, unknown> } }>('/onboard/school', body);

export const apiOnboardStatus = () => apiGet<OnboardStatus>('/onboard/status');
