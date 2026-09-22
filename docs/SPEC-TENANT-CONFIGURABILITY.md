# SPEC — Tenant configurability: defaults-first, opt-in overrides

> **STATUS: SPEC ONLY — NOT IMPLEMENTED.**
> Hand-off document for another session. It defines a per-tenant settings layer so every school
> gets sensible defaults and can opt into its own numbering/locale/academic conventions, one
> domain at a time, without breaking existing behavior.
>
> Read-only audit origin: this spec records call-sites found by inspection; line numbers may drift.

---

## 1. Objective & principles

**Goal:** every school numbers and configures things its own way, but no school is forced to
configure anything.

| Principle | Meaning |
|---|---|
| **Defaults-first** | Every domain has a kernel default equal to today's behavior. A tenant with zero settings rows works exactly as now. |
| **Opt-in** | A school overrides only what it cares about, in any order (its own "priority"). Unset keys fall through to the default. |
| **One resolver** | All code reads settings through one resolver; no ad-hoc reads scattered per feature. |
| **Backward compatible** | No data rewrite. New migrations add tables/columns only. Existing rows keep their values. |
| **Audited + validated** | Every settings write is schema-validated and written to the hash-chained ledger. |
| **Server-authoritative** | The client only renders; the server resolves and enforces. |
| **India-first** | Defaults follow common Indian school practice (April–March year, IST, INR, en-IN). Every default is overridable per school; timezone/currency are effectively fixed to India. |

---

## 2. Model

```
DEFAULT (kernel constant, per domain)
        │  deep-merge (tenant overrides win)
        ▼
app.tenant_settings (tenant_id, domain, settings jsonb, updated_at, updated_by)
        │
        ▼
resolveSettings(client, tenantId, domain)  →  effective settings
```

- **No row = all defaults.** A tenant only stores the keys it changed.
- **Resolution is a deep merge** (objects merge, arrays/scalars replace).
- **Caching:** resolve once per request (memoised on `req`, like the custom-role mask).
- **Versioning:** each domain has a `schema_version`; unknown keys are rejected on write.

### Storage (migration)
```sql
CREATE TABLE app.tenant_settings (
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id),
  domain     text NOT NULL,                 -- 'numbering' | 'locale' | 'academics' | 'attendance' | ...
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app.users(id),
  PRIMARY KEY (tenant_id, domain)
);
-- RLS ENABLE + FORCE, tenant_isolation policy (same as every app table)
```
Optional sequence store for the numbering engine:
```sql
CREATE TABLE app.numbering_sequences (
  tenant_id uuid NOT NULL,
  kind      text NOT NULL,                  -- 'admission_no' | 'employee_no' | 'roll_no' | 'work_order' | ...
  period    text NOT NULL DEFAULT '',       -- e.g. academic-year '2026-27' for per-year reset
  next_value bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, kind, period)
);
```

---

## 3. Domains & default values (defaults = today's behavior)

Defaults below are the **most common Indian school practice**. Every key is overridable per
school; only what a school changes is stored.

### 3.1 `numbering`
| Kind | Default format | Reset | Indian-school rationale |
|---|---|---|---|
| `admission_no` | `{year}/{serial:4}` | per academic year | e.g. `2026/0001` — year-prefixed running serial is the norm |
| `employee_no` | `EMP{serial:4}` | never | e.g. `EMP0001` — staff currently have no employee id |
| `roll_no` | `{serial:2}` | per academic year, per class-section | class-wise roll no, e.g. `01`, `02` |
| `work_order` | `WO-{serial:6}` | never | internal ops |
| `case` | `CASE-{serial:6}` | never | internal ops |
| `certificate` | `{kind}/{year}/{serial:4}` | per academic year | e.g. `TC/2026/0007`, `BONAFIDE/2026/0003` |
| `library_book` | `LIB-{serial:6}` | never | copy accession stays in library settings |
| `academic_year` | `{year}-{yy}` | — | e.g. `2026-27` |

Per-kind scheme keys (all optional): `prefix`, `format` (token string), `separator`, `padding`,
`reset` (`never` | `per_academic_year`), `start`.
Format tokens: `{year}` `{yy}` `{serial}` `{serial:N}` `{grade}` `{section}` `{kind}`.

### 3.2 `locale` (India-only defaults; timezone/currency effectively fixed)
| Key | Default |
|---|---|
| `timezone` | `Asia/Kolkata` |
| `currency` | `INR` |
| `locale` | `en-IN` |
| `date_format` | `dd-MM-yyyy` |
| `week_start` | `monday` |
| `academic_year_start_month` | `4` (April) |

### 3.3 `academics`
| Key | Default | Indian-school rationale |
|---|---|---|
| `grading_scales` | `['cbse_10_point','percent','gpa_4']` | CBSE 10-point and percentage are the common scales |
| `terms` | `['Term 1','Term 2']` | two-term year is most common; free-form per school |
| `promotion_policy` | `{ mode: 'manual' }` | promotion is a school decision |
| `attendance_eligibility_pct` | `75` | CBSE exam-eligibility norm |

### 3.4 `attendance`
| Key | Default | Rationale |
|---|---|---|
| `model` | `daily` | Indian schools take a daily register per class-section by the class teacher; `period` is opt-in |
| `mark_by` | `class_teacher` | form teacher owns the register |
| `notify_guardian_on_absence` | `true` | absence notice to guardian is standard |
| `late_counts_present` | `true` | late ≠ absent |

### 3.5 `identity` (structural, default = today)
| Key | Default | Rationale |
|---|---|---|
| `student_user_link` | `false` | most schools manage students via the office/parent account; opt-in to link at scale |
| `normalize_classes` | `false` | tenant JSONB classes are enough for most schools; opt-in to normalize |

---

## 4. Numbering engine (`src/numbering.js`)

```js
// atomic, tenant-scoped, format-driven
export async function nextNumber(client, tenantId, kind, { period = '', tokens = {} } = {}) {
  // 1. resolve the kind's scheme from tenant settings (defaults when unset)
  // 2. pg_advisory_xact_lock(hashtext(`num:${tenantId}:${kind}:${period}`))
  // 3. INSERT ... ON CONFLICT DO UPDATE SET next_value = next_value + 1 RETURNING next_value
  // 4. format the token string with the serial + caller tokens ({grade},{section},{year})
  return formatted;
}
```
- **Atomic** under the existing transaction (the fee-receipt advisory-lock pattern, `routes.js:1484`).
- **Idempotent per call**; a retried transaction reuses the same value only if the row rolled back.
- **Never renumbers existing rows** — only future inserts.

### Call-sites to convert
| Generator | Current | File:line |
|---|---|---|
| Admission no (manual add) | `ADM-${Date.now().toString(36)}` | `routes.js:625` |
| Admission no (admissions convert) | `ADM-<AY>-<lead8>` | `routes.js:2613,2624` |
| Admission no (migration import) | `MIG-<src8>-<rowNo>` | `routes.js:3962` |
| Admission no (CSV import) | `IMP-<base36>-<hex>` | `people.admin/index.js:526` |
| Work-order code | `WO-<base36>` | `routes.js:1899` |
| Case code | `case_<uuid8>` | `routes.js:2020` |
| Certificate serial | `CERT-<kind>-<year>-<uuid6>` | `routes.js:2459` |
| Library book code | `LIB-<base36>-<hex>` | `library/index.js:339,908` |
| Academic-year format | `${y}-${(y+1)%100}` | `admissions.funnel/index.js:24`, `ops.udise/index.js:38` |

**Already configurable — leave as the model to copy:**
- Fee receipt prefix/series: `routes.js:969-984,1486-1491` (`fee_settings.receipt_prefix`, `receipt_series_start`).
- Library **copy** identifier scheme: `library/index.js:62-63,366-381` (`identifier_scheme`, `identifier_prefix`, `accession_start`, `accession_padding`).

---

## 5. Locale layer (`src/locale.js`)

**India-only decision:** timezone (`Asia/Kolkata`) and currency (`INR`) are fixed defaults; a
school may still override `date_format`, `week_start` and `academic_year_start_month`. The layer
is still centralised (not left hardcoded) so multi-region is possible later without a rewrite.

Generalise the IST helper (`src/ist.js`) into a tenant-aware module:
```js
resolveLocale(tenantId) → { timezone, currency, locale, dateFormat }
formatMoney(cents, locale)      // replaces hardcoded ₹/INR
formatDate(d, locale)           // replaces en-IN / dd-mm-yyyy assumptions
todayInTz(locale)               // replaces ('now' AT TIME ZONE 'Asia/Kolkata')::date
```
**Hardcoded sites to route through it (defaults preserve behavior):**
| Hardcoding | File:line |
|---|---|
| `Asia/Kolkata` (IST) | `ist.js`, `routes.js:2167,2204,2254`, `family.view/index.js:88`, `app.js:1693`, `ops.timetable/index.js:41-42` |
| `₹` / `INR` / paise | `fees/receipt-pdf.js:46`, `fees/dunning.js:49-59`, `routes.js:1397-1398,1551,3058-3079` |
| `en-IN` | `generated/seed.js:680` |

> Note: DB timestamps are `timestamptz`; only **display** and **"today"** calculations need the
> tenant timezone. `('now' AT TIME ZONE 'Asia/Kolkata')::date` must become a parameterised zone.

---

## 6. Settings surface (doors + UI)

### Doors (owner / principal / itadmin)
```
GET  /settings/:domain            → { domain, effective, defaults, overrides, schema_version }
PUT  /settings/:domain            → validate, upsert app.tenant_settings, audit, forget cache
POST /settings/:domain/reset      → remove overrides (back to defaults), audit
```
- Validation: per-domain schema; reject unknown keys; coerce/limits.
- Audit: `Settings updated: numbering` (`recordType:'TenantSettings'`, risk medium).
- Reads are auth-only; writes are owner/principal/itadmin (mirror `POST /plugins/:id/settings`).

### UI
A **School settings → Conventions** screen, grouped by domain and priority (Numbering, Locale,
Academics, Attendance, Identity). Each domain shows **Default** vs **Customised**, with a
"Customise" toggle. Schools configure only what they want; the rest stay default.

---

## 7. Backward compatibility & migration

- **No data migration.** Existing students/users keep their current numbers; only future
  generations use the scheme. (Codes are for uniqueness + display, not keys.)
- **Defaults equal today's behavior** where a single behavior exists. Where today is ad-hoc
  (admission no), the default becomes one coherent format; document this in release notes.
- **Structural toggles default off** (attendance `daily`, `student_user_link:false`,
  `normalize_classes:false`) — zero change until a school opts in.
- **Sequence seeds:** on first use of a kind, seed `next_value` from the max existing serial so a
  school that adopts a scheme mid-life does not collide. Provide a one-off `scripts/backfill-numbering.js`.

---

## 8. Tests

- Unit: resolver deep-merge, token formatting, padding, per-year reset.
- Integration: two tenants with **different** admission schemes generate non-colliding numbers in
  the same DB (the key scalability proof).
- Regression: unset settings ⇒ exact current behavior (pin the default format).
- Settings door: validation, audit row, RLS isolation.
- Locale: `todayInTz` at the 00:00–05:30 IST boundary (the bug `ist.js` documents).

---

## 9. Phasing

| Phase | Scope | Risk |
|---|---|---|
| **1** | Settings store + resolver + doors; `numbering` engine; convert admission_no + employee_no + roll_no | low (defaults) |
| **2** | Locale layer; convert timezone/currency/date sites | low–medium |
| **3** | Convert work-order/case/certificate/library-book/academic-year formats | low |
| **4** | Structural toggles: attendance model, student↔user link, classes normalization | medium–high (decide separately) |

---

## 10. Decisions (resolved)

| # | Decision | Resolution |
|---|---|---|
| 1 | Geography | **India only.** IST / INR / en-IN are the defaults; timezone/currency effectively fixed. |
| 2 | Admission scheme | **School-configurable**, default `{year}/{serial:4}` per academic year. |
| 3 | Employee no / roll no | **Both provided, school-configurable.** Defaults `EMP{serial:4}` and class-wise `{serial:2}`. |
| 4 | Attendance | **Daily default** (class-teacher register); `period` is an opt-in model. |
| 5 | Student identity | **Configurable**; default stays name-match (`student_user_link:false`); opt-in link. |
| 6 | Classes | **Configurable**; default stays tenant JSONB (`normalize_classes:false`); opt-in normalize. |

**Guiding rule:** nothing is mandatory to configure. A school that configures nothing gets the
Indian-school defaults above; a school overrides only the domains it cares about, in its own order.

---

## 11. Reviewer checklist

- [ ] Defaults preserve current behavior (regression test pinned).
- [ ] One resolver; no feature reads settings ad hoc.
- [ ] All converted generators go through `nextNumber`; no ad-hoc date/uuid codes remain.
- [ ] Two-tenant differing-scheme test green.
- [ ] Settings writes validated + audited; RLS isolation holds.
- [ ] Locale sites parameterised; defaults IST/INR/en-IN.
