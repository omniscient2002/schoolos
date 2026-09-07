// Shared uuid-param guard for plugin :id routes (cycle-6 P2-2; generalizes the kernel
// /actions/:id/decide guard shipped in 027). Non-uuid params must die with a 400 BEFORE
// reaching any `WHERE id=$1` cast (a raw Postgres 22P02 → 500 otherwise).
// Usage: { preHandler: [require(...TIERS), uuidParams('id'), lifecycleGate] }
// Multi-param doors: uuidParams('id', 'studentId').
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParams(...names) {
  const list = names.length ? names : ['id'];
  return async function uuidParamGuard(req, reply) {
    for (const n of list) {
      if (!UUID_RE.test(String(req.params?.[n] ?? ''))) {
        return reply.code(400).send({ error: `${n} must be a uuid` });
      }
    }
  };
}
