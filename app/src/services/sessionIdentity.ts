/* The signed-in human's identity from the live /me answer.
   The demo roster (store.tsx demoAccounts) is mock-mode flavor only — a REAL
   school owner must never be labeled with a demo persona (Vikram Mehta).
   AuthGate writes here on every live /me; the store reads it as the first
   choice for actorName, falling back to the demo roster only in mock mode. */
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
