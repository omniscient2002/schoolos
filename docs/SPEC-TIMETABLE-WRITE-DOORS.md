# SPEC — Timetable write doors (make the timetable buildable from the app)

> **STATUS: SPEC ONLY — NOT IMPLEMENTED.**
> Hand-off document for another session. It fixes the audit finding that a self-signup school
> cannot define a timetable because `ops.timetable` ships only read/substitute/autofill doors.

---

## 1. Problem (evidence)

`server/src/plugins/ops.timetable/index.js` registers exactly four doors:
`GET /grid`, `POST /substitutions`, `GET /substitutions/suggest`, `POST /attendance/autofill`.
There is **no door that writes `app.timetable_periods` or `app.timetable_slots`.**

Those tables are populated only by **migration seeds** (`migrations/010_wave1_plugin_runtime.sql:140-164`,
copied in `021_ops_timetable.sql:...`), which run for tenants that exist at migrate time. So:
- A tenant created by self-signup **after** migrations has **0 periods / 0 slots** (observed live:
  Cassandra International School = 0; Meridian = 10).
- Everything that reads the grid then shows empty: teacher home/roster/workload, coordinator
  curriculum monitor, student timetable, substitution suggestions, attendance autofill, and the
  kernel `/timetable/clash-check`.

Kernel `/timetable/clash-check` (`server/src/routes.js` — `POST /timetable/clash-check`) only
**checks** proposals; it does not persist them.

---

## 2. Objective

Any school (including self-signup) can create, edit and retire its **periods** and **slots**
through the app, with validation, clash prevention, audit, and events — without kernel edits.

---

## 3. Scope decision (two phases)

| Phase | Scope | Why |
|---|---|---|
| **A (required)** | Period CRUD + slot CRUD matching today's **section-agnostic** model; a management UI | Makes the timetable buildable; minimal risk |
| **B (recommended)** | **Section-aware** slots (`grade`,`section`,`teacher_id`); per-section grid; section clash detection | Fixes the "first-period teacher takes attendance" model and per-class timetables |
| **C (separate)** | Period-wise attendance model | Bigger; depends on B |

---

## 4. Phase A — exact edits

All new doors live in `server/src/plugins/ops.timetable/index.js` (no kernel edits). Every write
uses `withUser` + `requestAudit` + `emitEvent`.

### 4.1 Data model (soft-delete, because the app role has no DELETE)
`migrations/072_acl_repair.sql:11-12` documents that the app role must never hold table-level
DELETE. So retirement is a **status update**, not a delete. New migration:
```sql
ALTER TABLE app.timetable_periods ADD COLUMN IF NOT EXISTS retired_at timestamptz;
ALTER TABLE app.timetable_slots   ADD COLUMN IF NOT EXISTS retired_at timestamptz;
CREATE INDEX IF NOT EXISTS tt_periods_active_idx ON app.timetable_periods(tenant_id) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS tt_slots_active_idx   ON app.timetable_slots(tenant_id)   WHERE retired_at IS NULL;
```

### 4.2 Doors
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/plugins/ops.timetable/periods` | staff read set (grid's) | active only |
| POST | `/plugins/ops.timetable/periods` | owner/principal/coordinator | create |
| PATCH | `/plugins/ops.timetable/periods/:id` | owner/principal/coordinator | edit label/times/sort |
| POST | `/plugins/ops.timetable/periods/:id/retire` | owner/principal | soft-retire |
| POST | `/plugins/ops.timetable/periods/seed-default` | owner/principal | optional: seed the standard Indian day |
| GET | `/plugins/ops.timetable/slots` | staff read set | filters: `dayOfWeek`, `periodId` |
| POST | `/plugins/ops.timetable/slots` | owner/principal/coordinator | create + clash check |
| PATCH | `/plugins/ops.timetable/slots/:id` | owner/principal/coordinator | edit |
| POST | `/plugins/ops.timetable/slots/:id/retire` | owner/principal | soft-retire |

### 4.3 Validation (mirror the clash-check contract)
- `period.seq` ≤8 chars, unique per tenant (`UNIQUE(tenant_id,seq)` → 409);
  `label` ≤60; `start_time`/`end_time` match `HH:MM`; `is_break` bool; `sort_idx` int ≥0.
- `slot.day_of_week` ∈ `Monday…Saturday`; `subject` ≤60; `teacher_name` ≤80; `room` ≤40;
  `period_id` must exist in-tenant.
- **Clash prevention:** before insert, run the same lookup the kernel clash-check uses
  (`timetable_slots` where same `period_id` + `day_of_week` + `teacher_name`/`room`). Refuse with
  a friendly 409 naming the conflicting slot unless `force:true`. Reuse one shared helper to avoid
  two implementations drifting.

### 4.4 Audit + events
- Audit each write (`recordType:'Plugin'`, `risk:'low'`, actor, before/after summary).
- Emit `timetable.published.v1` (declared in the manifest) on slot create/update/retire, with
  `{ slotId, periodId, dayOfWeek, subject, teacher }`.
- `seed-default` audits one summary row and emits one event.

### 4.5 Seed default template (Indian school day)
The migration's demo template (`08:00–15:45`, 8 periods + morning break + lunch) is a sensible
default. Expose it as an **opt-in** button (`seed-default`), never auto-run.

---

## 5. Phase B — section-aware slots (recommended)

### 5.1 Data model
```sql
ALTER TABLE app.timetable_slots ADD COLUMN IF NOT EXISTS grade   text;
ALTER TABLE app.timetable_slots ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE app.timetable_slots ADD COLUMN IF NOT EXISTS teacher_id uuid REFERENCES app.users(id);
-- one subject per class-section period:
CREATE UNIQUE INDEX IF NOT EXISTS tt_slots_class_period_uidx
  ON app.timetable_slots(tenant_id, period_id, day_of_week, grade, section)
  WHERE retired_at IS NULL;
```
- Keep `teacher_name` for display/back-compat; `teacher_id` becomes the link.
- Existing seeded slots have `grade/section = NULL` (school-wide); new per-class slots set them.

### 5.2 Behaviour changes
- `GET /grid` accepts `grade`+`section` and returns that class's grid (falling back to
  school-wide slots when none are section-scoped).
- Clash-check gains **section clash** detection (two subjects for the same class-period).
- Teacher home/roster/workload/handover switch from `teacher_name` matching to `teacher_id`
  (fixes the free-text seam noted in `migrations/083_class_assignments.sql:10-14`).
- **First-period-teacher attendance:** the register owner for a class-section can be derived from
  `slot(day, period=1, grade, section).teacher_id` — enabling the model discussed for attendance.

---

## 6. UI

Add a `/timetable` screen (owner/principal/coordinator):
- **Phase A:** period editor (seq/label/times/break/sort) + a school-wide weekly grid.
- **Phase B:** a class-section picker; per-class weekly grid; drag/assign subject+teacher.
Add a nav entry and a `KernelGate plugin="ops.timetable"` guard (the plugin is `defaultEnabled:false`
but `ops.timetable` is in `DEFAULT_ON` — verify gating).

---

## 7. Tests

- Periods: create/edit/retire; duplicate `seq` → 409; bad time format → 400; retire hides from grid.
- Slots: create; duplicate/ clash → 409; `force` overrides; retire hides.
- `seed-default` idempotent (no duplicates on re-run).
- RLS: two tenants cannot see each other's periods/slots.
- (Phase B) section-aware grid; section clash detected; first-period lookup returns the right teacher.
- No DELETE anywhere (grep the plugin for `DELETE FROM app.timetable` must be empty).

---

## 8. Backward compatibility

- Additive only: new columns nullable, new doors new. Seeded tenants keep their grid.
- Reads must add `retired_at IS NULL` (or `active`) filters; existing rows are active.
- No data rewrite; no DELETE.

---

## 9. Open decisions

1. **Phase B now or later?** (Section-aware slots unlock per-class timetables + first-period
   attendance, but touch teacher-home/clash-check.)
2. **One subject per class-period**, or allow double periods/co-teaching?
3. **Period-wise attendance** in scope (Phase C), or keep daily?
4. **Who may edit** — owner/principal/coordinator, or add itadmin?
5. **Overlap validation** — must periods be non-overlapping and chronologically ordered?

---

## 10. Reviewer checklist

- [ ] Period + slot create/edit/retire doors present, role-gated, audited.
- [ ] Clash prevention reuses one shared helper (no drift with `/timetable/clash-check`).
- [ ] No table-level DELETE; retirement is a status update.
- [ ] `retired_at` added + all grid reads filter it.
- [ ] Events emitted (`timetable.published.v1`).
- [ ] Tests green incl. two-tenant RLS and duplicate/clash 409.
- [ ] UI screen + nav entry added.
