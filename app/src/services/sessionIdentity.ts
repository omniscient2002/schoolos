/* The signed-in human's identity from the live /me answer.
   This is the ONLY actor name — a real school owner must never be labeled
   with a demo persona. AuthGate writes here on every live /me; the store
   reads it for actorName. */
let name: string | null = null;
let email: string | null = null;

export function setSessionIdentity(u: { name: string; email: string } | null): void {
  name = u?.name ?? null;
  email = u?.email ?? null;
}

export function sessionUserName(): string | null {
  return name;
}

export function sessionUserEmail(): string | null {
  return email;
}
