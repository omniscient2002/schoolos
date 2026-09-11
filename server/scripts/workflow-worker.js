#!/usr/bin/env node
// Workflow step-runner (L2-5.2, Wave 5) — rides app.outbox, per the decision
// doc (.coop/L2-5.2-workflow-runtime-decision.md): enabled rules match the
// event topic + an optional top-level payload condition; each match performs
// ONE action (outbox fan-out with a 'wf:'-prefixed dedup key, or a comms
// enqueue). Idempotent per (rule, event); rules never trigger rules (outbox
// rows written by this runner carry dedup_key 'wf:…' and are skipped).
// Importable: exports { runWorkflowPass } — the CLI guard keeps
// `node scripts/workflow-worker.js` the only looping path.
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';

const INTERVAL_MS = Number(process.env.WORKFLOW_POLL_MS ?? 5000);
const BATCH = Number(process.env.WORKFLOW_BATCH ?? 50);
const LOOKBACK = '1 hour';

function conditionMatches(condition, payload) {
  if (!condition) return true;
  const { field, op, value } = condition;
  const v = payload?.[field];
  if (op === 'exists') return v !== undefined && v !== null;
  if (op === 'equals') return String(v) === String(value);
  if (op === 'contains') return String(v ?? '').includes(String(value));
  return false; // unknown op → never fire (honest default)
}

export async function runWorkflowPass(c) {
  const events = await c.query(
    `SELECT id, tenant_id, topic, payload FROM app.outbox
     WHERE created_at > now() - interval '${LOOKBACK}'
       AND (dedup_key IS NULL OR dedup_key NOT LIKE 'wf:%')
     ORDER BY created_at LIMIT $1`, [BATCH]);
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
          `INSERT INTO app.outbox (tenant_id, topic, payload, dedup_key)
           VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING RETURNING id`,
          [ev.tenant_id, String(action.topic ?? `${ev.topic}.workflow`).slice(0, 120),
            JSON.stringify({ sourceEvent: ev.id, rule: rule.name, payload }),
            `wf:${rule.id}:${ev.id}`]);
        if (r.rows[0]) fired++;
      }
    }
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
