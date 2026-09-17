#!/usr/bin/env node
// Workflow step-runner (L2-5.2, Wave 5) — rides app.outbox, per the decision
// doc (.coop/L2-5.2-workflow-runtime-decision.md): enabled rules match the
// event topic + an optional top-level payload condition; each match performs
// ONE action (outbox fan-out with a 'wf:'-prefixed dedup key, or a comms
// enqueue). Idempotent per (rule, event); rules never trigger rules (outbox
// rows written by this runner carry dedup_key 'wf:…' and are skipped, and are stamped
// workflow_scanned_at at insert because they are scanned by construction).
// DAT-14: discovery is state-based (app.outbox.workflow_scanned_at, migration 076) — the old
// 1-hour window + LIMIT 50 with no cursor starved every row past the first batch.
// Importable: exports { runWorkflowPass } — the CLI guard keeps
// `node scripts/workflow-worker.js` the only looping path.
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';

const INTERVAL_MS = Number(process.env.WORKFLOW_POLL_MS ?? 5000);
const BATCH = Number(process.env.WORKFLOW_BATCH ?? 50);

function conditionMatches(condition, payload) {
  if (!condition) return true;
  const { field, op, value } = condition;
  const v = payload?.[field];
  if (op === 'exists') return v !== undefined && v !== null;
  if (op === 'equals') return String(v) === String(value);
  if (op === 'contains') return String(v ?? '').includes(String(value));
  return false; // unknown op → never fire (honest default)
}

export async function runWorkflowPass(c, { scanBatch = BATCH } = {}) {
  // DAT-14 (migration 076): state-based discovery — the twin of the webhook fan-out's DAT-4 defect,
  // and the worse half of the pair because of the LIMIT.
  //
  // The previous query was `WHERE created_at > now() - interval '1 hour' ORDER BY created_at LIMIT 50`
  // with NO cursor and NO marker. Two failures followed from that one choice:
  //   · STARVATION. Every tick re-read the same oldest 50 rows, so once more than 50 rows matched
  //     inside the window the rest were never seen at all. The LIMIT did not bound the work per tick;
  //     it bounded what could EVER be processed.
  //   · OUTAGE LOSS. A runner down for more than an hour never looked at the gap again.
  // The per-consumer marker `workflow_scanned_at` turns the page into an index walk that ADVANCES, so
  // oldest-first becomes a guarantee instead of a re-read.
  //
  // SKIP LOCKED so a second runner — or the relay, which locks the same rows — cannot double-evaluate
  // a page. A skipped row keeps its NULL marker and is picked up next tick, so nothing is dropped.
  const events = await c.query(
    `SELECT id, tenant_id, topic, payload FROM app.outbox
      WHERE workflow_scanned_at IS NULL
        AND (dedup_key IS NULL OR dedup_key NOT LIKE 'wf:%')
      ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [scanBatch]);
  let fired = 0;
  for (const ev of events.rows) {
    const rules = await c.query(
      `SELECT id, name, topic, condition, action FROM app.workflow_rules
       WHERE tenant_id=$1 AND enabled AND topic=$2`, [ev.tenant_id, ev.topic]);
    for (const rule of rules.rows) {
      let payload = ev.payload ?? {};
      if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = {}; } }
      if (!conditionMatches(rule.condition, payload)) continue;
      const action = rule.action ?? {};
      if (action.kind === 'comms') {
        const r = await c.query(
          `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, dedup_key, status)
           VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,'queued') ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING RETURNING id`,
          [ev.tenant_id, action.audienceKind ?? 'custom', JSON.stringify(action.audience ?? []),
            action.channel ?? 'sms', action.template ?? 'WORKFLOW', String(action.body ?? '').slice(0, 1000),
            `wf:${rule.id}:${ev.id}`]);
        if (r.rows[0]) fired++;
      } else { // default: outbox fan-out with a derived topic
        const r = await c.query(
          `INSERT INTO app.outbox (tenant_id, topic, payload, dedup_key, workflow_scanned_at)
           VALUES ($1,$2,$3::jsonb,$4, now()) ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING RETURNING id`,
          [ev.tenant_id, String(action.topic ?? `${ev.topic}.workflow`).slice(0, 120),
            JSON.stringify({ sourceEvent: ev.id, rule: rule.name, payload }),
            `wf:${rule.id}:${ev.id}`]);
        if (r.rows[0]) fired++;
      }
    }
  }
  // The page is marked evaluated only AFTER every rule has been applied, inside the caller's
  // transaction: a crash mid-page rolls the marker back together with the derived rows, so the page is
  // re-evaluated next tick rather than skipped. Marking FIRST would be the silent-loss bug this change
  // exists to remove.
  if (events.rows.length) {
    await c.query(`UPDATE app.outbox SET workflow_scanned_at = now() WHERE id = ANY($1::uuid[])`,
      [events.rows.map((r) => r.id)]);
  }
  return { scanned: events.rows.length, fired };
}

// CLI guard: `node scripts/workflow-worker.js` loops; imports get functions only.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`workflow worker on ${INTERVAL_MS}ms poll (batch ${BATCH})`);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { stopping = true; setTimeout(() => process.exit(0), 8000).unref(); });
  while (!stopping) {
    const c = await pool.connect().catch(() => null);
    if (c) {
      try {
        await c.query('BEGIN');
        const r = await runWorkflowPass(c);
        await c.query('COMMIT');
        if (r.fired) console.log(JSON.stringify({ kind: 'workflow.pass', at: new Date().toISOString(), ...r }));
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        console.error('workflow pass failed:', e.message);
      } finally { c.release(); }
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log('workflow worker stopped');
  await pool.end();
}
