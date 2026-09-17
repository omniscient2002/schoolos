// Core-lane actions — the ONLY plugin-reachable path to a write on the office lane (`app.students`).
//
// WHY THIS FILE EXISTS (owner decision, 2026-09-14: DPDP erasure reaches the office lane).
//
// The boundary this project records in three places, all meaning the same thing:
//   · `migrations/023_dpdp_pack.sql` — "erasure touches core domain → approval semantics, never plugin-direct
//     … core app.students rows are NEVER written by this plugin (office lane)";
//   · `src/plugins/pack.dpdp/index.js` header — "the pack never writes app.students (core lane)";
//   · `src/plugins/admissions.funnel/index.js` — "invariant: no_core_students_writes".
//
// The sibling precedent for a plugin that needs a CORE STUDENT write is `admissions.funnel`: it raises a kernel
// approval action (`students.create.<leadId>`, an `app.actions` row) and the kernel's decide door executes the
// write (`executeStudentCreation`, src/routes.js). The plugin itself holds no SQL against `app.students`.
//
// DPDP erasure now has to reach that lane: a guardian who exercises erasure is otherwise still named on the
// student row, because the office lane keeps a DENORMALISED copy of the guardian contact
// (`app.students.guardian_name` / `guardian_phone`, migration 001:38-39) alongside the canonical
// `app.guardians` row. The erasure already rides the kernel approval spine — the SAR is an `app.actions`
// approval that a SECOND authority must decide (`/actions/:id/decide`, segregation of duties enforced in both
// the kernel and the pack) before the pack executes anything — so raising a second approval for the office-lane
// half would be approval theatre: the authorisation this mutation needs already exists. What must not happen is
// the pack gaining SQL against the office lane, because that is the invariant quoted above.
//
// So the boundary is kept and the pattern generalised one notch: the plugin REQUESTS a named core-lane action;
// THIS module — kernel code, which no plugin can extend — holds the only SQL that writes `app.students` on a
// plugin's behalf, and executes it. Two properties are deliberate and load-bearing:
//
//   1. It runs on the CALLER'S TRANSACTION CLIENT — the one `withUser(...)` opened — as `schoolos_app`. The
//      tenant policy on `app.students` (`USING/WITH CHECK tenant_id = app.current_tenant()`, migration 001)
//      therefore PROVES the tenant instead of trusting a parameter, and the redaction lands in the SAME
//      transaction as the rest of the erasure, so the journal's per-surface counts describe one atomic
//      operation rather than a half-erasure. Deliberately NOT `sysq`: the constrained role is sufficient here,
//      and `tests/rls-boundary.test.js` pins the owner-path inventory (adding privilege needs a justification,
//      and a path that proves tenancy is strictly better than one that asserts it).
//   2. The audit row is written HERE, in that same transaction (standing rule: the audit row is written in the
//      same transaction as the mutation). It names the action, the row count and the case reference — never the
//      erased value. Copying the PII we just removed into the hash-chained ledger would defeat the erasure.
//
// Adding a core-lane action means adding it to REGISTRY below, with its policy reference and reason: the list
// is the auditable answer to "what can a plugin make the kernel do to the office lane?".

const REGISTRY = Object.freeze({
  /**
   * `students.redactGuardianPii` — remove a data principal's denormalised guardian PII from the office lane.
   *
   * PARAMS: `{ subjectRef }` — the data principal's phone number in ANY format. Matching is on the
   * digit-normalised form, exactly as the DPDP pack matches every other surface it redacts, because the office
   * lane stores what a school office types (`+91 98444 00444`) while the pack keys on E.164 (`+919844440444`).
   *
   * WHAT IT WRITES, AND WHY THOSE TWO VALUES DIFFER:
   *   · `guardian_phone` → NULL. The module pseudonymises most surfaces with the tenant-scoped keyed surrogate,
   *     but this column is not a record — it is the office lane's CONTACT COPY, and two live consumers treat
   *     any non-empty value as a deliverable number: the fee-dunning sweep (`routes.js`, `if (!o.guardian_phone)
   *     { skippedNoContact += 1; continue; }` — it otherwise hands the value straight into
   *     `app.communications.audience_json`) and the clinic's guardian-notice path. A surrogate there would read
   *     as "contactable" everywhere those checks look and would queue a fee reminder addressed to a pseudonym;
   *     NULL makes every existing consumer take the branch it already has for "no contactable guardian on file".
   *     The durable pseudonym is not lost — the canonical `app.guardians` row keeps the surrogate.
   *   · `guardian_name` → `'[erased:<student id>]'`, the module's established tombstone (the same form
   *     `app.guardians.name` and `plugin_dpdp.sar.subject_ref` get), so the office lane can still see that a
   *     guardian existed and was erased, and joins to the erased guardian stay possible. An already-NULL name
   *     stays NULL: erasure removes data, it must not invent a tombstone for a field that held nothing.
   *
   * NULL is safe HERE and was checked before choosing it: `app.students.guardian_phone` and `guardian_name` are
   * both nullable (`text`, migration 001) with no NOT NULL, no CHECK and no unique index — verified in the live
   * catalogue as well as by reading every migration that touches the table (none alters it).
   *
   * IDEMPOTENT by construction: a second erasure for the same subject matches no row, because the phone it would
   * match on is now NULL — the same "second pass finds nothing left to redact" behaviour the other surfaces
   * report as 0. Tenant-scoped in the WHERE clause AND by RLS.
   *
   * SCOPE NOTE, so nobody widens this by accident. `app.students` has three person-naming columns; this action
   * writes exactly two. The subject of a DPDP erasure here is a data principal identified by a GUARDIAN PHONE,
   * and `app.students.name` is the PUPIL's name — a different data principal, whose record the school keeps
   * under its own lawful basis. (docs/PERFECT-100 DAT-16 named all three parent columns; the owner's decision
   * covers the office lane's denormalised GUARDIAN PII, not the pupil's name.) A future erasure that must reach
   * a pupil's own identity needs its own decision and its own action here — not a wider WHERE clause.
   */
  'students.redactGuardianPii': {
    policyRef: 'DPDP Act 2023 · right to erasure',
    reason: 'data-principal erasure executed through the kernel approval spine',
    async run(client, { tenantId, params }) {
      const norm = String(params?.subjectRef ?? '');
      if (!/\d/.test(norm)) {
        throw Object.assign(new Error('core-lane action students.redactGuardianPii needs a subjectRef phone'), { statusCode: 400 });
      }
      const r = await client.query(
        `UPDATE app.students
            SET guardian_phone = NULL,
                guardian_name  = CASE WHEN guardian_name IS NULL THEN NULL ELSE '[erased:' || id || ']' END
          WHERE tenant_id = $1
            AND guardian_phone IS NOT NULL
            AND regexp_replace(guardian_phone, '[^0-9]', '', 'g') = regexp_replace($2::text, '[^0-9]', '', 'g')`,
        [tenantId, norm]);
      return {
        affected: r.rowCount,
        detail: { surface: 'students.guardian_denormals', guardianPhone: 'nulled', guardianName: 'tombstoned' },
      };
    },
  },
});

/**
 * Build the kernel-side executor handed to plugins as `kernel.requestCoreLaneAction`.
 *
 * `auditLog` is injected rather than imported so the kernel has exactly one audit implementation
 * (`src/audit.js`) and this module cannot drift from it.
 */
export function makeCoreLaneActions({ auditLog }) {
  if (typeof auditLog !== 'function') throw new Error('makeCoreLaneActions needs the kernel auditLog');

  return async function requestCoreLaneAction(client, request) {
    const { action, tenantId, actor = null, actorRole = 'plugin', caseRef = null, params = {} } = request ?? {};
    const spec = REGISTRY[action];
    // Unknown action: fail LOUD. A silent no-op here would be an erasure that reports success while the PII
    // stays where it was — the exact failure this whole path exists to prevent.
    if (!spec) throw Object.assign(new Error(`unknown core-lane action "${action}"`), { statusCode: 500 });
    if (!client || typeof client.query !== 'function') {
      throw Object.assign(new Error(`core-lane action ${action} must run on the caller's transaction client`), { statusCode: 500 });
    }
    if (!tenantId) throw Object.assign(new Error(`core-lane action ${action} needs a tenantId`), { statusCode: 500 });
    // RTE-20: do not TRUST the caller-supplied tenant. The client is the caller's `withUser` transaction, so
    // `schoolos.tenant_id` is the authoritative tenant; enforce that they agree. An owner/maintenance path
    // with no GUC is exempt (and its own scope is already privileged), so only a mismatch is fatal.
    const guc = (await client.query(`SELECT app.current_tenant() AS t`)).rows[0]?.t ?? null;
    if (guc && String(guc) !== String(tenantId)) {
      throw Object.assign(new Error('core-lane action tenant does not match the session tenant'), { statusCode: 403 });
    }

    const result = await spec.run(client, { tenantId, params });

    // Same transaction as the mutation above (audit_log is append-only for the app role; the row's hash is
    // pinned by the database — migration 075). No erased value appears in any field of this row.
    const auditRow = await auditLog(client, tenantId, {
      actor: actor ?? 'kernel',
      actorRole,
      action: `Core-lane action executed: ${action} (plugin-requested, kernel-executed)`,
      recordType: 'CoreLaneAction',
      recordRef: caseRef ?? action,
      reason: spec.reason,
      policyRef: spec.policyRef,
      risk: 'high',
      outcome: `${result.affected} office-lane record(s) redacted on surface ${result.detail?.surface ?? action} (0 = nothing left to redact) · count only, no erased value recorded`,
    });

    return { action, affected: result.affected, detail: result.detail ?? {}, auditId: auditRow?.id ?? null };
  };
}

/** The action names a plugin may request — exported for documentation/tests. */
export const CORE_LANE_ACTIONS = Object.freeze(Object.keys(REGISTRY));
