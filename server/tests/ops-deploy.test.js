/* OPS-1 / OPS-2 / OPS-3 / OPS-6 / OPS-8 — the deployment, alerting and scheduling gate.
 *
 * The register's §5.9 findings share one shape: the artifact a real deployment depends on either did not
 * exist or was never invoked, while a document claimed otherwise. That is why the fixes live in files
 * (`docker-compose.yml`, `ops/cron/schoolos.cron`, `ops/alerts/schoolos.rules.yml`,
 * `scripts/backup.sh`) and this file is the thing that reads them.
 *
 * WHAT EACH ASSERTION WOULD HAVE CAUGHT, because a gate that cannot fail is the defect it hunts:
 *
 *   · OPS-1 — `api.command` was `bootstrap.js && migrate.js && …`. Bootstrap's FIRST schema-dependent
 *     statement is `GRANT USAGE ON SCHEMA app`, and schema `app` is created by the migration. On an empty
 *     volume the chain short-circuited, `restart: unless-stopped` crash-looped, and the documented
 *     production start path could not boot a fresh database AT ALL. The assertion below fails on exactly
 *     that string, and on any future re-inversion of it.
 *   · OPS-2 — bootstrap needs a role-admin connection; the compose db service's `POSTGRES_USER` is
 *     `schoolos`, so the `postgres` default it falls back to does not exist in this stack. The suite is
 *     STRUCTURALLY BLIND to this (tests/helpers.js connects as `postgres` over TCP under trust auth and
 *     never sets ADMIN_*), which is precisely why the fix is asserted statically.
 *   · OPS-3 — there was no alerting of any kind, `/metrics` emitted a DUPLICATE SERIES (so a scrape
 *     errored and could not be an alert source at all), and no machine identity could reach it. Each of
 *     those is asserted here, including the duplicate-series defect in the LIVE response rather than by
 *     reading the code that produces it.
 *   · OPS-6 — backups were a script nothing ran, while the README claimed an RPO. The nightly dir also
 *     escaped `umask` because `mkdir` came first. Both asserted.
 *   · OPS-8 — five shipped workers appeared in no compose service and no cron file, so outbound webhooks,
 *     workflow rules, fee dunning and reconciliation silently never ran in a real deployment. The
 *     scheduling assertion is written as an INVARIANT over the scripts directory, not as five hand-listed
 *     checks, so the sixth worker cannot ship unscheduled.
 *
 * HONEST LIMITS, stated rather than implied: none of this proves a CONTAINER boots on an empty volume
 * (that needs a docker daemon — register OPS-14), and none of it proves an alert reaches a human (the
 * transport is the operator's MTA). What it proves is that the ordering, the credentials, the schedule,
 * the rules and the metric names cannot silently regress.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupTestDb, loginAs } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(HERE, '..');
const REPO_ROOT = join(SERVER_ROOT, '..');
const COMPOSE_PATH = join(SERVER_ROOT, 'docker-compose.yml');
const CRON_PATH = join(REPO_ROOT, 'ops', 'cron', 'schoolos.cron');
const RULES_PATH = join(REPO_ROOT, 'ops', 'alerts', 'schoolos.rules.yml');
const BACKUP_PATH = join(SERVER_ROOT, 'scripts', 'backup.sh');

const compose = readFileSync(COMPOSE_PATH, 'utf8');
const cron = readFileSync(CRON_PATH, 'utf8');
const backup = readFileSync(BACKUP_PATH, 'utf8');

/** Split a compose file into service blocks by indentation. A tiny reader beats a YAML dependency here:
 *  `server/package.json` has five dependencies on purpose, and the shapes asserted below are structural
 *  (which service, which key, which command) rather than YAML-semantic. */
function serviceBlocks(text) {
  const out = new Map();
  const lines = text.split('\n');
  let name = null;
  let buf = [];
  for (const line of lines) {
    const svc = /^ {2}([a-z0-9][a-z0-9-]*):\s*$/.exec(line);
    if (svc) {
      if (name) out.set(name, buf.join('\n'));
      name = svc[1];
      buf = [];
      continue;
    }
    if (name) buf.push(line);
  }
  if (name) out.set(name, buf.join('\n'));
  return out;
}

const services = serviceBlocks(compose);
/** Every service whose `command:` runs a given script. */
const servicesRunning = (script) =>
  [...services.entries()].filter(([, body]) => new RegExp(`command:.*${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(body)).map(([n]) => n);

describe('OPS-1 · schema setup runs in the one order that works, on an empty volume', () => {
  test('no service runs bootstrap.js before migrate.js in the same command', () => {
    // THE REGRESSION GATE. On an empty volume bootstrap's `GRANT USAGE ON SCHEMA app` fails (schema
    // absent), `&&` short-circuits, migrate never runs, and the container crash-loops forever — the
    // register's exact chain, reproduced from the old `bootstrap.js && migrate.js` string.
    for (const [name, body] of services) {
      const cmd = /command:\s*(.+)/.exec(body)?.[1] ?? '';
      const iMig = cmd.indexOf('scripts/migrate.js');
      const iBoot = cmd.indexOf('scripts/bootstrap.js');
      if (iMig === -1 || iBoot === -1) continue;
      assert.ok(iMig < iBoot,
        `service "${name}" runs bootstrap.js before migrate.js: ${cmd}\n`
        + 'bootstrap grants on schema `app`, which the migration creates — on an empty volume this '
        + 'fails, short-circuits the && chain, and the container crash-loops.');
    }
  });

  test('the API container no longer runs schema setup at all (ordering is structural, not textual)', () => {
    // The stronger half. Swapping two words fixes today; moving schema setup into its OWN one-shot
    // service means a later edit cannot re-invert the order by reordering one command string — and a
    // rolling deploy no longer has every API replica racing to migrate.
    const api = services.get('api');
    assert.ok(api, 'the api service must exist');
    assert.match(api, /command:\s*node src\/index\.js/,
      'the long-lived API must only serve; schema + grants belong to a one-shot service');
    assert.ok(!/scripts\/migrate\.js/.test(api), 'the API must not run migrations');
    assert.match(api, /db-init:\s*\n\s*condition:\s*service_completed_successfully/,
      'the API must depend on db-init COMPLETING, not on the db merely being up — a healthy database is '
      + 'not a migrated one, which is the whole of OPS-1');
  });

  test('every worker waits for completed schema setup, so a fresh stack cannot poll an empty schema', () => {
    for (const name of ['outbox', 'comms-dispatcher', 'webhook-worker', 'workflow-worker', 'retention']) {
      const body = services.get(name);
      assert.ok(body, `service "${name}" must exist`);
      assert.match(body, /db-init:\s*\n\s*condition:\s*service_completed_successfully/,
        `service "${name}" does not wait for db-init to complete — it would poll a schema that does not `
        + 'exist yet on a fresh stack (the OPS-1 trap in a second place)');
    }
  });

  test('the demo profile migrates before it seeds, and seed is never in the API path', () => {
    const demo = services.get('demo-init');
    assert.ok(demo, 'demo-init must exist');
    const cmd = /command:\s*(.+)/.exec(demo)?.[1] ?? '';
    assert.ok(cmd.indexOf('scripts/migrate.js') < cmd.indexOf('scripts/seed.js'),
      'demo-init must migrate before seeding');
    assert.ok(cmd.indexOf('scripts/bootstrap.js') < cmd.indexOf('scripts/seed.js'),
      'demo-init must bootstrap before seeding');
    assert.ok(!/scripts\/seed\.js/.test(services.get('api') ?? ''),
      'seed.js TRUNCATEs tenant data and must never run in the API service');
  });
});

describe('OPS-2 · compose can authenticate its own schema setup, without superuser creds in the API', () => {
  test('the service running bootstrap declares an admin connection and an explicit app-role password', () => {
    const runners = servicesRunning('scripts/bootstrap.js');
    assert.ok(runners.length > 0, 'something must run bootstrap');
    for (const name of runners) {
      const body = services.get(name);
      assert.match(body, /ADMIN_DATABASE_URL|ADMIN_PASSWORD/,
        `service "${name}" runs bootstrap.js with no admin credential. bootstrap defaults to a \`postgres\` `
        + 'URL, and this stack sets POSTGRES_USER=schoolos — so `postgres` does not exist and it cannot '
        + 'authenticate (OPS-2, recorded verbatim in .github/workflows/ci.yml:22-25).');
      assert.match(body, /APP_ROLE_PASSWORD/,
        `service "${name}" does not pass APP_ROLE_PASSWORD. bootstrap.js then falls back to the literal `
        + "'schoolos_app_pw' for a LOGIN role every RLS policy depends on — a published credential.");
    }
  });

  test('the long-lived API holds no admin credential (least privilege is structural)', () => {
    const api = services.get('api') ?? '';
    assert.ok(!/ADMIN_DATABASE_URL|ADMIN_PASSWORD/.test(api),
      'the api service must not carry the role-admin DSN — only the one-shot schema service needs it');
  });

  test('bootstrap.js no longer ships a default app-role password', () => {
    // Comments are stripped first: the fix's own explanatory comment QUOTES the old default, and an
    // assertion that fires on the documentation of the defect rather than the defect is how a gate
    // teaches people to allowlist it. (This assertion fired on itself the first time it ran — which is
    // the gate doing its job on the gate.)
    const src = readFileSync(join(SERVER_ROOT, 'scripts', 'bootstrap.js'), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/'schoolos_app_pw'/.test(src),
      "bootstrap.js still defaults APP_ROLE_PASSWORD to 'schoolos_app_pw' — a public password on the "
      + 'constrained role that every policy depends on');
    // ...and it must refuse rather than invent one: the positive half of the same claim.
    assert.match(src, /APP_ROLE_PASSWORD/, 'bootstrap must read the password from the environment');
    assert.match(src, /process\.exit\(1\)/,
      'bootstrap must FAIL when the credential is missing, not fall back to a default');
  });
});

describe('OPS-6 · the backup actually runs, and says so', () => {
  test('umask is applied BEFORE the night directory is created', () => {
    // The shipped script did `mkdir -p "$NIGHT_DIR"` and only then `umask 077`, so the directory holding
    // student PII inherited the caller's umask (022 → 0755, world-traversable) while the files inside it
    // were correctly 0600. The README claims owner-only permissions; this makes that true.
    const iUmask = backup.indexOf('umask 077');
    const iMkdir = backup.indexOf('mkdir -p "$NIGHT_DIR"');
    assert.ok(iUmask !== -1, 'backup.sh must set umask 077 (dumps contain child PII)');
    assert.ok(iMkdir !== -1, 'backup.sh must create the night directory');
    assert.ok(iUmask < iMkdir,
      'umask 077 must come BEFORE mkdir — otherwise the directory is created with the caller umask');
  });

  test('a dump is one unit with its globals, and it is verified before it counts', () => {
    // The register's most damaging sentence: the surviving dumps carry no CREATE ROLE, so restoring them
    // "yields policies with no role to enforce them". The fix is that globals and the db dump are written
    // together and each is proven readable.
    assert.match(backup, /pg_dumpall --globals-only/, 'globals (roles, memberships) must be dumped');
    assert.match(backup, /pg_restore --list/, 'a dump must be verified by reading it back');
    assert.match(backup, /set -euo pipefail/, 'a partial failure must abort the night');
  });

  test('a completed night records its own success, so "no backup in 26h" is answerable', () => {
    assert.match(backup, /backup_last_success_epoch/,
      'backup.sh must record the run — without it, health-probe.js cannot distinguish "backed up" from '
      + '"never ran", which is exactly the state OPS-6 describes');
    // and it must be recorded only AFTER the night is marked complete: a last-run row that can be written
    // by a failed run is worse than none, because it makes the alert silently wrong.
    const iComplete = backup.indexOf('rm -f "$NIGHT_DIR/.incomplete"');
    const iRecord = backup.indexOf('backup_last_success_epoch');
    assert.ok(iComplete !== -1 && iRecord > iComplete,
      'the last-run record must be written after the .incomplete marker is cleared');
  });

  test('the committed schedule references backup.sh, and offers no unverified docker shortcut', () => {
    assert.match(cron, /scripts\/backup\.sh/, 'the cron file must actually run the backup');
    // The docker-only one-liner that used to be documented here wrote a flat dump with no globals, no
    // verification and no retention — the artifact shape the register complaints are about. It must not
    // come back as a tempting copy-paste.
    assert.ok(!/docker compose exec -T db pg_dump/.test(backup),
      'backup.sh must not document the equivalent-but-degraded docker-only dump variant');
  });
});

describe('OPS-13 / OPS-19 · shutdown grace and healthcheck noise are decided, not defaulted', () => {
  // OPS-13: the API drains in-flight requests over a 15s window, but Docker SIGKILLs after its default
  // 10s stop grace — so the declared drain could never complete. Any LONG-LIVED service that can hold a
  // request or a row lock during shutdown must set stop_grace_period longer than that window.
  const LONG_LIVED = ['api', 'outbox', 'webhook-worker', 'workflow-worker', 'comms-dispatcher'];

  test('every long-lived service allows its graceful drain to finish before SIGKILL', () => {
    for (const name of LONG_LIVED) {
      const body = services.get(name);
      assert.ok(body, `service "${name}" must exist`);
      const m = /stop_grace_period:\s*(\d+)s/.exec(body);
      assert.ok(m, `service "${name}" sets no stop_grace_period — Docker's 10s default is shorter than the `
        + 'app drain window, so the last of the drain is severed (OPS-13)');
      assert.ok(Number(m[1]) >= 15,
        `service "${name}" stop_grace_period is ${m[1]}s — must exceed the in-flight drain window`);
    }
  });

  test('the retention one-shot disables its healthcheck (the image HEALTHCHECK probes an HTTP port)', () => {
    // OPS-19: the image-level HEALTHCHECK probes :8080/ready, a port no worker listens on, so the
    // one-shot showed UNHEALTHY after every successful run. outbox and comms-dispatcher already disable
    // theirs; retention must too, or the noise trains an operator to ignore an unhealthy state.
    const retention = services.get('retention') ?? '';
    assert.match(retention, /healthcheck:\s*\n\s*disable:\s*true/,
      'retention must disable its healthcheck — it is a one-shot that listens on no port (OPS-19)');
  });

  test('the API readiness door fails closed once shutdown starts', () => {
    const appSource = readFileSync(join(SERVER_ROOT, 'src/app.js'), 'utf8');
    const indexSource = readFileSync(join(SERVER_ROOT, 'src/index.js'), 'utf8');
    assert.match(appSource, /app\.decorate\(['"]schoolosDraining['"],\s*false\)/,
      'the app must own an explicit drain state');
    assert.match(appSource, /if \(app\.schoolosDraining\) return reply\.code\(503\)\.send\(\{ ready: false, reason: ['"]server draining['"] \}\)/,
      'readiness must reject new traffic while the API drains');
    assert.match(indexSource, /app\.schoolosDraining\s*=\s*true/,
      'signal handling must flip readiness before closing the server');
  });
});

describe('OPS-8 · every shipped worker is scheduled somewhere', () => {
  const cronScripts = () => new Set([...cron.matchAll(/scripts\/([A-Za-z0-9._-]+\.(?:js|sh))/g)].map((m) => m[1]));

  test('the five workers the register named are each scheduled, as their shape requires', () => {
    const scheduled = cronScripts();
    const inCompose = (s) => servicesRunning(`scripts/${s}`).length > 0;
    // Long-lived pollers belong in compose (a cron line would start a new process every minute).
    for (const s of ['webhook-worker.js', 'workflow-worker.js']) {
      assert.ok(inCompose(s) || scheduled.has(s), `${s} is not scheduled in compose or cron`);
    }
    // One-shots belong in cron.
    for (const s of ['day-worker.js', 'reconcile-payments.js']) {
      assert.ok(scheduled.has(s) || inCompose(s), `${s} is not scheduled in compose or cron`);
    }
  });

  test('dunning-reminders is explicitly accounted for — omitted on purpose, with the reason in the file', () => {
    // It is intentionally NOT cron-scheduled: scripts/day-worker.js already runs the dunning sweep with
    // the same `dunning:<obligationId>` dedup keys, and two cron lines for one job makes the schedule
    // unreadable at 03:00. The point of this assertion is that the DECISION is in the file rather than
    // silent — that is the whole difference between OPS-8 and "we forgot".
    assert.match(cron, /dunning-reminders\.js[\s\S]{0,400}?(DELIBERATELY|deliberately)/,
      'the cron file must state why dunning-reminders.js is not scheduled');
  });

  test('the invariant: every CLI worker on disk is accounted for, so the sixth cannot slip through', () => {
    // Written over the directory rather than as five hand-listed names — hand lists are how the original
    // five were missed. A worker is any script with the CLI-entry guard this repo uses everywhere.
    const scriptsDir = join(SERVER_ROOT, 'scripts');
    const cliWorkers = readdirSync(scriptsDir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => /pathToFileURL\(process\.argv\[1\]\)/.test(readFileSync(join(scriptsDir, f), 'utf8')));
    assert.ok(cliWorkers.length >= 5, `expected at least five CLI workers, found ${cliWorkers.length}`);
    const scheduled = cronScripts();
    const inCompose = (s) => servicesRunning(`scripts/${s}`).length > 0;
    const unscheduled = cliWorkers.filter((f) => !scheduled.has(f) && !inCompose(f) && f !== 'dunning-reminders.js');
    assert.deepEqual(unscheduled, [],
      'these CLI workers are scheduled by NEITHER docker-compose.yml nor ops/cron/schoolos.cron — a '
      + 'shipped worker that nothing runs is the OPS-8 finding, and outbound webhooks, workflow rules, '
      + 'dunning and reconciliation all silently stopped existing that way');
  });

  test('every script the cron file names exists on disk', () => {
    // Cheap, and it catches the class of defect the recon found in the old comments: a documented cron
    // line naming a service or script that does not exist reads as a schedule while scheduling nothing.
    for (const s of cronScripts()) {
      assert.ok(existsSync(join(SERVER_ROOT, 'scripts', s)),
        `ops/cron/schoolos.cron references scripts/${s}, which does not exist`);
    }
  });

  test('the cron file does not swallow the exit codes it depends on', () => {
    // The exit code IS the transport (backup.sh: mail on failure; health-probe.js: 1 = firing). A `|| true`
    // or a blanket `2>/dev/null` would make every one of those alerts unreachable while looking tidy.
    // Comments are stripped before the check, for the same reason as the bootstrap assertion above: the
    // file's own warning against `|| true` must not be mistaken for a `|| true`.
    const body = cron.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.ok(!/\|\|\s*true/.test(body),
      'a `|| true` in the schedule silences the only alert transport this project has');
    assert.match(body, /health-probe\.js/, 'the schedule must run the alert probe');
    // The commands themselves, not the prose: each scheduled line is non-empty and invokes node or a script.
    const scheduledLines = body.split('\n').filter((l) => /^\s*[\d*]/.test(l));
    assert.ok(scheduledLines.length >= 4, `expected the full schedule, found ${scheduledLines.length} lines`);
    for (const line of scheduledLines) {
      assert.match(line, /(node |\.\/scripts\/|scripts\/)/,
        `a scheduled line invokes nothing recognizable: ${line}`);
    }
  });
});

describe('OPS-3 · the alert rules are data, and every rule names a signal that exists', () => {
  let parseRules;
  let CHECKS;
  before(async () => {
    const m = await import('../scripts/health-probe.js');
    parseRules = m.parseRules;
    CHECKS = m.CHECKS;
  });

  test('the rules file parses, and each rule carries the fields the probe needs', () => {
    const rules = parseRules(readFileSync(RULES_PATH, 'utf8'));
    // The parser silently reported ONE rule for a nine-rule file while this file was being written (a
    // block-scalar continuation loop that swallowed everything after the first description). That is why
    // the count is asserted rather than just "some rules exist".
    assert.ok(rules.length >= 8, `expected the full rule set, parsed ${rules.length}`);
    for (const r of rules) {
      assert.ok(r.name && r.check, `rule missing name/check: ${JSON.stringify(r)}`);
      assert.ok(['critical', 'warning'].includes(r.severity), `${r.name}: severity must be critical|warning`);
      assert.ok(Number.isFinite(r.threshold), `${r.name}: threshold_gte must be a number`);
      assert.ok(r.description.length > 40, `${r.name}: a rule with no explanation is a silenced warning`);
    }
    // and every rule's check must be IMPLEMENTED — a rule watching a signal nobody reads is the same
    // fabricated-telemetry defect the register names in §5.8, expressed as configuration.
    const orphanRules = rules.filter((r) => !CHECKS[r.check]).map((r) => `${r.name}→${r.check}`);
    assert.deepEqual(orphanRules, [], 'these rules name a check the probe does not implement');
    const unrulyChecks = Object.keys(CHECKS).filter((c) => !rules.some((r) => r.check === c));
    assert.deepEqual(unrulyChecks, [], 'these checks are implemented but no rule uses them');
  });

  test('the rules cover the failure modes the register named, not just "something is down"', () => {
    const rules = parseRules(readFileSync(RULES_PATH, 'utf8'));
    const names = new Set(rules.map((r) => r.name));
    for (const required of [
      'outbox_not_draining',        // the relay stalled — OPS-4's class
      'outbox_parked',              // the relay gave up
      'webhook_fanout_stalled',     // OPS-8's webhook-worker, detectable via 076's state column
      'workflow_runner_stalled',    // OPS-8's workflow-worker
      'comms_queue_stalled',        // the dispatcher is down
      'comms_delivered_to_nobody',  // PRD-13/SEC-0's honesty gauge
      'api_heartbeat_stale',        // the only process-liveness signal the schema has
      'backup_missing',             // OPS-6
    ]) {
      assert.ok(names.has(required), `no rule named "${required}" — that failure mode is unwatchable`);
    }
  });
});

describe('OPS-3 · /metrics is a usable alert source (live)', () => {
  let app;
  let sql;
  const H = (t) => ({ authorization: `Bearer ${t}` });

  before(async () => {
    await setupTestDb();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();
    const { pool } = await import('../src/db.js');
    sql = (text, params = []) => pool.query(text, params);
  });
  after(async () => { await app?.close(); });

  test('no series is emitted twice — a scrape with a duplicate sample is rejected outright', () => {
    // THE DEFECT, reproduced live. The endpoint emitted schoolos_requests_total/errors_total from the
    // in-process counters AND again from every app.ops_counters row (whose names ARE
    // requests_total/errors_total). So the scrape contained two samples for one series and failed in
    // Prometheus — precisely in the steady state, once the 60s flush had run, while looking healthy in
    // the first minute after boot. Two samples for the same series is a hard Prometheus error, which
    // means no alert could ever be built on this endpoint.
    return (async () => {
      // Force the state the bug needed: rows in ops_counters with those names.
      await sql(`INSERT INTO app.ops_counters (name, value) VALUES ('requests_total', 7), ('errors_total', 3)
                 ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`);
      // And a worker-style counter, which must STILL be exported (the fix must not drop the feature).
      await sql(`INSERT INTO app.ops_counters (name, value) VALUES ('webhook_last_tick_epoch', 123)
                 ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`);

      const owner = await loginAs(app, 'owner@meridian.edu');
      const r = await app.inject({ method: 'GET', url: '/metrics', headers: H(owner.token) });
      assert.equal(r.statusCode, 200, r.body);
      // Series identity is name + LABEL SET, never name alone. A Prometheus histogram legitimately emits
      // `schoolos_request_duration_ms_bucket` once per `le` label (7 lines), so counting by bare name
      // flagged a correct histogram as seven duplicate series while remaining blind to a genuinely
      // repeated sample. `split(' ')[0]` keeps the labels (`name{le="100"}`); the presence checks below
      // use the bare names derived from it.
      const samples = r.body.split('\n')
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.split(' ')[0]);
      const names = [...new Set(samples.map((s) => s.split('{')[0]))];
      const counts = new Map();
      for (const s of samples) counts.set(s, (counts.get(s) ?? 0) + 1);
      const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([s, n]) => `${s}×${n}`);
      assert.deepEqual(dupes, [], 'duplicate series in one scrape — Prometheus rejects the whole scrape');
      assert.ok(names.includes('schoolos_requests_total'), 'the requests counter must still be present');
      assert.ok(names.includes('schoolos_webhook_last_tick_epoch'),
        'a NON-reserved ops_counter row must still be exported — the fix must not silently drop counters '
        + 'that workers write (webhook/workflow heartbeats ride this path)');
    })();
  });

  test('every metric a rule declares is a series the endpoint actually emits', () => {
    // Cross-file consistency: a dashboard or alert built from ops/alerts/schoolos.rules.yml must not point
    // at a series that does not exist. OPSX-8: the mapping is now DATA (`metric:` on each rule) rather than
    // a hardcoded map here, so a misspelled gauge in the rules file fails this test instead of passing it.
    return (async () => {
      // a heartbeat + backup epoch so the liveness gauges are emittable (they are absent, not zero, when
      // there is no data — which is the honest behaviour)
      await sql(`INSERT INTO app.ops_counters (name, value) VALUES
        ('requests_total', 7), ('errors_total', 3), ('backup_last_success_epoch', $1)
        ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`, [Math.floor(Date.now() / 1000)]);
      const owner = await loginAs(app, 'owner@meridian.edu');
      const body = (await app.inject({ method: 'GET', url: '/metrics', headers: H(owner.token) })).body;
      const { parseRules } = await import('../scripts/health-probe.js');
      const rules = parseRules(readFileSync(RULES_PATH, 'utf8'));
      assert.ok(rules.length >= 11, `the rules file must still carry its rules (saw ${rules.length})`);
      for (const rule of rules) {
        assert.ok(rule.metric, `rule "${rule.name}" must declare a metric`);
        assert.ok(body.includes(`${rule.metric} `),
          `rule "${rule.name}" declares metric "${rule.metric}" but /metrics emits no such series — an `
          + 'alert on a series that does not exist is the fabricated-telemetry defect class in '
          + 'configuration form');
      }
    })();
  });

  test('OPSX-3 · a backlog in another tenant is visible on the fleet gauge, not the caller gauge', () => {
    return (async () => {
      const owner = await loginAs(app, 'owner@meridian.edu');
      const value = (body, name) => Number(new RegExp(`^${name} (\\d+)$`, 'm').exec(body)?.[1]);
      const before = (await app.inject({ method: 'GET', url: '/metrics', headers: H(owner.token) })).body;
      const callerBefore = value(before, 'schoolos_outbox_pending');
      const fleetBefore = value(before, 'schoolos_fleet_outbox_pending');
      const tB = (await sql(`INSERT INTO app.tenants (name, slug) VALUES ('Fleet B','fleet-b-opsx3') RETURNING id`)).rows[0].id;
      await sql(`INSERT INTO app.outbox (tenant_id, topic, payload) VALUES ($1,'event.fleet.test','{"x":1}'::jsonb)`, [tB]);
      const after = (await app.inject({ method: 'GET', url: '/metrics', headers: H(owner.token) })).body;
      assert.equal(value(after, 'schoolos_outbox_pending'), callerBefore,
        'the caller-scoped gauge must remain scoped to the caller tenant');
      assert.equal(value(after, 'schoolos_fleet_outbox_pending'), fleetBefore + 1,
        'the fleet gauge must count the other tenant\'s backlog — the OPSX-3 blind spot');
    })();
  });

  test('OPSX-4 · a scoped machine key can scrape /metrics; an unscoped key cannot', async () => {
    // No human session exists on a Prometheus host. A key holding `metrics.read` may scrape the same door
    // an owner uses; authenticate enforces the door allowlist + scope, and requireRole admits the
    // API-key principal only after that. A key without the scope must be refused.
    const owner = await loginAs(app, 'owner@meridian.edu');
    const mk = async (name, scopes) => app.inject({ method: 'POST', url: '/api-keys', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, payload: { name, scopes } });
    const scraper = await mk('prometheus', ['metrics.read']);
    assert.equal(scraper.statusCode, 200, scraper.body);
    const ok = await app.inject({ method: 'GET', url: '/metrics', headers: { 'x-api-key': scraper.json().key } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.ok(ok.body.includes('schoolos_uptime_seconds'), 'the machine scrape returns the real payload');
    const other = await mk('readers', ['students.read']);
    const denied = await app.inject({ method: 'GET', url: '/metrics', headers: { 'x-api-key': other.json().key } });
    assert.equal(denied.statusCode, 403, 'a key without metrics.read must not scrape the platform metrics');
  });

  test('the probe reports SKIPPED, never a fabricated ok, when a signal is absent', async () => {
    const { CHECKS } = await import('../scripts/health-probe.js');
    // A pre-076 database has no discovered_at; a probe that answered "ok, 0 undiscovered" would be
    // inventing a clean bill of health from a column that does not exist.
    const fakeQ = async () => ({ rows: [] });   // information_schema probe returns nothing
    const r = await CHECKS.webhook_undiscovered(fakeQ);
    assert.ok(r.skipped, 'a missing column must produce a SKIP with a reason, not a value');
    assert.match(r.skipped, /076/, 'the skip must name the migration that would fix it');
    assert.equal(r.value, undefined, 'no fabricated number may accompany a skip');
  });

  test('a stalled signal makes its rule FIRE — the probe is not decorative', () => {
    // The mutation probe for the whole alerting feature: plant a genuinely stuck outbox row and assert the
    // rule fires. Without this, "we added alerting" rests on a file existing.
    return (async () => {
      const { runProbe } = await import('../scripts/health-probe.js');
      const T = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
      const id = (await sql(
        `INSERT INTO app.outbox (tenant_id, topic, payload, attempts, created_at)
         VALUES ($1, 'alert.probe.fire', '{}'::jsonb, 0, now() - interval '30 minutes') RETURNING id`, [T])).rows[0].id;
      try {
        const out = await runProbe({ q: (t, p) => sql(t, p), env: 'test' });
        const fired = out.fired.map((r) => r.name);
        assert.ok(fired.includes('outbox_not_draining'),
          `a 30-minute-old pending event must fire outbox_not_draining; fired=[${fired.join(', ')}]`);
        // and it must be attributed to the right rule with the right severity
        const rule = out.fired.find((r) => r.name === 'outbox_not_draining');
        assert.equal(rule.severity, 'critical');
        assert.ok(rule.value >= 1, `the fired rule must carry the real count, got ${rule.value}`);
      } finally {
        await sql(`DELETE FROM app.outbox WHERE id=$1`, [id]);
      }
    })();
  });

  test('a rule whose check does not exist is an ERROR (exit 2), never a silent pass', async () => {
    // The distinction that matters operationally: exit 1 = "something is wrong", exit 2 = "the monitor
    // itself is broken". Collapsing them would make a typo'd rule name read as "all clear" forever.
    const { runProbe, exitCodeFor } = await import('../scripts/health-probe.js');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = path.join(os.tmpdir(), `schoolos-rules-${process.pid}.yml`);
    fs.writeFileSync(tmp, 'version: 1\nrules:\n  - name: typo_rule\n    check: no_such_check\n    metric: schoolos_fleet_outbox_pending\n    severity: critical\n    threshold_gte: 1\n    description: >-\n      a probe that cannot evaluate this must say so.\n');
    try {
      const out = await runProbe({ q: async () => ({ rows: [] }), rulesPath: tmp });
      assert.equal(out.errored.length, 1, 'an unknown check must be reported as an error');
      assert.equal(out.fired.length, 0);
      assert.equal(exitCodeFor(out), 2, 'a broken monitor must exit 2, distinct from "a rule fired"');
      assert.equal(exitCodeFor({ fired: [{ name: 'x' }], errored: [] }), 1);
      assert.equal(exitCodeFor({ fired: [], errored: [] }), 0);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('a production-scoped rule is skipped in development, and SAYS so', () => {
    // comms_delivered_to_nobody is 0-by-design in a sandbox (the logger provider IS the carrier there), so
    // it is scoped away from development. A skipped rule must be visible as skipped: an operator has to be
    // able to tell "checked and healthy" from "not checked here", or the probe trains them to trust a
    // blank.
    return (async () => {
      const { parseRules, evaluate } = await import('../scripts/health-probe.js');
      const rules = parseRules(readFileSync(RULES_PATH, 'utf8'));
      const rule = rules.find((r) => r.name === 'comms_delivered_to_nobody');
      assert.ok(rule, 'the honesty gauge must have a rule');
      const inDev = evaluate(rule, { value: 99 }, 'development');
      assert.equal(inDev.status, 'skipped', 'it must not fire locally, where a sandbox carrier is normal');
      assert.match(inDev.reason, /development/);
      const inProd = evaluate(rule, { value: 99 }, 'production');
      assert.equal(inProd.status, 'fired', 'in production, messages delivered to nobody must fire');
    })();
  });
});

describe('OPSX-2 · uploaded documents survive a container recreate and reach the archive', () => {
  test('the API writes file bytes to a NAMED volume at FILES_DIR', () => {
    const api = services.get('api');
    assert.ok(api, 'the api service must exist');
    assert.match(api, /FILES_DIR:\s*\/data\/files/,
      'FILES_DIR must point at the mounted volume — otherwise bytes live in the container layer and a '
      + 'recreate destroys them');
    assert.match(api, /files:\/data\/files/, 'the named files volume must be mounted at FILES_DIR');
    const topVolumes = compose.split(/\nvolumes:\s*\n/).pop();
    assert.match(topVolumes, /^ {2}files:\s*$/m, 'the files volume must be declared at the top level');
  });

  test('a one-shot archives the volume for the host backup to collect', () => {
    const fb = services.get('files-backup');
    assert.ok(fb, 'a files-backup service must exist, or the named volume has no host-visible archive');
    assert.match(fb, /files:\/data\/files/, 'it must mount the same volume the API writes');
    assert.match(fb, /tar -czf/, 'and actually archive it');
    assert.match(fb, /tar -tzf/, 'the archive must be verified readable, like every other backup artifact');
  });
});
