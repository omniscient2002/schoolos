#!/usr/bin/env node
/* OPS-3 — the alerting probe.
 *
 * The register's finding was not "the metrics are missing"; it was that NOTHING WATCHES THEM. The only
 * outputs in this system were stdout lines, four workers are log-identical when idle and when dead
 * (`outbox-worker.js:106-107`, `webhook-worker.js:162`, `workflow-worker.js:103`,
 * `comms-dispatcher.js:296-297`), and the relay's own healthcheck is deliberately disabled because the
 * image-level probe targets a port no worker listens on. So "the event spine died" and "the event spine
 * has nothing to do" looked the same from every instrument the project had.
 *
 * This is the missing instrument, and it is deliberately the shape this repo already trusts: a one-shot
 * whose EXIT CODE is the signal (backup.sh: "mail on failure, silence on success"; retention-worker.js:
 * "1 = a purge query failed (cron alert)"). Cron mails the output; the operator's MTA is the transport.
 * Inventing a Slack/PagerDuty integration that does not exist would be the same lie class as the
 * fabricated infrastructure telemetry the register names in §5.8.
 *
 * Design rules, and they matter more than the checks:
 *
 *   1. **A check that cannot run is REPORTED, never passed.** If `app.outbox` has no `discovered_at`
 *      column (pre-076 database), the check is `skipped` with a reason — not `ok`. A silently-green probe
 *      is the success-shaped silence this whole document is about.
 *   2. **No fabricated numbers.** Every value comes from a query. There is no default, no fallback zero.
 *   3. **The rules are DATA** (`ops/alerts/schoolos.rules.yml`), so a test can assert that every rule
 *      names a check this file implements and a metric `/metrics` emits — a rule watching a nonexistent
 *      signal then fails the build instead of being discovered mid-incident.
 *
 * Usage:
 *   node server/scripts/health-probe.js                 # human-readable; exit 1 if anything FIRES
 *   node server/scripts/health-probe.js --json          # machine-readable
 *
 * Exit codes: 0 = every rule evaluated and none fired · 1 = at least one rule FIRED · 2 = the probe
 * itself could not run (no database, unreadable rules) — kept distinct from 1 so a broken monitor is
 * never mistaken for a healthy system.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
// `src/config.js` reads DATABASE_URL at import time. Importing it HERE would pin the process to the
// ambient database the moment anything imports this file for its pure helpers (`parseRules`, `CHECKS`,
// `evaluate`) — and `tests/ops-deploy.test.js` does exactly that before calling `setupTestDb()`, which
// then found the module cache already bound to the dev database and the app served the WRONG DB (the
// live `/metrics` suite failed with `relation "auth.login_throttles" does not exist`). Config is loaded
// lazily, inside the CLI branch that actually needs a connection.

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');
export const RULES_PATH = join(REPO_ROOT, 'ops', 'alerts', 'schoolos.rules.yml');

/* ── the rules parser ──────────────────────────────────────────────────────────────────────────────
 * A deliberately small reader for the exact subset the rules file uses: a `rules:` list of mappings
 * with scalar keys and `>-` block-scalar descriptions. This is NOT a YAML implementation and does not
 * pretend to be one — it throws on anything it does not understand, so the file cannot quietly grow a
 * construct this reads wrongly. (The alternative was adding a `yaml` dependency to a server whose
 * package.json deliberately has five, for one file whose shape we control.) */
export function parseRules(text) {
  const rules = [];
  let current = null;
  let blockIndent = null;   // non-null while inside a `>-` block scalar: the REQUIRED deeper indent
  for (const raw of text.split('\n')) {
    if (blockIndent !== null) {
      const indent = raw.length - raw.trimStart().length;
      // A block scalar ends at the first non-empty line that is not indented deeper than its own
      // mapping key. Testing "is it dedented to the key's level" rather than "does it look like a key"
      // is deliberate: the previous version of this function treated ANY line at any depth as a
      // continuation, so the first rule's description absorbed the remaining eight rules and this
      // parser reported "1 rule" for a nine-rule file — a silent undercount in exactly the class of
      // defect the vacuity gate exists to catch (and it was caught by running the parser, not by
      // reading it).
      if (raw.trim() !== '' && indent < blockIndent) { blockIndent = null; }
      else { if (current && raw.trim() !== '') current.description += ' ' + raw.trim(); continue; }
    }
    if (/^\s*#/.test(raw) || raw.trim() === '') continue;
    const listItem = /^(\s*)- (\w+):\s*(.*)$/.exec(raw);
    if (listItem) {
      current = { [listItem[2]]: listItem[3].trim() };
      rules.push(current);
      continue;
    }
    const kv = /^(\s+)(\w+):\s*(.*)$/.exec(raw);
    if (kv && current) {
      const value = kv[3].trim();
      if (value === '>-' || value === '>' || value === '|') {
        current[kv[2]] = '';
        blockIndent = kv[1].length + 1;
        continue;
      }
      current[kv[2]] = value;
      continue;
    }
    if (/^\s*(version|rules):/.test(raw)) continue;
    throw new Error(`health-probe: cannot parse rules line: ${JSON.stringify(raw)}`);
  }
  // OPSX-8: a rule must also name the /metrics series it corresponds to. `parseRules` used to drop
  // `metric:` entirely and `ops-deploy.test.js` carried a hardcoded 5-entry rule→gauge map, so a
  // misspelled gauge in this file was never checked. Every rule now declares one.
  const missing = rules.find((r) => !r.name || !r.check || !r.metric);
  if (missing) throw new Error(`health-probe: every rule needs a name, a check and a metric: ${JSON.stringify(missing)}`);
  return rules.map((r) => ({
    name: r.name,
    check: r.check,
    metric: r.metric,
    severity: r.severity ?? 'warning',
    threshold: Number(r.threshold_gte),
    unlessEnv: r.unless_env ?? null,
    description: (r.description ?? '').trim(),
  }));
}

/* ── checks ────────────────────────────────────────────────────────────────────────────────────────
 * Each check is `(q) => { value, skipped?, reason? }`. `q` is an owner-path query function because every
 * signal here is deliberately CROSS-TENANT: an ops gauge that silently narrowed to one school would
 * report a clean bill of health for the fleet while every other tenant's messages went nowhere (the
 * reasoning already recorded for the /metrics gauges in src/app.js). */
export const CHECKS = {
  /** Events older than 15 minutes that are neither processed nor parked: the relay is not draining. */
  async outbox_stuck(q) {
    const r = await q(`SELECT count(*)::int n FROM app.outbox
                        WHERE processed_at IS NULL AND parked_at IS NULL
                          AND created_at < now() - interval '15 minutes'`);
    return { value: r.rows[0].n };
  },
  /** The relay gave up. Terminal — needs a human, not a retry. */
  async outbox_parked(q) {
    const r = await q(`SELECT count(*)::int n FROM app.outbox WHERE parked_at IS NOT NULL`);
    return { value: r.rows[0].n };
  },
  /** The webhook fan-out has not claimed these (076's state column, unread until now). */
  async webhook_undiscovered(q) {
    const present = await q(`SELECT 1 FROM information_schema.columns
                              WHERE table_schema='app' AND table_name='outbox' AND column_name='discovered_at'`);
    if (!present.rows[0]) return { skipped: 'app.outbox.discovered_at absent — migration 076 not applied' };
    const r = await q(`SELECT count(*)::int n FROM app.outbox
                        WHERE discovered_at IS NULL AND created_at < now() - interval '15 minutes'`);
    return { value: r.rows[0].n };
  },
  /* DAT-3 · discovered but never DELIVERED — the stage `webhook_undiscovered` cannot see.
   *
   * `webhook_undiscovered` catches events the fan-out never scanned. It says nothing about events the
   * fan-out scanned, queued a subscriber delivery for, and then failed to deliver — because that state lives
   * in `app.webhook_deliveries`, not in `app.outbox`. Combined with `outbox_pending` going to 0 the moment the
   * log relay emits, a school's integrations could be receiving nothing at all while every gauge an operator
   * had access to read zero. That is the DAT-3 blind spot and this is the check that closes it. */
  async webhook_undelivered(q) {
    const present = await q(`SELECT 1 FROM information_schema.tables
                              WHERE table_schema='app' AND table_name='webhook_deliveries'`);
    if (!present.rows[0]) return { skipped: 'app.webhook_deliveries absent — not migrated' };
    const r = await q(`SELECT
        (SELECT count(*)::int FROM app.webhook_deliveries WHERE status='failed') AS failed,
        (SELECT count(*)::int FROM app.webhook_deliveries
          WHERE status='queued' AND created_at < now() - interval '10 minutes'
            AND (next_attempt_at IS NULL OR next_attempt_at < now() - interval '10 minutes')) AS stalled
      `);
    // OPSX-16: the age grace (`created_at < now() - 10m`) prevents a just-queued delivery with a NULL
    // next_attempt_at from firing the alert on the very first poll — it is due, not stalled.
    const { failed, stalled } = r.rows[0];
    return { value: failed + stalled, failed, stalled };
  },
  /** The workflow runner is dead: configured rules are never evaluated. */
  async workflow_unscanned(q) {    const present = await q(`SELECT 1 FROM information_schema.columns
                              WHERE table_schema='app' AND table_name='outbox' AND column_name='workflow_scanned_at'`);
    if (!present.rows[0]) return { skipped: 'app.outbox.workflow_scanned_at absent — migration 076 not applied' };
    const r = await q(`SELECT count(*)::int n FROM app.outbox
                        WHERE workflow_scanned_at IS NULL AND created_at < now() - interval '15 minutes'`);
    return { value: r.rows[0].n };
  },
  async comms_stuck(q) {
    const r = await q(`SELECT count(*)::int n FROM app.communications
                        WHERE status='queued' AND created_at < now() - interval '15 minutes'`);
    return { value: r.rows[0].n };
  },
  async comms_failed(q) {
    const r = await q(`SELECT count(*)::int n FROM app.communications WHERE status='failed'`);
    return { value: r.rows[0].n };
  },
  /** Recorded 'sent' by a carrier that only writes a log line — reached nobody. */
  async comms_sandbox_sent(q) {
    const r = await q(`SELECT count(*)::int n FROM app.communications
                        WHERE status='sent' AND lower(COALESCE(provider,'')) IN ('logger','log-only','')`);
    return { value: r.rows[0].n };
  },
  /** The only process-liveness timestamp in the schema (written every 60s by src/app.js).
   *  OPSX-5: read ONLY the API-owned rows. `max(updated_at)` over the whole table was wrong because the
   *  nightly backup writes `backup_last_success_epoch` into the same table — so a dead API looked fresh
   *  for ~24h after each backup. `requests_total`/`errors_total` are the rows app.js flushes every 60s. */
  async api_heartbeat_age_seconds(q) {
    const r = await q(`SELECT COALESCE(EXTRACT(EPOCH FROM (now() - max(updated_at)))::int, NULL) AS age
                         FROM app.ops_counters WHERE name IN ('requests_total','errors_total')`);
    const age = r.rows[0]?.age;
    if (age === null || age === undefined) {
      return { skipped: 'app.ops_counters is empty — the API has not flushed its heartbeat yet (60s cadence)' };
    }
    return { value: age };
  },
  /** OPS-6: "no successful backup in 26h" only means something once something records one. */
  async backup_age_seconds(q) {
    const r = await q(`SELECT value FROM app.ops_counters WHERE name='backup_last_success_epoch'`);
    const epoch = r.rows[0]?.value;
    if (epoch === null || epoch === undefined) {
      return { skipped: 'no backup_last_success_epoch row — scripts/backup.sh has not completed a run here' };
    }
    return { value: Math.max(0, Math.floor(Date.now() / 1000) - Number(epoch)) };
  },
  /** FEE-OPS-2: payments the reconciliation sweep could not match to the rail (ghost/missing/orphan/
   *  amount-mismatch). A non-zero reading means the money ledger and the gateway disagree — the one
   *  class of money error a school must never discover from a parent. */
  async fee_reconciliation_discrepancies(q) {
    const present = await q(`SELECT 1 FROM information_schema.columns
                              WHERE table_schema='app' AND table_name='payments' AND column_name='reconciliation_status'`);
    if (!present.rows[0]) return { skipped: 'app.payments.reconciliation_status absent — migration 109 not applied' };
    const r = await q(`SELECT count(*)::int n FROM app.payments WHERE reconciliation_status='disputed'`);
    return { value: r.rows[0].n };
  },
  /* FEE-OPS-3: the fee SLOs — the three latencies a collection operation is judged on. Each is a gauge in
   * seconds; the rules below carry the thresholds. */
  /** Settlement latency: the slowest initiation→confirmation in the last 24h. */
  async fee_settlement_latency_seconds(q) {
    const r = await q(`SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (confirmed_at - created_at))), 0)::int AS v
                         FROM app.payments WHERE status IN ('confirmed','refunded')
                           AND confirmed_at > now() - interval '24 hours'`);
    return { value: r.rows[0].v };
  },
  /** Dunning queue age: how long the oldest fee reminder has sat undelivered. */
  async fee_dunning_queue_age_seconds(q) {
    const r = await q(`SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at))), 0)::int AS v
                         FROM app.communications WHERE status='queued' AND template LIKE 'FEE%'`);
    return { value: r.rows[0].v };
  },
  /** Reconciliation age: how long the oldest disputed payment has been waiting for a human. */
  async fee_reconciliation_age_seconds(q) {
    const r = await q(`SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(confirmed_at))), 0)::int AS v
                         FROM app.payments WHERE reconciliation_status='disputed' AND confirmed_at IS NOT NULL`);
    return { value: r.rows[0].v };
  },
  /* LIB-E1: the library domain's own failure modes. Each is a cross-tenant count of rows that should
   * not exist if the desk and the day-worker are healthy. They are deliberately counts, not thresholds on
   * ordinary activity (a school always has SOME overdue books); see the rule descriptions. */
  /** Ready holds past their expiry: the expiry sweep did not run, so the queue is stalled. */
  async library_holds_stalled(q) {
    const present = await q(`SELECT 1 FROM information_schema.tables WHERE table_schema='library' AND table_name='reservation'`);
    if (!present.rows[0]) return { skipped: 'library.reservation absent — migration 108 not applied' };
    const r = await q(`SELECT count(*)::int n FROM library.reservation
                        WHERE status='ready' AND expires_at IS NOT NULL AND expires_at < now()`);
    return { value: r.rows[0].n };
  },
  /** Loans more than 30 days overdue: an ordinary overdue count is normal; a chronic backlog is not. */
  async library_overdue_chronic(q) {
    const present = await q(`SELECT 1 FROM information_schema.tables WHERE table_schema='library' AND table_name='loan'`);
    if (!present.rows[0]) return { skipped: 'library.loan absent — migration 108 not applied' };
    const r = await q(`SELECT count(*)::int n FROM library.loan
                        WHERE status='issued'
                          AND due_on < ('now'::timestamptz AT TIME ZONE 'UTC')::date - 30`);
    return { value: r.rows[0].n };
  },
  /** Outstanding fines older than 180 days: the desk has stopped recovering the money. */
  async library_fines_stale(q) {
    const present = await q(`SELECT 1 FROM information_schema.tables WHERE table_schema='library' AND table_name='fine'`);
    if (!present.rows[0]) return { skipped: 'library.fine absent — migration 108 not applied' };
    const r = await q(`SELECT count(*)::int n FROM library.fine
                        WHERE status='outstanding' AND assessed_at < now() - interval '180 days'`);
    return { value: r.rows[0].n };
  },
  /** Open wellbeing requests older than 7 days: the counselor plane is not being worked. */
  async wellbeing_stalled(q) {
    const present = await q(`SELECT 1 FROM information_schema.tables WHERE table_schema='student' AND table_name='wellbeing_request'`);
    if (!present.rows[0]) return { skipped: 'student.wellbeing_request absent — migration 036 not applied' };
    const r = await q(`SELECT count(*)::int n FROM student.wellbeing_request
                        WHERE status <> 'resolved' AND created_at < now() - interval '7 days'`);
    return { value: r.rows[0].n };
  },
  /** Submissions waiting for review older than 7 days: the teacher inbox is backing up. */
  async homework_backlog(q) {
    const present = await q(`SELECT 1 FROM information_schema.tables WHERE table_schema='teacher' AND table_name='submission'`);
    if (!present.rows[0]) return { skipped: 'teacher.submission absent — migration 031 not applied' };
    const r = await q(`SELECT count(*)::int n FROM teacher.submission
                        WHERE status IN ('submitted','late') AND submitted_at < now() - interval '7 days'`);
    return { value: r.rows[0].n };
  },
  /** Files on disk that the registry does not record as applied: the DB is behind the code. */
  async migrations_pending(q) {
    const { readdirSync } = await import('node:fs');
    const dir = join(HERE, '..', 'migrations');
    const onDisk = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    const r = await q(`SELECT name FROM app.schema_migrations`);
    const applied = new Set(r.rows.map((x) => x.name));
    return { value: onDisk.filter((f) => !applied.has(f)).length };
  },
  /** OPP-OVR-3: open decisions past their deadline — the approval spine is not being worked. */
  async open_actions_overdue(q) {
    const r = await q(`SELECT count(*)::int n FROM app.actions
                        WHERE status='open' AND deadline IS NOT NULL AND deadline < now()`);
    return { value: r.rows[0].n };
  },
  /** OPP-PRD-5: statutory compliance items not filed and past due — a governance deadline missed. */
  async compliance_overdue(q) {
    const present = await q(`SELECT 1 FROM information_schema.tables
                              WHERE table_schema='app' AND table_name='compliance_items'`);
    if (!present.rows[0]) return { skipped: 'app.compliance_items absent — migration 116 not applied' };
    const r = await q(`SELECT count(*)::int n FROM app.compliance_items
                        WHERE status <> 'filed' AND due_on < ('now' AT TIME ZONE 'Asia/Kolkata')::date`);
    return { value: r.rows[0].n };
  },
};

/* ── the evaluator (pure, so it is testable without a database) ──────────────────────────────────── */
export function evaluate(rule, result, env = process.env.NODE_ENV ?? 'development') {
  if (rule.unlessEnv && env === rule.unlessEnv) {
    return { ...rule, status: 'skipped', reason: `not evaluated in ${env} (rules file scopes this away)` };
  }
  if (result.skipped) return { ...rule, status: 'skipped', reason: result.skipped };
  const fired = Number(result.value) >= rule.threshold;
  return { ...rule, status: fired ? 'fired' : 'ok', value: result.value };
}

/* ── the run loop ──────────────────────────────────────────────────────────────────────────────────
 * Exported (not inlined into the CLI block) so a test can drive the REAL rules file through the REAL
 * checks against the REAL database and assert the outcome — including the two states that matter most:
 * a rule whose check does not exist must be an ERROR (exit 2), never a silent pass, and a check whose
 * column is missing must be SKIPPED (reported), never `ok`. A monitor that cannot run must not read as
 * "all clear" — that is the success-shaped silence this whole register is about. */
export async function runProbe({ q, env = process.env.NODE_ENV ?? 'development', rulesPath = RULES_PATH } = {}) {
  const rules = parseRules(readFileSync(rulesPath, 'utf8'));
  const results = [];
  for (const rule of rules) {
    const fn = CHECKS[rule.check];
    if (!fn) { results.push({ ...rule, status: 'error', reason: `no such check: ${rule.check}` }); continue; }
    if (!Number.isFinite(rule.threshold)) {
      results.push({ ...rule, status: 'error', reason: `threshold_gte is not a number: ${rule.threshold}` });
      continue;
    }
    try {
      results.push(evaluate(rule, await fn(q), env));
    } catch (e) {
      results.push({ ...rule, status: 'error', reason: String(e.message ?? e) });
    }
  }
  const by = (s) => results.filter((r) => r.status === s);
  return { rules: results, fired: by('fired'), errored: by('error'), skipped: by('skipped'), ok: by('ok') };
}

/** 0 = all evaluated, none firing · 1 = at least one FIRED · 2 = the monitor could not run. */
export const exitCodeFor = ({ fired, errored }) => (errored.length ? 2 : fired.length ? 1 : 0);

/* ── main ────────────────────────────────────────────────────────────────────────────────────────── */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const asJson = process.argv.includes('--json');
  const { config } = await import('../src/config.js'); // lazy: only the CLI needs the DB target
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
  let out;
  try {
    out = await runProbe({ q: (text, params) => pool.query(text, params) });
  } catch (e) {
    console.error(`health-probe: cannot read alert rules (${RULES_PATH}): ${e.message}`);
    await pool.end();
    process.exit(2); // 2, never 1 — a monitor that cannot run is not a healthy system
  }
  await pool.end();
  const { rules: results, fired, errored, skipped } = out;

  if (asJson) {
    console.log(JSON.stringify({ rules: results, fired: fired.length, errored: errored.length, skipped: skipped.length }, null, 2));
  } else {
    for (const r of results) {
      const label = { fired: 'FIRING ', ok: 'ok      ', skipped: 'skipped ', error: 'ERROR   ' }[r.status];
      const detail = r.status === 'ok' || r.status === 'fired'
        ? `${r.value} (threshold >= ${r.threshold})`
        : r.reason;
      console.log(`[${label}] ${String(r.severity).padEnd(8)} ${r.name}: ${detail}`);
      if (r.status === 'fired') console.log(`           ${r.description}`);
    }
    console.log(`\n${results.length} rules: ${fired.length} firing, ${errored.length} error, ${skipped.length} skipped, ${out.ok.length} ok`);
  }
  process.exit(exitCodeFor(out));
}
