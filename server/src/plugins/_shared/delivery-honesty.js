// Delivery honesty — the one place that decides whether a rail result means "a carrier took it".
//
// PRD-13. The mechanism, verified in the code: `rails.sms`/`rails.email`/`rails.whatsapp` all default
// `provider` to `'logger'` when a tenant has no credentials — and ALSO when the per-tenant settings
// READ FAILS ("degrading to logger provider"), so a transient database hiccup silently demotes a real
// carrier to a sandbox one. A logger provider then returns `{ ok: true }`, because writing a log line
// did succeed. Everything downstream that treats `ok: true` as "delivered" therefore records a
// message as sent that reached nobody, and SEC-0 already put this in writing for the reset door:
// "sandbox is the permanent default for any tenant without SMTP credentials ... so this was never a
// developer-only state."
//
// A log line is a legitimate carrier in a SANDBOX and a lie in PRODUCTION. That distinction is the
// entire content of this module, so it lives in exactly one place: the dispatcher's choke point, and
// the doors that send DIRECTLY and write their own ledger row (the reset door, and any future one),
// must not each invent their own version of it.
//
// Explicitly NOT the fix: making the sandbox path fail everywhere. The sandbox tests pin the logger
// path as a deliberate carrier (asserting `outcome: 'sent'`), and breaking them would prove nothing
// about production. What is fixed is that production can no longer be silently in sandbox mode.

/** Carriers that produce a log line and nothing else. `logger` is the rails' default; `log-only` is
 *  the dispatcher's branch for an unsupported channel or an unresolvable recipient; `''` covers a
 *  result that names no carrier at all — which must be treated as "not delivered", not as unknown. */
const SANDBOX_CARRIERS = new Set(['logger', 'log-only', '']);

export const isSandboxCarrier = (provider) =>
  SANDBOX_CARRIERS.has(String(provider ?? '').trim().toLowerCase());

/** Does this rail result represent an actual hand-off to a carrier?
 *
 *  Two signals, because the rails expose two. `rails.email` sets an explicit `sandbox` boolean on
 *  every result (`{provider:'logger',sandbox:true}` vs `{provider:'smtp',sandbox:false}`), which is
 *  the cleanest thing to trust where it exists; `rails.sms` and `rails.whatsapp` do not set it, so
 *  their provider NAME is the only signal available. Honouring both means a future rail that reports
 *  its own sandbox status is respected without a change here, while one that does not is still caught
 *  by name. */
export const isSandboxResult = (r) => r?.sandbox === true || isSandboxCarrier(r?.provider);

/** Is a sandbox carrier acceptable in this runtime? False in production, by definition: an operator
 *  who has configured no provider must see failures, not a queue that drains cleanly.
 *
 *  Note the matching is EXACT apart from case and surrounding whitespace (independent review found that
 *  `' logger '` used to read as a real carrier; now trimmed). An unrecognised provider name is treated
 *  as REAL rather than sandbox, deliberately: guessing "unknown means not delivered" would turn every
 *  future carrier into an outage. The rails today emit only literal 'logger'/'http-generic'/'smtp'/
 *  'cloud-api', so the set is closed in practice, and a new provider name must be added to
 *  SANDBOX_CARRIERS if it is also a sandbox.
 *
 *  Injectable so the rule is testable — `config.env` is read at import time, so a test cannot flip
 *  NODE_ENV mid-process, and a rule that cannot be tested is a rule that will rot. */
export const sandboxAllowed = (env) => env !== 'production';
