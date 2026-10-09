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

/* School profile — the tenant identity card. Same keys the signup door accepts
   and POST /onboard/school patches; GET /school/profile reads them back. */
export interface SchoolProfileFields {
  address: string; city: string; state: string; postalCode: string; country: string;
  board: string; phone: string; email: string; website: string; timezone: string;
}
export interface SchoolProfile {
  name: string; slug: string; onboardedAt: string | null; profile: SchoolProfileFields;
}
export type SchoolProfilePatch = { schoolName?: string } & Partial<SchoolProfileFields>;

export async function apiSignup(body: {
  schoolName: string; address?: string; city?: string; state?: string; postalCode?: string; country?: string;
  board?: string; phone?: string; email?: string; website?: string; timezone?: string;
  ownerName: string; ownerEmail: string; ownerPassword: string; ownerPhone?: string;
}): Promise<SignupOk> {
  const r = await apiPost<SignupOk>('/onboard/signup', body);
  setToken(r.token); // the owner is signed in the moment their school exists
  return r;
}

export const apiSchoolProfile = () => apiGet<{ school: SchoolProfile }>('/school/profile');

export const apiOnboardSchool = (body: SchoolProfilePatch) =>
  apiPost<{ ok: boolean; school: { name: string; config: Record<string, unknown> } }>('/onboard/school', body);

/* Setup guide (Part 1: the people chain) — one read for the /setup screen:
   each staffing stage with its live done-flag and count. Owner, principal and
   IT admin only (server-gated); every stage's write door re-gates. */
export interface SetupStage {
  id: string; label: string; hint: string; done: boolean; count?: number; href?: string;
}
export interface SetupGuide {
  school: { name: string | null; slug: string | null };
  stages: SetupStage[];
}
export const apiSetupStages = () => apiGet<SetupGuide>('/school/setup');

export const apiOnboardStatus = () => apiGet<OnboardStatus>('/onboard/status');
