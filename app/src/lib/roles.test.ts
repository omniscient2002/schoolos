import { describe, expect, it } from 'vitest';
import { homeForRole, mapAccountRole, isLightRole } from './roles';

describe('homeForRole — each role lands on its own main page', () => {
  it('sends the roles the server gates off /today to their own workspace', () => {
    // /today is behind GET /actions, which these roles do not hold
    expect(homeForRole('parent')).toBe('/parent/family');
    expect(homeForRole('student')).toBe('/student/home2');
    expect(homeForRole('librarian')).toBe('/library/desk');
    // technician holds /today but has no Today item in its nav
    expect(homeForRole('technician')).toBe('/maintenance/technician');
  });

  it('keeps /today for every role whose nav starts there', () => {
    for (const role of [
      'owner', 'principal', 'teacher', 'coordinator', 'counselor', 'finance',
      'finance_head', 'finance_clerk', 'admissions', 'transport', 'facilities', 'itadmin',
    ]) {
      expect(homeForRole(role)).toBe('/today');
    }
  });

  it('fails closed to the lightest surface for an unknown role', () => {
    // mapAccountRole maps unknown → student, so an unlisted role gets the calm surface, never a staff one
    expect(mapAccountRole('mystery-role')).toBe('student');
    expect(homeForRole('mystery-role')).toBe('/student/home2');
    expect(homeForRole(null)).toBe('/student/home2');
    expect(isLightRole('mystery-role')).toBe(true);
  });
});
