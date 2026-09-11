#!/usr/bin/env node
// Day worker (L2-3.4, Wave 3) — the ONE daily maintenance entry point. Cron-shape:
// runs every step once, then exits (compose one-shot / host cron — never loops).
//
// Steps, in order (each failure is contained — a failing step never blocks the
// rest; every step emits one structured, grep-able JSON line):
//   1. preventive WO generation — STUB: the policy source (asset register +
//      service intervals) is not built yet; this step records the tick and the
//      hook point so the future generator drops in without a worker change.
//   2. tally export summary — aggregates confirmed kernel fee payments for the
//      previous day (the accounting.tally door does the full voucher export on
//      demand; this is the daily book-side sanity line).
//   3. retention — scripts/retention-worker.js pass() (purges + audit archival).
//   4. fee dunning — L1's hook (L1-3.2): money.invoicing/dunning.js is imported
//      defensively; until L1's module lands the step logs `skipped`, never crashes.
//
// Compose cron entry (host cron, one line — the compose service mirrors the
// retention one-shot; S0 wires the service at the next gate):
//   30 3 * * * cd /srv/schoolos/server && /usr/bin/docker compose run --rm day-worker >> /var/log/schoolos-day.log 2>&1
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
const line = (kind, data) => console.log(JSON.stringify({ kind, at: new Date().toISOString(), ...data }));

// ── 1. preventive work-order generation (stub; policy source not built yet) ──
export async function runPreventiveStub() {
  line('day.preventive.tick', { status: 'stub', note: 'preventive WO generation policy not configured — hook point: scripts/day-worker.js runPreventiveStub', generated: 0 });
  return { status: 'stub', generated: 0 };
}

// ── 2. tally export summary (book-side daily sanity line) ────────────────────
export async function runTallySummary() {
  const r = await pool.query(
    `SELECT count(*)::int AS n, COALESCE(sum(amount_cents),0)::bigint AS cents
     FROM app.payments
     WHERE status='confirmed' AND created_at >= date_trunc('day', now()) - interval '1 day'
       AND created_at < date_trunc('day', now())`);
  const { n, cents } = r.rows[0] ?? { n: 0, cents: 0 };
  line('day.tally.summary', { confirmedPayments: n, amountCents: Number(cents), note: 'full voucher export rides POST /plugins/accounting.tally/export (owner/finance)' });
  return { confirmedPayments: n, amountCents: Number(cents) };
}

// ── 3. retention (purges + chain-preserving audit archival) ──────────────────
export async function runRetention() {
  const { pass } = await import('./retention-worker.js');
  const counts = await pass();
  line('day.retention.pass', counts);
  return counts;
}

// ── 4. fee dunning — L1's hook (L1-3.2), defensive import ────────────────────
export async function runDunningHook() {
  try {
    const mod = await import('../src/plugins/money.invoicing/dunning.js');
    if (typeof mod.runDunning !== 'function') throw new Error('runDunning export missing');
    const out = await mod.runDunning({ q: (text, params) => pool.query(text, params) });
    line('day.dunning', { status: 'ok', ...(out && typeof out === 'object' ? out : { result: String(out) }) });
    return { status: 'ok', ...out };
  } catch (e) {
    // L1's module not landed (or failed) — contained skip, never a crashed cron
    line('day.dunning', { status: 'skipped', reason: e.message });
    return { status: 'skipped', reason: e.message };
  }
}

// CLI guard: `node scripts/day-worker.js` runs the whole day; imports get functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const steps = [
    ['preventive', runPreventiveStub],
    ['tally', runTallySummary],
    ['retention', runRetention],
    ['dunning', runDunningHook],
  ];
  let failed = 0;
  for (const [name, fn] of steps) {
    try { await fn(); } catch (e) { failed++; console.error(`day-worker step ${name} failed:`, e.message); }
  }
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
}
