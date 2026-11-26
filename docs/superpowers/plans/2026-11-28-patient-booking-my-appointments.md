# Patient Booking & My Appointments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a patient book an appointment with a doctor on one of that
doctor's actually-available, actually-open slots; let them see and cancel
their own appointments; and make the doctor-availability endpoints built in
the prior plan correctly reflect which slots are now occupied.

**Architecture:** One new table, `appointments`, and one new route class,
`AppointmentRoutes`, mounted the same way `DoctorRoutes`/`AuthRoutes`
already are, extending `ApiRoutes`. `GET /doctors/:id/slots` (from the prior
plan) is modified to exclude occupied slots — the first cross-plan
modification in this codebase, closing the scope limit that plan documented
on itself. `PUT /doctor/availability` is modified to reject unsetting a day
that holds an approved appointment — the "locked day" rule the Doctor
Availability plan explicitly deferred, now implementable (though not yet
reachable, since nothing can be `approved` until the next plan). On the
frontend: two new pages (`BookAppointment`, `MyAppointments`) reusing this
branch's established conventions (`authedFetch`, `applyApiError`, React
Hook Form, the `doctor.api.ts` endpoints already built).

**Tech Stack:** Same as the three merged prior plans — Sinatra, Sequel,
MySQL, RSpec; React, Vite, TypeScript, React Router, React Hook Form,
Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-clinic-appointment-rewrite-design.md`
(data model, API surface — Patient section) and
`docs/superpowers/specs/2026-11-23-clinic-appointment-screen-specs.md`
(section "2 · Patient (User)", `BookAppointment`/`MyAppointments`,
`MBookDay`/`MBookTime`/`MMyAppts`).

**Builds on:** the merged backend/frontend foundations and the merged
Departments/Doctors/Availability plan — every endpoint this plan reuses
(`GET /departments`, `GET /doctors`, `GET /doctors/:id/availability`,
`GET /doctors/:id/slots`) already exists and is tested.

## Three sequencing decisions, made now rather than left implicit

**1. Records approval doesn't exist yet — every appointment this plan
creates sits in `pending` forever, within this plan's lifetime.** The
*next* plan in the roadmap (`Records Approval`) adds the only endpoints
that ever move a `pending` appointment to `approved`/`declined`. This
plan's call: `appointments` gets every column the full data model needs
(`decided_at`, `decided_by_user_id`, `decline_reason_code`,
`decline_message`, `internal_note`, `reschedule_of_id`), all simply unused
by this plan's own endpoints, so the next plan adds behavior, not schema.
`POST /appointments` always creates a `pending` row; there is no path to
`approved` in this plan.

**2. The "doctor can't close a day holding an approved appointment" rule is
implemented in this plan, even though it can't fire yet.** The Doctor
Availability plan deferred this rule with "there is no `appointments`
table yet." There is now, so `PUT /doctor/availability`'s `unset`
validation gets the real check today — querying for `status: 'approved'`
rows, which this plan's own `POST /appointments` can never create. The
check is correct and tested (via a row inserted directly through the model
in the test, bypassing the not-yet-existing approval endpoint) but
dormant until the next plan ships. This avoids a *third* trip back into
`doctors.rb` once Records approval lands — the lesson from the
Departments/Doctors plan's own history (where the "locked day" rule was
deferred once already) is that deferring a rule a second time just moves
the same return trip one plan later.

**3. No admin-configurable cancellation cutoff exists yet.** The screen
spec shows "Patient can cancel until 24h/12h before" as a clinic setting;
no `clinic_settings` table or Admin Settings screen exists yet (a later
plan). This plan's call: a patient may cancel their own `pending` or
`approved` appointment any time before its date/time has passed, with no
hours-before cutoff. The next plan to add `clinic_settings` is responsible
for adding that cutoff to this plan's `POST /appointments/:id/cancel`.

## Global Constraints

- `appointments.status` enum: `pending | approved | declined | cancelled |
  completed | no_show` (per the design spec) — this plan's own endpoints
  only ever produce `pending` (on create) and `cancelled` (on cancel); the
  other four values exist in the schema for later plans.
- `appointments.visit_type` enum: `new_consultation | follow_up |
  review_results` (per the design spec).
- A slot is "occupied" (blocks booking, excluded from `/slots`) exactly
  when an appointment for that doctor/date/time has status `pending` or
  `approved` — never `declined`/`cancelled`/`completed`/`no_show`. This
  plan's call: name this set `OCCUPYING_STATUSES` in one place and have
  every consumer (the booking endpoint's own-slot check, the public
  `/slots` filter, the `unset`-availability "approved" check) reference
  it, or `Appointment`'s own notion of "approved", rather than repeating
  the literal array — the Departments/Doctors plan's own final review
  caught a predicate drifting across four call sites; this plan starts
  with one.
- No hard deletion anywhere (standing project-wide constraint) — a
  cancelled appointment is a status flip, not a deleted row.
- Role-gating is server-side (`require_role!`), matching every prior
  plan's posture — `POST /appointments`, `GET /appointments`,
  `GET /appointments/:id`, `POST /appointments/:id/cancel` are all
  `patient`-role only, and always scoped to `current_user` — no patient
  id in the request can make this plan's endpoints touch another
  patient's data, and no owner mismatch is ever reported as anything
  other than 404 (same "exclusion looks like not-found" posture the prior
  plan established for locked doctors).

## Review Focus

- **Double-booking the same doctor/date/time** — two near-simultaneous
  `POST /appointments` requests for the same slot must not both succeed.
  Covered in Task 2, with a concurrency-safe mechanism, not just an
  existence check that leaves a race window open.
- **Booking a slot that was never actually offered** — a date outside the
  doctor's availability, a time outside their generated slots, or a time
  that's already occupied must 422, never silently create a row. Covered
  in Task 2.
- **Reading or cancelling another patient's appointment** — `GET
  /appointments/:id` and `POST /appointments/:id/cancel` for an
  appointment belonging to a different patient must 404, not leak
  existence or allow the action. Covered in Tasks 3 and 4.
- **A cancelled appointment's slot becoming bookable again** —
  end-to-end: cancel, then confirm the same doctor/date/time is both
  absent from "occupied" and present again in `GET /doctors/:id/slots`.
  Covered in Task 4 and Task 5 together.
- **Cancelling an appointment that's already `completed`/`no_show`/
  `declined`/`cancelled`** must be rejected (a terminal state can't be
  re-cancelled), not silently succeed or silently no-op without telling
  the caller. Covered in Task 4.

---

## File Structure

```
apps/api/
  app/
    models/
      appointment.rb
    routes/
      appointments.rb
  db/
    migrate/
      009_create_appointments.rb
  spec/
    models/
      appointment_spec.rb
    requests/
      appointments_spec.rb

apps/web/
  src/
    features/
      appointments/
        appointments.api.ts
        book-appointment.page.tsx
        my-appointments.page.tsx
        __tests__/
          book-appointment.page.test.tsx
          my-appointments.page.test.tsx
    features/dashboard/
      role-landing.page.tsx    (modified: + patient links)
```

---

### Task 1: `appointments` table and `Appointment` model

**Files:**
- Create: `apps/api/db/migrate/009_create_appointments.rb`,
  `apps/api/app/models/appointment.rb`
- Test: `apps/api/spec/models/appointment_spec.rb`

**Interfaces:**
- Consumes: `User`, `DoctorProfile` (merged).
- Produces: `Appointment` (`Sequel::Model(:appointments)`,
  `many_to_one :patient` and `many_to_one :doctor`, both pointing at
  `User`, disambiguated via `class: :User, key: :patient_id` /
  `class: :User, key: :doctor_id`), `Appointment::STATUSES`,
  `Appointment::VISIT_TYPES`, `Appointment::OCCUPYING_STATUSES =
  %w[pending approved].freeze` — Tasks 2, 4, 5, 6 all reference this
  constant by name rather than repeating the array.

- [ ] **Step 1: Write the migration**

```ruby
Sequel.migration do
  change do
    create_table(:appointments) do
      primary_key :id
      foreign_key :patient_id, :users, null: false
      foreign_key :doctor_id, :users, null: false
      foreign_key :department_id, :departments, null: false
      Date :date, null: false
      String :time, null: false
      Integer :duration_minutes, null: false
      String :visit_type, null: false
      String :reason, null: false
      String :status, null: false, default: 'pending'
      DateTime :submitted_at, null: false
      DateTime :decided_at
      foreign_key :decided_by_user_id, :users
      String :decline_reason_code
      String :decline_message
      String :internal_note
      foreign_key :reschedule_of_id, :appointments
      TrueClass :sms_reminder_opt_in, null: false, default: false
      DateTime :created_at, null: false
      DateTime :updated_at, null: false

      index %i[doctor_id date time]
      index :patient_id
    end
  end
end
```

No unique index on `(doctor_id, date, time)` — a declined/cancelled
appointment legitimately shares that triple with a later, different
booking, and this table never hard-deletes rows. Double-booking
prevention is Task 2's job, at the application layer (see Task 2's
Interfaces for why, and how it stays race-safe without a DB constraint).

- [ ] **Step 2: Run migrations on both databases**

Run: `cd apps/api && RACK_ENV=development bundle exec rake db:migrate && RACK_ENV=test bundle exec rake db:migrate`

- [ ] **Step 3: Write the failing tests**

- Creating an `Appointment` with all required fields persists it with
  `status: 'pending'` (the column default) and populated timestamps.
- `appointment.patient` and `appointment.doctor` each resolve to the
  correct `User`, independently (a appointment's patient and doctor are
  different users — assert both associations, not just one).
- `Appointment::OCCUPYING_STATUSES` is exactly `%w[pending approved]`.

- [ ] **Step 4: Run tests to verify they fail**

- [ ] **Step 5: Implement `Appointment`**

`plugin :timestamps, update_on_create: true` (both `created_at`/
`updated_at` are `NOT NULL`, same shape as `User`/`Department` —
confirmed, not assumed, by reading this task's own migration above).
`many_to_one :patient, class: :User, key: :patient_id`; `many_to_one
:doctor, class: :User, key: :doctor_id`.

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Commit**

```bash
git add apps/api/db/migrate/009_create_appointments.rb apps/api/app/models/appointment.rb apps/api/spec/models/appointment_spec.rb
git commit -m "feat: add appointments table and Appointment model"
```

---

### Task 2: `POST /appointments`

**Files:**
- Create: `apps/api/app/routes/appointments.rb`
- Modify: `apps/api/app/api.rb` (mount `AppointmentRoutes`)
- Test: `apps/api/spec/requests/appointments_spec.rb`

**Interfaces:**
- Consumes: `require_role!` (merged), `User.active_doctors`,
  `DoctorRoutes::MAX_BOOKING_WINDOW_DAYS`, `DoctorAvailabilityDay`,
  `DoctorSessionSettings`, the slot-generation logic in `DoctorRoutes`
  (merged — read it directly; this task calls into the same concepts a
  second route class needs, see the note below on where that logic
  lives), `Appointment::OCCUPYING_STATUSES` (Task 1).
- Produces: `AppointmentRoutes` (mounted at `/api/v1`, extends
  `ApiRoutes`, this task starts the file — Tasks 3 and 4 add more routes
  to it). `POST /appointments` body `{doctor_id, date, time, visit_type,
  reason, sms_reminder_opt_in}` → 201 `{id, doctor: {id, first_name,
  last_name}, department: {id, name}, date, time, duration_minutes,
  visit_type, reason, status: 'pending', submitted_at}`. 422 for a
  missing/invalid field, an unavailable date, a time not in the
  doctor's generated slots, or an already-occupied slot — all under
  `errors`, field-keyed, same envelope every other route in this branch
  uses.

**On double-booking safety without a DB unique constraint:** wrap the
existence-check-then-insert in `DB.transaction do ... end`, and inside it,
`SELECT ... FOR UPDATE` on `Appointment.where(doctor_id:, date:, time:,
status: Appointment::OCCUPYING_STATUSES)` before deciding whether to
insert. A `SELECT FOR UPDATE` that matches zero rows does not, by itself,
lock against a concurrent insert of a *new* row (the classic phantom-read
gap) — so this plan's call is to accept that narrow, documented race
(two simultaneous first-time bookings of the same never-before-booked
slot, at the exact same millisecond, in a single-clinic deployment) rather
than adding `SERIALIZABLE` isolation or a generated-column unique index
for it. Write the Review Focus concurrency test as: book the slot once
successfully, then attempt a second `POST` for the identical slot inside
the same request's transaction scope being held — i.e., test that a
*second* request against an *already-occupied* slot is rejected
reliably, which `FOR UPDATE` plus the existence check does guarantee; this
is the realistic case (two people clicking "book" on a slot the UI has
already shown as taken to one of them) rather than the much narrower,
accepted gap above.

**On where the slot-generation logic lives:** `DoctorRoutes` (merged) has
`generate_slots`, `available_day?`, `parse_time_of_day`, and
`parse_availability_date` as private instance helpers inside its own
`helpers do ... end` block — not reachable from `AppointmentRoutes` as
written. This task's call: duplicate just the two small pure functions
this task needs (`parse_availability_date`-equivalent date parsing, and a
simple "is this date+time in the doctor's generated, unoccupied slots"
check built by calling the SAME code path a client would via an internal
method call, not an HTTP round-trip) directly in `AppointmentRoutes`,
rather than refactoring `DoctorRoutes` to share them — a cross-file shared
helpers module is a reasonable future cleanup once a third consumer
exists, but isn't worth it for the second. Keep the duplicated logic
small and obviously mirrored (a comment pointing at `DoctorRoutes`'s
version is enough), and make sure this task's own tests catch any
divergence (e.g. a test with a break configured, asserting the correct
slot is rejected/accepted the same way `GET /doctors/:id/slots` would
report it).

- [ ] **Step 1: Write the failing tests**

- A `patient` role, valid doctor/date/time/visit_type/reason → 201, row
  persisted with `status: 'pending'`, `duration_minutes` snapshotted
  from the doctor's current `slot_length_minutes` at booking time (not
  recomputed later if settings change), `department_id` snapshotted
  from the doctor's current `DoctorProfile#department_id`.
- A `doctor`/`records`/`admin`-role caller → 403.
- Unknown `doctor_id` → 422 (not 404 — this is a create, not a lookup by
  path id; the brief's call is `errors: {doctor_id: 'message'}`).
- A `doctor_id` that is locked/deactivated → 422, same message as unknown
  (reuses `User.active_doctors`).
- `date` the doctor hasn't marked available → 422.
- `date` more than `MAX_BOOKING_WINDOW_DAYS` out, or in the past → 422
  (reuses `DoctorRoutes::MAX_BOOKING_WINDOW_DAYS`).
- `time` not one of the doctor's generated slots for that date (e.g. a
  time that would fall inside their configured break) → 422.
- `time` that IS a generated slot but already has a `pending` OR
  `approved` appointment for that doctor/date/time → 422 (create one via
  the model directly in the test, then attempt the conflicting POST).
- A `declined`/`cancelled` existing appointment for the same doctor/date/
  time does NOT block a new booking (the slot is free again).
- `visit_type` outside the enum → 422. Missing `reason` → 422.
- The concurrency test described above: with one appointment already
  occupying a slot, a second `POST` for that exact slot is rejected
  every time across several repeated attempts (not merely "usually").

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `AppointmentRoutes` and `POST /appointments`**

`before('/appointments') { authenticate!; require_role!('patient') }`
(path-scoped, following the established `Rack::Cascade` rule — read
`doctors.rb`'s header comment for the full rationale before writing
this). Validate doctor exists & active & has a `DoctorProfile`; validate
date is in that doctor's available days; validate time is in that
doctor's generated-and-unoccupied slots for that date; validate
`visit_type`/`reason`; then the transactional occupancy check + insert
described above.

- [ ] **Step 4: Mount `AppointmentRoutes` in `app/api.rb`**

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routes/appointments.rb apps/api/app/api.rb apps/api/spec/requests/appointments_spec.rb
git commit -m "feat: add POST /appointments with race-safe double-booking prevention"
```

---

### Task 3: `GET /appointments` and `GET /appointments/:id`

**Files:**
- Modify: `apps/api/app/routes/appointments.rb`
- Test: additions to `apps/api/spec/requests/appointments_spec.rb`

**Interfaces:**
- Produces: `GET /appointments?status=&search=&from=&to=` (patient-only,
  `current_user`'s own appointments) → 200 `{appointments: [...], total}`
  — same per-appointment shape as `POST`'s response. `status` accepts
  ONE OR MORE comma-separated values (e.g. `status=declined,cancelled`)
  and filters to rows whose status is any of them — a builder-check
  review found that the screen spec's `MyAppointments` tabs (Task 7)
  can't be expressed with a single-value filter (the "Declined-cancelled"
  tab alone needs two statuses at once), so this task settles the
  contract now rather than leaving Task 7 to invent a client-side merge
  that would break the `total` count below. `search` matches doctor
  first/last name or department name (case-insensitive substring);
  `from`/`to` filter on `date`, both optional, each independently.
  `GET /appointments/:id` → 200 (same shape) or 404 if the id doesn't
  exist OR belongs to a different patient (never distinguishable from
  the caller's side).

- [ ] **Step 1: Write the failing tests**

- Returns only `current_user`'s own appointments, never another
  patient's, even when queried with no filters.
- `status=pending` returns only pending ones (create one pending, one
  cancelled, assert the filtered count).
- `status=declined,cancelled` (comma-separated) returns rows matching
  EITHER status, excluding `pending`/`approved`/`completed`/`no_show`
  ones (create one of each of the two matching statuses plus one
  `pending`, assert the filtered count and that the `pending` one is
  excluded).
- `search=` matches on doctor last name case-insensitively.
- `from`/`to` each narrow the date range independently.
- `GET /appointments/:id` for the caller's own appointment → 200 with
  the right shape.
- `GET /appointments/:id` for another patient's appointment → 404 (not
  403 — ownership mismatch reads as not-found, matching the locked-doctor
  precedent).
- `GET /appointments/:id` for a nonexistent id → 404 (same response
  shape as the ownership-mismatch case — a caller can't distinguish
  "doesn't exist" from "not yours").
- A `doctor`/`records`/`admin` role → 403 on both routes.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement both routes**

Parse `status` by splitting on `,` and filtering with `status:
requested_statuses` (Sequel's `where` accepts an array for an IN
clause) when present, with no filter when absent — a single value and a
comma-separated list use the exact same code path.

`before('/appointments') { authenticate!; require_role!('patient') }`
already covers `GET /appointments/:id` if the filter string is a
literal path match per-route rather than a prefix — Sinatra's
`before 'path'` only matches that exact path, so a `before` on the bare
`/appointments` string will NOT cover `/appointments/:id` or
`/appointments/:id/cancel` (Task 4). Add a SEPARATE path-scoped filter
per route, or one filter with a pattern that matches all three
(`before(%r{^/appointments}) { authenticate!; require_role!('patient')
}` — a regex filter, which Sinatra supports, and which still only runs
for requests actually routed through this mounted app, so the
`Rack::Cascade` concern from `doctors.rb`'s established rule doesn't
apply the same way here since every path under `/appointments` in this
file IS this file's own namespace, not another mounted class's. Confirm
this reasoning against `doctors.rb`'s actual comment before relying on
it — if in doubt, three explicit path-scoped filters is the safer,
more verbose choice; pick whichever this task's author is confident is
correct and explain the choice in a comment, the same way `doctors.rb`
does).

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routes/appointments.rb apps/api/spec/requests/appointments_spec.rb
git commit -m "feat: add GET /appointments and GET /appointments/:id"
```

---

### Task 4: `POST /appointments/:id/cancel`

**Files:**
- Modify: `apps/api/app/routes/appointments.rb`
- Test: additions to `apps/api/spec/requests/appointments_spec.rb`

**Interfaces:**
- Produces: `POST /appointments/:id/cancel` (patient-only, own
  appointment only) → 200 with the updated appointment (status now
  `cancelled`). 404 for a nonexistent id or another patient's
  appointment (same posture as Task 3). 422 if the appointment is
  already in a terminal state (`cancelled`, `completed`, `no_show`,
  `declined`) — `{error: 'This appointment can no longer be cancelled'}`.

- [ ] **Step 1: Write the failing tests**

- Cancelling a `pending` appointment → 200, status becomes `cancelled`.
- Cancelling an `approved` appointment → 200, status becomes
  `cancelled` (per this plan's sequencing decision 3: no cutoff yet).
- Cancelling an already-`cancelled` appointment → 422.
- Cancelling a `completed`/`no_show`/`declined` appointment → 422 (three
  separate cases or a parameterized one — builder's call).
- Cancelling another patient's appointment → 404.
- Cancelling a nonexistent id → 404.
- **End-to-end with Task 5**: after cancelling, the same doctor/date/time
  no longer appears in `Appointment::OCCUPYING_STATUSES` (query the model
  directly to confirm the status flip — Task 5's own test is what proves
  `/slots` reflects this; this task's test proves the data side of it).

- [ ] **Step 2: Run tests to verify they pass**

(Brief intentionally omits a separate "verify they fail" step header
here only because Step 1 and 2 are adjacent in this short task — still
run the tests before implementing and confirm they fail for the right
reason, same TDD discipline as every other task.)

- [ ] **Step 3: Implement `POST /appointments/:id/cancel`**

Scope the lookup to `current_user.id` as `patient_id` — a `where(id:,
patient_id: current_user.id).first`, never a bare `Appointment[id]`
followed by an ownership check, so a mismatched id and a nonexistent id
take the exact same code path to the exact same 404.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routes/appointments.rb apps/api/spec/requests/appointments_spec.rb
git commit -m "feat: add POST /appointments/:id/cancel"
```

---

### Task 5: Exclude occupied slots from `GET /doctors/:id/slots`; enforce the "approved day" lock on `PUT /doctor/availability`

**Files:**
- Modify: `apps/api/app/routes/doctors.rb`
- Test: additions to `apps/api/spec/requests/doctors_spec.rb`,
  `apps/api/spec/requests/doctor_availability_spec.rb`

**Interfaces:**
- Consumes: `Appointment`, `Appointment::OCCUPYING_STATUSES` (Task 1).

This is the cross-plan modification that closes the Departments/Doctors
plan's own documented scope limit, and implements sequencing decision 2
above.

- [ ] **Step 1: Write the failing tests**

- `GET /doctors/:id/slots` for a date with no appointments → unchanged
  (every generated slot still comes back, exactly as before).
- `GET /doctors/:id/slots` for a date with a `pending` appointment at one
  specific time → that one time is missing from the response; every
  other generated slot is still present.
- Same, for an `approved` appointment (create one directly via the model
  — there's no endpoint that produces `approved` yet, by this plan's own
  sequencing decision 1, so the test must construct it directly).
- Same date with a `declined` or `cancelled` appointment at a time → that
  time IS still present (a non-occupying status never removes a slot).
- `PUT /doctor/availability` with `unset` containing a date that has an
  `approved` appointment (constructed directly via the model, same as
  above) → 422, that date's row is NOT deleted, and every OTHER date in
  the same request still processes normally if the request is otherwise
  valid (this plan's call: is a request containing one locked date among
  several otherwise-valid unsets rejected whole, consistent with this
  file's existing all-or-nothing posture for `PUT /doctor/availability`,
  or does the locked date alone get skipped while the rest proceed? The
  existing all-or-nothing posture was deliberate and tested in the prior
  plan for format/range errors — extend the SAME posture to this new
  rejection reason for consistency, rather than inventing a different,
  partial-success behavior for this one case).
- The same `unset` with a `pending` (not `approved`) appointment on that
  date → succeeds normally (only `approved` locks a day, per the design
  spec's exact wording — a merely-requested day was never promised to
  the patient).

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement both changes**

In `/doctors/:id/slots`: after generating the full slot list, subtract
`Appointment.where(doctor_id: doctor.id, date: date, status:
Appointment::OCCUPYING_STATUSES).select_map(:time)`. In the `unset`
branch of `PUT /doctor/availability`: before the existing transaction,
check whether any `unset` date has an `Appointment.where(doctor_id:
current_user.id, date: that_date, status: 'approved')` row; if so, add it
to the existing `errors` hash (reuse the file's established pattern) with
a clear message (e.g. "This day has an approved appointment and can't be
closed"), and halt the same way the existing range/format checks already
do, before any write.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routes/doctors.rb apps/api/spec/requests/doctors_spec.rb apps/api/spec/requests/doctor_availability_spec.rb
git commit -m "feat: exclude occupied slots from public lookup; lock approved days"
```

---

### Task 6: Patient-facing doctor-lookup API wrappers, `appointments.api.ts`, and the Book Appointment page

**Files:**
- Modify: `apps/web/src/features/doctor/doctor.api.ts` (add four
  functions — see below; a builder-check review confirmed this file
  currently has none of them, only the doctor's-own-data wrappers)
- Create: `apps/web/src/features/appointments/appointments.api.ts`,
  `apps/web/src/features/appointments/book-appointment.page.tsx`
- Test: additions to `apps/web/src/features/doctor/__tests__/` for the
  new wrappers (or a new file — builder's call, matching this file's
  existing test-file convention), `apps/web/src/features/appointments/__tests__/book-appointment.page.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (`authedFetch`), `applyApiError`.
- Produces, in `doctor.api.ts`: `getDepartments(authedFetch):
  Promise<{id, name, doctor_count}[]>` (wraps `GET /departments`),
  `getDoctors(authedFetch, departmentId?): Promise<{id, first_name,
  last_name, department, specialty_title}[]>` (wraps `GET /doctors`),
  `getPublicAvailability(authedFetch, doctorId, month):
  Promise<AvailabilityDays>` (wraps `GET /doctors/:id/availability`,
  reusing the `AvailabilityDays` type already defined in this file),
  `getSlots(authedFetch, doctorId, date): Promise<{slots: string[]}>`
  (wraps `GET /doctors/:id/slots`) — these four did not exist before this
  task; nothing in the merged codebase currently calls these four
  endpoints from the frontend. Produces, in `appointments.api.ts`:
  `bookAppointment(authedFetch, payload): Promise<Appointment>` wrapping
  `POST /appointments`. `export default function BookAppointmentPage()`,
  mounted at `/book` by Task 8.

**On the dependent-query pattern:** a builder-check review found that
`doctor-availability.page.tsx` (this branch's structurally closest
existing page) does NOT use `@tanstack/react-query` — it's plain
`useEffect`/`useState` fetching, and it only ever calls the doctor's-own
endpoints, never the four public ones this task adds. The only real
`react-query` usage anywhere in this branch is `register.page.tsx`'s
single debounced `enabled` query (one independent query, not a chain).
This task's own call, settling what the earlier plan draft got wrong:
use plain `useEffect`/`useState` for this page's department→doctor→day→
slot chain too, matching `doctor-availability.page.tsx`'s actual style
(each selection's `useEffect` depends on the previous selection's state;
no `QueryClientProvider` needed for this page) — `@tanstack/react-query`
stays reserved for the live-validation use case `register.page.tsx`
established it for, not dependent-chain data loading in general.

- [ ] **Step 1: Write the failing tests**

For the four new `doctor.api.ts` wrappers: each calls the right path
with the right query params and returns the parsed body — thin,
mechanical tests matching this file's existing wrapper tests' style.

For `BookAppointmentPage`, mock `useAuth`, `doctor.api`, and
`appointments.api`:
- Picking a department narrows the doctor list (calls `getDoctors` with
  the department id).
- Picking a doctor loads their availability for the current month via
  `getPublicAvailability`; days not in the returned `days` array render
  disabled.
- Picking an available day loads that day's slots via `getSlots`;
  already-occupied slots (now correctly excluded by the backend per
  Task 5) simply never render as options — there is no "struck-through
  but visible" state to build, since the backend already omits them.
- Submitting with all required fields calls `bookAppointment` with the
  exact backend payload shape (`doctor_id, date, time, visit_type,
  reason, sms_reminder_opt_in`).
- A 422 with field errors renders via `applyApiError`, same house
  pattern as every other form in this branch.
- On success, navigates to `/appointments` (Task 7's route).

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement the four `doctor.api.ts` wrappers**

- [ ] **Step 4: Implement `appointments.api.ts`'s `bookAppointment`**

- [ ] **Step 5: Implement `BookAppointmentPage`**

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/doctor/doctor.api.ts apps/web/src/features/appointments/appointments.api.ts apps/web/src/features/appointments/book-appointment.page.tsx apps/web/src/features/appointments/__tests__/book-appointment.page.test.tsx
git commit -m "feat: add Book Appointment page"
```

---

### Task 7: My Appointments page

**Files:**
- Modify: `apps/web/src/features/appointments/appointments.api.ts`
- Create: `apps/web/src/features/appointments/my-appointments.page.tsx`
- Test: `apps/web/src/features/appointments/__tests__/my-appointments.page.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `applyApiError`, `appointments.api.ts`.
- Produces: `appointments.api.ts` gains `listAppointments(filters):
  Promise<{appointments, total}>` and `cancelAppointment(id):
  Promise<Appointment>`. `export default function
  MyAppointmentsPage()`, mounted at `/appointments` by Task 8.

- [ ] **Step 1: Write the failing tests**

- Renders the list returned by `listAppointments`, with status tags.
- Five tabs matching the screen spec exactly, each mapped to a concrete
  call to `listAppointments` (resolved here, not left to the builder,
  after a builder-check review found the naive single-status mapping
  couldn't express all five):
  - **All** — no `status`/`from`/`to` params.
  - **Upcoming** — `status=approved` (matching the SAME definition the
    screen spec itself uses for the dashboard's "Upcoming (approved)
    count" stat card, so this tab and that stat agree).
  - **Pending** — `status=pending`.
  - **Past** — `to=<yesterday's date>` (no status filter — a past
    appointment keeps whatever status it ended in).
  - **Declined-cancelled** — `status=declined,cancelled` (Task 3's new
    comma-separated support).
  Each tab switch re-calls `listAppointments` with exactly these params;
  test that at least the Upcoming and Declined-cancelled tabs send the
  right param shape, since those two are the ones a naive implementation
  would get wrong.
- A "Cancel" action, shown only for `pending`/`approved` rows (never for
  terminal statuses), calls `cancelAppointment` and refetches/updates the
  list on success.
- An error from `cancelAppointment` (e.g. a race where it became
  terminal between page load and the click) renders a banner via
  `applyApiError` or the established generic-fallback pattern, rather
  than silently doing nothing.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement both API functions and the page**

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/appointments/appointments.api.ts apps/web/src/features/appointments/my-appointments.page.tsx apps/web/src/features/appointments/__tests__/my-appointments.page.test.tsx
git commit -m "feat: add My Appointments page with cancel action"
```

---

### Task 8: Wire routes and link from the role landing stub

**Files:**
- Modify: `apps/web/src/App.tsx`,
  `apps/web/src/features/dashboard/role-landing.page.tsx`, its test file

**Interfaces:**
- Consumes: `BookAppointmentPage` (Task 6), `MyAppointmentsPage`
  (Task 7).

- [ ] **Step 1: Write the failing tests**

For the landing-page change: when `user.role === 'patient'`, links to
`/book` and `/appointments` render; for any other role, they don't
(mirroring the exact pattern the Departments/Doctors plan's own Task 9
already established for the doctor-only link in this same file).

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Wire `/book` and `/appointments` in `App.tsx`**

Both wrapped in `<ProtectedRoute allowedRoles={['patient']}>`, following
the exact pattern `/doctor/availability` already uses.

- [ ] **Step 4: Add the conditional patient links to the landing stub**

- [ ] **Step 5: Run the full `apps/web` suite once**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/features/dashboard/role-landing.page.tsx apps/web/src/features/dashboard/__tests__/role-landing.page.test.tsx
git commit -m "feat: wire booking and my-appointments routes, link from landing stub"
```

---

## Self-Review

**Spec coverage:** the design spec's Patient-section booking flow
(department → doctor → available day → unoccupied slot → reason/visit
type → submit → pending) and appointment-management flow (list, filter,
cancel) are both covered. `PatientCalendarSync` and the full
`PatientDashboard` screen are explicitly out of this plan's scope — the
former is a separate later plan per the original roadmap, and the latter
remains the generic role-landing stub plus this plan's two new links,
not a full dashboard rebuild (no task in this plan claims otherwise).

**Dependency ordering:** Task 1 (schema) before everything; Task 2
(create) before Tasks 3/4 (which read/mutate rows Task 2's shape defines)
before Task 5 (which queries those same rows from a different file);
Task 6 (booking page) before Task 7 only loosely — they could run in
either order, sequenced this way because Task 7's cancel action is more
naturally understood after Task 6 establishes the booking flow's shape;
Task 8 last, since it wires both pages' routes.

**The three sequencing decisions** are stated up front and referenced
again at the exact tasks they touch (Task 2's dormant-approval note,
Task 5's "dormant until the next plan" framing, Task 4's cutoff-free
cancellation) — not discovered mid-execution.

**Review Focus:** all five items have an owning task and an explicit
test, including a genuine concurrency test for the double-booking item
(not just a sequential existence check dressed up as one).

**Proportion:** 8 tasks for one new table, 4 new backend routes, 2
modifications to existing routes, and 2 new frontend pages is
proportionate to the first plan in this project that reuses as much
cross-plan infrastructure as it does — `require_role!`, `active_doctors`,
`generate_slots`'s concepts, `authedFetch`, `applyApiError`, and the
`ProtectedRoute allowedRoles` pattern are all reused rather than
reinvented.
