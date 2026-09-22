// AI gateway (L2-5.1, Wave 5) — the ONE seam every plugin's AI call goes through.
// C10/H6 · STATUS (honest): no shipped plugin invokes this gateway today. The copilots
// (teacher.copilot, parent.assistant, coord.view) are DETERMINISTIC (no model); the only callers are the
// kernel's `/ai/call` and `/ai/eval`. The per-plugin `app.plugins.ai_budget` is therefore seeded but
// reserved — it becomes live the moment a plugin routes a call through `createAiGateway`. Recorded here
// rather than left to read as an implemented per-plugin cap.
// Contract:
//   · LEDGER: every call attempt writes app.ai_calls (outcome ok | error | budget)
//     — including eval-harness runs — so cost and failure are never invisible.
//   · BUDGET: enforced BEFORE the provider runs. Per-tenant daily cap =
//     tenants.config.ai.dailyCallCap (default 200, sandbox-friendly); per-plugin
//     monthly cap = app.plugins.ai_budget (0 = AI disabled for that plugin).
//     An exhausted budget answers { ok:false, code:'budget' } — honest, no call.
//   · PROVIDERS: pluggable adapter interface. 'logger' is the sandbox default
//     (no credentials, deterministic echo — D-32: real keys land LAST, and only
//     in server/.env / plugin settings, never in code or git). 'openai-compatible'
//     is the real-provider shape: requires settings {baseUrl, model, apiKey} and
//     answers a structured honest error when any piece is missing (503-class).
// Importable: createAiGateway({ sysq, kernelQ }) → { call, evalRun }.
import { config } from '../../config.js';

const TOKEN_ESTIMATE = (s) => Math.max(1, Math.ceil(String(s ?? '').length / 4));

// provider adapters: (input, settings) → { ok, output?, tokensIn, tokensOut, model?, error?, sandbox }
const providers = {
  logger: {
    sandbox: true,
    async run(input) {
      const text = String(input ?? '');
      return { ok: true, output: `(sandbox echo) ${text.slice(0, 400)}`, tokensIn: TOKEN_ESTIMATE(text), tokensOut: TOKEN_ESTIMATE(text), model: 'sandbox-logger', sandbox: true };
    },
  },
  'openai-compatible': {
    sandbox: false,
    needs: ['baseUrl', 'model', 'apiKey'],
    async run(input, settings) {
      const missing = this.needs.filter((k) => !settings?.[k]);
      if (missing.length) return { ok: false, error: `provider openai-compatible needs ${missing.join(', ')} in plugin settings`, code: 'unconfigured', sandbox: false };
      return { ok: false, error: 'provider openai-compatible is intentionally inert until the owner supplies live credentials (D-32 credentials-last)', code: 'unconfigured', sandbox: false };
    },
  },
};

export function registerProvider(name, adapter) { providers[name] = adapter; }

export function createAiGateway({ sysq, kernelQ }) {
  const dailyCap = async (tenantId) => {
    const r = await sysq(`SELECT config->'ai'->>'dailyCallCap' AS cap FROM app.tenants WHERE id=$1`, [tenantId]);
    const n = Number(r.rows[0]?.cap);
    return Number.isFinite(n) && n > 0 ? n : 200;
  };

  // S0 fix B6: the ledger is observability, never request-critical — a ledger
  // write failure (fresh table, pool contention) must not turn a budget answer
  // or a successful provider call into a 500.
  const writeLedger = (row) => kernelQ(
    `INSERT INTO app.ai_calls (tenant_id, user_id, plugin_id, purpose, provider, model, tokens_in, tokens_out, latency_ms, outcome, error, sandbox)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [row.tenantId, row.userId ?? null, row.pluginId, row.purpose, row.provider, row.model ?? null,
      row.tokensIn ?? 0, row.tokensOut ?? 0, row.latencyMs ?? null, row.outcome, row.error ?? null, row.sandbox ?? true]
  ).catch((e) => console.error('[ai-gateway] ledger write failed:', e?.message ?? e));

  const call = async ({ tenantId, userId, pluginId, purpose, provider = 'logger', input, settings = {} }) => {
    const started = Date.now();
    // budget 1: per-plugin monthly cap (app.plugins.ai_budget jsonb).
    // PLG-7 fixed TWO defects together: the cap was read from key `calls` while the catalog wrote
    // `requests_per_day` and the migrations wrote `calls_per_day`, so it was ALWAYS null; and even a matched
    // POSITIVE cap was never enforced — only `0` was. All three spellings are accepted, so existing rows take
    // effect with no data migration, and the positive cap is counted against the plugin's OWN calls this
    // calendar month. The catalog now writes the canonical `calls`. A numeric ai_budget (e.g. `2`) is a cap too.
    // `false` / `{"calls":0}` disables AI for the plugin. catalog rows can be duplicated per tenant (033
    // migrate + seed re-run): take the STRICTEST finite value across them; {} / absent members = no cap.
    const plugin = await sysq(
      `SELECT bool_or(p.ai_budget = 'false'::jsonb) AS off,
              min(CASE WHEN jsonb_typeof(p.ai_budget) = 'number' THEN (p.ai_budget #>> '{}')::int
                       WHEN jsonb_typeof(p.ai_budget) = 'object'
                         THEN LEAST((p.ai_budget->>'calls')::int,
                                    (p.ai_budget->>'calls_per_day')::int,
                                    (p.ai_budget->>'requests_per_day')::int)
                       ELSE NULL END) AS strictest,
              (SELECT count(*)::int FROM app.ai_calls a
                WHERE a.tenant_id=$1 AND a.plugin_id=$2 AND a.outcome <> 'budget'
                  AND a.created_at >= date_trunc('month', now())) AS used
       FROM app.plugins p WHERE p.tenant_id=$1 AND p.plugin_id=$2`, [tenantId, pluginId]);
    const isOff = plugin.rows[0]?.off === true;
    const strictest = plugin.rows[0]?.strictest ?? null; // null → no plugin-level cap
    if (isOff || strictest === 0) {
      await writeLedger({ tenantId, userId, pluginId, purpose, provider, outcome: 'budget', error: 'plugin ai_budget is 0 — AI disabled for this plugin', sandbox: providers[provider]?.sandbox ?? true });
      return { ok: false, code: 'budget', error: 'AI is switched off for this feature (budget 0).' };
    }
    if (typeof strictest === 'number' && strictest > 0 && (plugin.rows[0]?.used ?? 0) >= strictest) {
      await writeLedger({ tenantId, userId, pluginId, purpose, provider, outcome: 'budget', error: `plugin monthly cap ${strictest} reached`, sandbox: providers[provider]?.sandbox ?? true });
      return { ok: false, code: 'budget', error: `This feature's monthly AI budget is used up (${strictest} calls a month). It resets next month.` };
    }
    // budget 2: per-tenant daily cap (any outcome except 'budget' counts as usage)
    const cap = await dailyCap(tenantId);
    const used = await sysq(
      `SELECT count(*)::int AS n FROM app.ai_calls
       WHERE tenant_id=$1 AND outcome <> 'budget' AND created_at > now() - interval '24 hours'`, [tenantId]);
    if ((used.rows[0]?.n ?? 0) >= cap) {
      await writeLedger({ tenantId, userId, pluginId, purpose, provider, outcome: 'budget', error: `daily cap ${cap} reached`, sandbox: providers[provider]?.sandbox ?? true });
      return { ok: false, code: 'budget', error: `Daily AI budget reached (${cap} calls per day). Try again tomorrow.` };
    }
    const adapter = providers[provider];
    if (!adapter) {
      await writeLedger({ tenantId, userId, pluginId, purpose, provider, outcome: 'error', error: `unknown provider '${provider}'`, sandbox: true });
      return { ok: false, code: 'unconfigured', error: `unknown AI provider '${provider}'` };
    }
    let r;
    try {
      r = await adapter.run(input, settings);
    } catch (e) {
      r = { ok: false, error: String(e?.message ?? 'provider failed'), sandbox: adapter.sandbox ?? true };
    }
    await writeLedger({
      tenantId, userId, pluginId, purpose, provider,
      model: r.model ?? null, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
      latencyMs: Date.now() - started, outcome: r.ok ? 'ok' : 'error',
      error: r.error ?? null, sandbox: r.sandbox ?? true,
    });
    return r;
  };

  // eval-harness door shape: run a batch of recorded prompts through one
  // provider, ledger each run with purpose='eval', return outputs + stats.
  const evalRun = async ({ tenantId, userId, pluginId, provider = 'logger', cases = [], settings = {} }) => {
    const results = [];
    for (const c of cases.slice(0, 25)) {
      const r = await call({ tenantId, userId, pluginId: pluginId ?? 'ai.gateway', purpose: 'eval', provider, input: c.input, settings });
      results.push({ name: c.name ?? null, input: c.input, ...r });
    }
    const okCount = results.filter((r) => r.ok).length;
    return { total: results.length, ok: okCount, failed: results.length - okCount, sandbox: provider === 'logger', results };
  };

  return { call, evalRun };
}
