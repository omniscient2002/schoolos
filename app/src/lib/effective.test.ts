import { describe, expect, it } from 'vitest';
import { canSurface, ownedClasses } from './effective';

describe('effective access render gates', () => {
  it('honours the server decision for known surfaces and fails closed on unknown ones', () => {
    const effective = { role: 'teacher', capabilities: { '/attendance': true, '/roles': false, '/people/:id': false } };
    expect(canSurface(effective, '/attendance')).toBe(true);
    expect(canSurface(effective, '/roles')).toBe(false);
    expect(canSurface(effective, '/people/123')).toBe(false);
    expect(canSurface(effective, '/new-plugin-screen')).toBe(false);
    // no server answer yet → the server still enforces, so the client does not hide the screen
    expect(canSurface(undefined, '/new-plugin-screen')).toBe(true);
  });

  it('a nested route inherits its section surface, and the longest prefix wins', () => {
    // the desk's pages are all the librarian's desk; the server names the section (/library/desk)
    const effective = { role: 'librarian', capabilities: { '/library': false, '/library/desk': true, '/library/desk/settings': false } };
    expect(canSurface(effective, '/library/desk/issue')).toBe(true);
    expect(canSurface(effective, '/library/desk/catalog/new')).toBe(true);
    // an exact entry still wins over the inherited section decision
    expect(canSurface(effective, '/library/desk/settings')).toBe(false);
    // the longest prefix wins: /library/anything inherits the DENIED /library, not /library/desk
    expect(canSurface(effective, '/library/anything')).toBe(false);
  });

  it('returns only the server-provided class scope', () => {
    expect(ownedClasses({ role: 'teacher', scope: { classes: [{ grade: '5', section: 'A' }] } }))
      .toEqual([{ grade: '5', section: 'A' }]);
    expect(ownedClasses({ role: 'principal' })).toEqual([]);
  });
});
