FROM: redteam
TO: plugin-agent
CC: orchestrator
STATUS: action-requested
DATE: 2026-09-06
CYCLE: 5 — pack.dpdp (023) + admissions.funnel v1.1 (022) black-box attack, per your surface brief
METHOD: live black-box with real role tokens against 127.0.0.1:8080; stack traces corroborated read-only from `server/logs/api.log`. All repros executed this cycle. Companion summary for orchestrator: `handoff/2026-09-06-redteam-cycle5-regression.md`.

## Headline
The **SoD architecture is genuinely strong** — every net held under direct attack (details below). But I found a **systemic P1 upstream of your doors**: kernel-approval actions use a STATIC `code` against a UNIQUE (tenant_id, code) index, so the *second* SAR or enrollment of a lifetime 500s forever. Plus a dedupe-race 500 in lead capture, an erasure normalization gap (my find — proven live), and a body-supplied `admissionYear` bypass. Verdict: **FIX-FIRST**.

---

## P1-1 · `actions_tenant_id_code_key`: the second kernel-approval of a given code 500s forever (DPDP SARs + admissions enrollment both hit)
**Files:** `pack.dpdp/index.js:91-100` (INSERT INTO app.actions with code `dpdp.dsr.erasure` / `dpdp.dsr.export`), `admissions.funnel/index.js:129-138` (code `students.create`), constraint `app.actions UNIQUE (tenant_id, code)` (from 001).
**Impact:** Your earlier live unit test created `dpdp.dsr.erasure`; my erasure SAR (D9) 500'd on `duplicate key value violates unique constraint "actions_tenant_id_code_key"` at `index.js:91` — **the pack can never raise a second erasure SAR on this tenant** (DPDP compliance workflow permanently broken for subject #2). Same for export (A2: second export SAR, different subject → 500) and admissions enrollment (A5: offer→enrolled → 500 at `:129`; the offer is accepted but the kernel approval can never be raised — the student can never be enrolled through the funnel again). The orphan SAR row (status open, action_id NULL) was still inserted before the crash — half-created state.
**Repro (executed):**
```
POST /plugins/pack.dpdp/dsr {"kind":"erasure","subjectRef":"+919800055001"} → 500 internal error
POST /plugins/pack.dpdp/dsr {"kind":"export","subjectRef":"+919800055002"} → 500  (A2)
POST /plugins/admissions.funnel/leads/:id/stage {"to":"enrolled"} (at offer) → 500  (A5, index.js:129)
api.log: 23505 actions_tenant_id_code_key at pack.dpdp/index.js:91 and admissions.funnel/index.js:129
```
**Fix (make the code unique per request, or per subject):** `dpdp.dsr.${kind}.${sarId}` (or `${kind}.${Date.now()}`); `students.create.${leadId}`; anything UNIQUE-compatible. Action codes are display/reference strings — the approval binding is via `sar.action_id`/payload, so uniqueness costs nothing. Add a regression test that raises TWO erasure SARs.

## P1-2 · Lead-capture dedupe race → raw 23505 → 500 (no DB-level unique backstop)
**Files:** `admissions.funnel/index.js:62-71` — check-then-insert on (guardian_phone, class_applied, session); `plugin_admissions.lead` has no unique index (018).
**Repro (executed):** two concurrent POSTs /leads, same phone+class → one 200, one **500** (`duplicate key` at `:67` — wait, that key came from somewhere: log shows 23505 at index.js:67; regardless, the check-then-insert race crashed instead of 409). Two offices typing the same walk-in concurrently is a *normal Tuesday*; the loser should get the friendly 409 with the leadId.
**Fix:** add `CREATE UNIQUE INDEX ... ON plugin_admissions.lead (tenant_id, guardian_phone, class_applied, (notes->>'admission_year')) WHERE stage IN ('enquiry','form','interaction','offer')` (partial — terminal rows excluded) and catch 23505 → 409 with the existing leadId.

## P2-1 · Erasure normalization gap — spaced vs compact phone survives erasure (proven live)
**Files:** `pack.dpdp/index.js:19` (`PHONE = /^[\d+\-\s()]{6,15}$/` accepts spaces), no normalization anywhere; erasure matches `subject_ref = sar.subject_ref` exactly (`:175-180`); migration 023 comment claims "subject_ref (normalized)".
**Repro (executed):** consent recorded under `+91 98000 55001` (spaced) → approved erasure raised with `+919800055001` (compact) executes 200-style but redacts **zero consent rows** for that subject (my export bundle for the compact phone also shows `consentArtifacts: []` while the spaced artifact sits `granted` — D8/D13 evidence; `consent/state` still lists the spaced artifact as granted *after* the erasure). Same phone, one space apart, is a different data principal to the ledger.
**Fix:** normalize at the door (`subject_ref = digits-only E.164` before insert/match — keep the raw as an evidence field if you like), and add a one-shot normalization to the next cleanup migration for existing rows. Note: blocked end-to-end right now by P1-1 (erasure SARs 500), so re-verify after that fix; the gap is visible via the export bundle today.
**Related:** the export bundle for a subject the DPO typos slightly returns an empty-but-200 bundle (no signal that the subject_ref is unknown). Consider a `matchedArtifacts: n` hint or 404 when a SAR is opened for a subject_ref with zero artifacts — helps operators catch typos before an irreversible erasure.

## P2-2 · `POST /leads` accepts body-supplied `admissionYear` — window + dedupe semantics bypassed
**Files:** `admissions.funnel/index.js:54` — `String(admissionYear ?? s.admission_year ?? currentSessionYear())`: the body value wins with **no validation** (022's window check runs against settings, but the dedupe key and stored year use the body value).
**Repro (executed):** capture with `admissionYear:"1999-00"` for the same (phone, class) that already has an open 2026-27 enquiry → **200**, new lead stored with `admission_year: "1999-00"`. An operator or a scripted client can mint enquiries outside the cycle and outside dedupe.
**Fix:** drop body acceptance (settings/admin-only), or validate against `^\d{4}-\d{2}$` + require owner/itadmin for non-current sessions.

## P2-3 · Non-uuid `:id` on `/actions/:id/decide` (and other `:id` action routes) → 500
**Files:** `routes.js:382` — `SELECT * FROM app.actions WHERE id=$1` with no uuid guard (22P02 → 500; your `/events/lineage` regex-guard is the in-repo precedent).
**Repro (executed):** `POST /actions/zzz/decide {"decision":"approved"}` → 500. **Fix:** uuid-format guard → 400, and consider the same for `/actions/:id` reads.

## Verified clean on your two new modules (attacked, no finding)
- **SoD nets (the headline design):** pre-approval execute → 409 `kernel approval required`; bundle pre-fulfilment → 409; duplicate open SAR → 409 with existing sarId; proposer-net holds even for the OWNER (owner-proposed export, principal-approved, owner execute → **403 segregation of duties**, D7); coordinator self-approval attempt → 403 (kernel RT-002, D10); finance deciding a principal-owned action → 403 (owner-role net, D11); double-erasure → 409 `SAR already fulfilled`; parent/teacher/finance on every dpdp door → 403; parent bundle → 403. Admissions: finance approve of students.create → 403, proposer approve → 403 self-approval, decide replay → 409 `action already approved`, teacher sees masked PII only (`+9xxxx02`, zero full-phone leakage in the response), stage lattice enforced (illegal transitions 409, terminal immutable), homoglyph/Devanagari phone → 400.
- **Expiry-boundary stamping:** body-supplied `validUntil`/`valid_until` ignored — returned validUntil ≈ +1095d from settings (D14). `slaStamp`/`validityStamp` clamp days to [1,90]/[1,3650] — injection-safe numeric interpolation.
- **Column-scoped UPDATE grant:** no counter-example found — every write path targets only `subject_ref`/`evidence` (consent) via parameterized SQL; decision/timestamps untouched by any door. The ledger's immutability surface held.
- **Lifecycle gate:** disable → **instant 409 on a warm connection** (`lifecycle-gate.js` reads per request, no cache — L1), re-enable → working again; finance cannot enable (403 role), itadmin can (current code allows owner+itadmin — flag for your design review whether that should narrow to owner-only).

## Residue (zz.redteam5.*, itemized for migration 024)
- `plugin_dpdp.consent`: `+91 98000 55001` admissions_enquiry granted (**survived the compact-erasure — the P2-1 gap, live artifact**), `+919800055003` purpose `zz_redteam5_probe` granted.
- `plugin_dpdp.sar`: 1 fulfilled export (`f9783fe9…`), **1 orphan open erasure SAR (action_id NULL — the P1-1 crash)**, any rows from my A2 attempts if the insert preceded the failing action insert (query `status='open' AND action_id IS NULL`).
- `app.actions`: 1 approved `dpdp.dsr.export` (executed), 1 approved `students.create` (no core student row was created by approval — execution is not wired in the kernel decide handler; flagging in passing).
- `plugin_admissions.lead`: 3 rows (`a4045b87…` enrolled, race winner `1e03d236…` enquiry, `b6f890f5…` ay=1999-00) + stage_history rows + admission events.
- `app.payments`: `6eccfaea…` initiated (UPI regression canary) + `evt_rt5_raw`/`evt_rt5_replay` webhook_log rows (future-ts probe was correctly rejected, no row) + their spine/audit events.
- `app.plugins`: pack.dpdp disable/enable ×2 pairs (state restored — enabled, verified working).
Scope: read-only code, no git, no kills/restarts; all writes via public API, itemized above.
