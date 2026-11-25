# Departments, Doctors & Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a doctor manage their own available days and session settings, and
give patients (and later, Records/Admin) a way to look up departments,
doctors, and a given doctor's available days/slots — the read-side data
every future booking screen needs. This is the first plan after the two
foundations that combines backend (`apps/api`) and frontend (`apps/web`)
as one vertical slice, per the original multi-plan roadmap.

**Architecture:** Three new tables (`departments`, `doctor_profiles`,
`doctor_availability_days`, `doctor_session_settings`) and a new
`DoctorRoutes` class mounted the same way `AuthRoutes`/`HealthRoutes`
already are. Role-gating gets a shared primitive on both sides — a backend
`require_role!(*roles)` helper (`AuthHelpers`) and a frontend
`ProtectedRoute` `allowedRoles` prop — since this is the first plan that
needs role-restricted endpoints/pages and five more plans will need the
same thing. On the frontend: one new page, `DoctorAvailability`, reusing
this branch's established conventions (`apiRequest`/`authedFetch`,
`applyApiError`, React Hook Form).

**Tech Stack:** Same as the merged foundations — Sinatra, Sequel, MySQL,
RSpec on the backend; React, Vite, TypeScript, React Router, React Hook
Form, Vitest on the frontend.

**Spec:** `docs/superpowers/specs/2026-11-23-clinic-appointment-rewrite-design.md`
(data model, API surface — Doctor section) and
`docs/superpowers/specs/2026-11-23-clinic-appointment-screen-specs.md`
(section "3 · Doctor", `DoctorAvailability`/`MDoctorAvailability`).

**Builds on:** the merged backend
(`docs/superpowers/plans/2026-11-23-backend-foundation-and-auth.md`) and
merged frontend
(`docs/superpowers/plans/2026-11-25-frontend-foundation-and-auth-ui.md`).

## Two sequencing decisions, made now rather than left implicit

**1. No way to create a Doctor account exists yet.** Self-registration
(merged) only creates `patient` accounts; Admin's staff-creation screen
is a *later* plan (`Admin: Users & Settings`, after this one in the
roadmap) — so there is currently no UI path to a Doctor account at all.
This plan's call: add a `rake db:seed` task that creates a few
departments and a handful of doctor users (with profiles and session
settings) directly via the models, standing in for the Admin UI until
that plan exists. This was already flagged as unscheduled, deferred work
in the backend plan's "What's left to the builder" section — this is
where it lands. Seeded accounts are ordinary rows; nothing about them is
special, and the Admin plan's real account-creation flow will coexist
with them later, not replace them.

**2. The "a doctor can't close a day that already has an approved
appointment" rule (from the screen spec) cannot be built yet, because
there is no `appointments` table — that's the *next* plan** (`Patient
Booking & My Appointments`). Building that check now against
nonexistent data would be speculative. This plan's call: ship
availability-day toggling with no such protection (every day is freely
togglable, since nothing can be "locked" when no appointment can exist
yet); the next plan, when it adds `appointments`, is responsible for
adding that check to this plan's `PUT /doctor/availability` endpoint.
Noted here so it isn't lost, and flagged again at the point it matters
below.

## Global Constraints

- Role-gating is enforced server-side (`require_role!`), not just hidden
  client-side — the frontend's `allowedRoles` check is a UX convenience,
  matching this branch's existing posture that the backend is the real
  boundary (see the frontend plan's own documented limitation about
  `must_change_password` being client-side-only — role-gating must not
  repeat that gap).
- `GET /doctors/:id/slots?date=` returns every slot the doctor's session
  settings generate as available — it does **not** yet filter out
  already-booked slots, since no booking exists. The next plan modifies
  this endpoint once `appointments` exists. Do not build speculative
  filtering against a table that doesn't exist.
- Session settings (`start_time`, `end_time`, `slot_length_minutes`,
  `max_patients_per_day`, `break_start`, `break_end`) are per-doctor, not
  per-day (per the design spec).
- `doctor_availability_days` stores one row per date a doctor has
  explicitly set; the "quick set: repeat weekly" UI action is a
  write-time convenience that bulk-writes those rows for the visible
  booking window — it is not itself a stored recurring rule (already
  decided in the backend spec).

## Review Focus

- **A patient (or any non-doctor role) calling a doctor-only endpoint
  directly** — `PUT /doctor/availability`/`PUT /doctor/session-settings`
  must 403 for a patient's valid access token, not just hide the button
  client-side. Covered in Task 1 and exercised by Tasks 4/5's tests.
- **A doctor setting another doctor's availability** — the doctor-only
  endpoints must scope to `current_user`, never accept a doctor id in
  the request body/params that lets one doctor edit another's schedule.
  Covered in Tasks 4/5.
- **An invalid session-length/time-range combination** — e.g.
  `end_time` before `start_time`, or a `slot_length_minutes` that
  doesn't evenly divide the session window — must 422, not silently
  produce a nonsensical or empty slot list. Covered in Task 4.
- **The public availability/slots lookup (`/doctors/:id/...`) for a
  doctor with no session settings or no availability days set yet**
  (a freshly seeded doctor who hasn't configured anything) must return
  an empty/sensible result, not a 500. Covered in Task 6.
- **Bulk-setting availability for a date range doesn't silently include
  dates outside the clinic's reasonable booking window** (e.g. years in
  the past/future from a client bug) — the endpoint should reject or
  ignore dates outside a sane bound rather than writing unbounded rows.
  Covered in Task 5.

---

## File Structure

```
apps/api/
  app/
    models/
      department.rb
      doctor_profile.rb
      doctor_session_settings.rb
      doctor_availability_day.rb
    routes/
      doctors.rb
    support/
      auth_helpers.rb          (modified: + require_role!)
  db/
    migrate/
      005_create_departments.rb
      006_create_doctor_profiles.rb
      007_create_doctor_session_settings.rb
      008_create_doctor_availability_days.rb
  db/
    seeds.rb
  spec/
    models/
      department_spec.rb
      doctor_profile_spec.rb
    requests/
      doctors_spec.rb (or split per endpoint — builder's call)

apps/web/
  src/
    lib/
      protected-route.tsx      (modified: + allowedRoles)
    features/
      doctor/
        doctor-availability.page.tsx
        doctor.api.ts
        __tests__/
          doctor-availability.page.test.tsx
    features/dashboard/
      role-landing.page.tsx    (modified: + doctor link)
```

---

### Task 1: `AuthHelpers#require_role!`

**Files:**
- Modify: `apps/api/app/support/auth_helpers.rb`
- Test: `apps/api/spec/requests/auth/authenticated_access_spec.rb` (or a
  new small spec file — this helper has no route of its own to test
  against yet, so add a tiny throwaway test route in the spec itself, or
  wait and let Task 4's real doctor-only route be this helper's first
  integration test; builder's call on mechanics, but write a test either
  way before Task 4 needs it)

**Interfaces:**
- Consumes: `AuthHelpers#authenticate!`/`#current_user` (merged).
- Produces: `require_role!(*roles)` — call after `authenticate!` in a
  route's `before` block; halts 403 `{error: "Forbidden"}` unless
  `current_user.role` is one of `roles`. Tasks 4 and 5 consume this by
  name.

- [ ] **Step 1: Write the failing test**

Add `require_role!('doctor')` to a minimal test fixture (either a
throwaway route mounted only in the spec, or defer this step and fold it
into Task 4's first test — if you defer, note that explicitly in this
task's commit and make Task 4's dispatch aware it's covering this too).

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `require_role!(*roles)` in `AuthHelpers`**

`halt 403, json(error: 'Forbidden') unless roles.include?(current_user.role)`
— call `current_user` (already memoized by `authenticate!`), not a second
token decode.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/support/auth_helpers.rb
git commit -m "feat: add require_role! for role-gated routes"
```

---

### Task 2: `departments` table, `Department` model, `GET /departments`

**Files:**
- Create: `apps/api/db/migrate/005_create_departments.rb`,
  `apps/api/app/models/department.rb`, `apps/api/app/routes/doctors.rb`
- Modify: `apps/api/app/api.rb` (mount `DoctorRoutes`)
- Test: `apps/api/spec/models/department_spec.rb`,
  `apps/api/spec/requests/doctors_spec.rb`

**Interfaces:**
- Produces: `Department` (`Sequel::Model(:departments)`), `DoctorRoutes`
  (mounted at `/api/v1`, this task starts the file — Tasks 3, 4, 5, 6 add
  more routes to it). `GET /departments` → 200
  `[{id, name, doctor_count}]`. Requires authentication (any role), no
  role restriction.

- [ ] **Step 1: Write the migration**

```ruby
Sequel.migration do
  change do
    create_table(:departments) do
      primary_key :id
      String :name, null: false
      DateTime :created_at, null: false
      DateTime :updated_at, null: false
    end
  end
end
```

- [ ] **Step 2: Run migrations on both databases**

- [ ] **Step 3: Write the failing tests**

Model: create a department, confirm it persists with timestamps.
Request: `authenticate!`-gated `GET /departments` returns an empty array
with no departments, and `[{id, name, doctor_count: 0}]` shape after
creating one — `doctor_count` computed via a join/count against
`doctor_profiles` (0 is fine before Task 3 exists; this field's shape is
decided now so Task 3 doesn't have to revisit this route).

- [ ] **Step 4: Run tests to verify they fail**

- [ ] **Step 5: Implement `Department` (plain `plugin :timestamps`,
  same shape as the merged `User`/`RefreshToken` tables) and the route**

`DoctorRoutes < ApiRoutes` (reuse the shared error envelope/`not_found`/
`error 500` handlers from `ApiRoutes`, same as `AuthRoutes` does).
`before { authenticate! }` for the whole file (every route in it needs
at least a valid session — role restrictions come per-route in later
tasks). `get('/departments') { json(Department.all.map { |d|
{id: d.id, name: d.name, doctor_count: d.doctor_profiles_dataset.count}
}) }` — this assumes Task 3's `doctor_profiles_dataset` association;
since Task 3 hasn't run yet, stub this as `doctor_count: 0` for now and
note in your commit that Task 3 will wire the real count once
`doctor_profiles` exists (a one-line change there, not a redesign).

- [ ] **Step 6: Mount `DoctorRoutes` in `app/api.rb`**

Add to `MOUNTED_ROUTES`, following the exact pattern already there for
`HealthRoutes`/`AuthRoutes`.

- [ ] **Step 7: Run tests to verify they pass**

- [ ] **Step 8: Commit**

```bash
git add apps/api/db/migrate/005_create_departments.rb apps/api/app/models/department.rb apps/api/app/routes/doctors.rb apps/api/app/api.rb apps/api/spec/models/department_spec.rb apps/api/spec/requests/doctors_spec.rb
git commit -m "feat: add departments table and GET /departments"
```

---

### Task 3: `doctor_profiles` table, `DoctorProfile` model, `GET /doctors`

**Files:**
- Create: `apps/api/db/migrate/006_create_doctor_profiles.rb`,
  `apps/api/app/models/doctor_profile.rb`
- Modify: `apps/api/app/routes/doctors.rb` (add `GET /doctors`, wire the
  real `doctor_count` from Task 2's stub)
- Test: additions to `apps/api/spec/models/doctor_profile_spec.rb`,
  `apps/api/spec/requests/doctors_spec.rb`

**Interfaces:**
- Consumes: `Department` (Task 2), `User` (merged).
- Produces: `DoctorProfile` (`many_to_one :user`, `many_to_one
  :department`), `User#doctor_profile` (`one_to_one`, so later tasks can
  go `user.doctor_profile.department`). `GET /doctors?department_id=`
  (optional filter) → 200 `[{id, first_name, last_name, department:
  {id, name}, specialty_title}]` — only rows where `user.role ==
  'doctor'`.

- [ ] **Step 1: Write the migration**

```ruby
Sequel.migration do
  change do
    create_table(:doctor_profiles) do
      primary_key :id
      foreign_key :user_id, :users, null: false, unique: true
      foreign_key :department_id, :departments, null: false
      String :specialty_title
      String :medical_licence_no
      String :consulting_room
      DateTime :created_at, null: false
      DateTime :updated_at, null: false
    end
  end
end
```

- [ ] **Step 2: Run migrations on both databases**

- [ ] **Step 3: Write the failing tests**

Model: association round-trip (`doctor_profile.department.name`,
`user.doctor_profile.specialty_title`). Request: seed a department + a
doctor user + profile directly via models in the test (no Admin
endpoint exists to do this through yet — that's expected, matches the
same pattern Task 2's tests already use for departments), hit
`GET /doctors`, assert the shape; filter by `department_id` excludes
doctors in other departments; a `patient`-role user with no profile
never appears even if queried directly.

- [ ] **Step 4: Run tests to verify they fail**

- [ ] **Step 5: Implement `DoctorProfile`, the `User` association, and
  the route; fix Task 2's `doctor_count` stub**

`doctor_count: Department#doctor_profiles_dataset.count` now reflects
real rows. `GET /doctors` joins `doctor_profiles` → `users` filtered to
`role: 'doctor'`, optionally `.where(department_id: params['department_id'])`
when present.

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Commit**

```bash
git add apps/api/db/migrate/006_create_doctor_profiles.rb apps/api/app/models/doctor_profile.rb apps/api/app/routes/doctors.rb apps/api/spec
git commit -m "feat: add doctor_profiles table and GET /doctors"
```

---

### Task 4: `doctor_session_settings`, `GET/PUT /doctor/session-settings`

**Files:**
- Create: `apps/api/db/migrate/007_create_doctor_session_settings.rb`,
  `apps/api/app/models/doctor_session_settings.rb`
- Modify: `apps/api/app/routes/doctors.rb`
- Test: `apps/api/spec/requests/doctor_session_settings_spec.rb`

**Interfaces:**
- Consumes: `require_role!` (Task 1).
- Produces: `DoctorSessionSettings` (`many_to_one :user`). `GET
  /doctor/session-settings` (doctor-only, scoped to `current_user`) →
  200 with the current settings or sensible defaults if none exist yet
  (`{start_time: "09:00", end_time: "17:00", slot_length_minutes: 20,
  max_patients_per_day: null, break_start: null, break_end: null}` —
  defaults are this task's call, matching the screen spec's shown
  default slot length of 20 minutes). `PUT /doctor/session-settings`
  (doctor-only) validates and upserts.

- [ ] **Step 1: Write the migration**

```ruby
Sequel.migration do
  change do
    create_table(:doctor_session_settings) do
      primary_key :id
      foreign_key :user_id, :users, null: false, unique: true
      String :start_time, null: false, default: '09:00'
      String :end_time, null: false, default: '17:00'
      Integer :slot_length_minutes, null: false, default: 20
      Integer :max_patients_per_day
      String :break_start
      String :break_end
      DateTime :created_at, null: false
      DateTime :updated_at, null: false
    end
  end
end
```

Times stored as `"HH:MM"` strings (24h) — simplest representation for a
same-timezone single-clinic deployment (per the backend spec's "single
clinic deployment" constraint); no timezone math needed.

- [ ] **Step 2: Run migrations on both databases**

- [ ] **Step 3: Write the failing tests**

- A `doctor` role GET with no row yet → the defaults above, 200.
- A `doctor` role PUT with a valid body → 200, persisted, a second GET
  reflects it (upsert, not insert-only).
- PUT with `end_time` before `start_time` → 422.
- PUT with a `slot_length_minutes` that doesn't evenly divide
  `end_time - start_time` (minus any break) → 422 (this is the Review
  Focus item — pick a clear error message, e.g. "Slot length must
  evenly divide the session window").
- A `patient` role GET/PUT → 403 (via `require_role!`).
- No doctor id in the request body ever changes whose settings are
  touched — the test should attempt to pass one and confirm it's
  ignored (always `current_user`).

- [ ] **Step 4: Run tests to verify they fail**

- [ ] **Step 5: Implement `DoctorSessionSettings` and the routes**

`before '/doctor/session-settings' do require_role!('doctor') end`
(role-gating only this one path, same pattern the merged auth plan used
for `/auth/password/change`). Validate the time-range/divisibility rule
server-side before upserting (`DoctorSessionSettings.find_or_create(user:
current_user) { |s| ... }.update(...)`, or `update_or_create` — your
call on the exact Sequel idiom).

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Commit**

```bash
git add apps/api/db/migrate/007_create_doctor_session_settings.rb apps/api/app/models/doctor_session_settings.rb apps/api/app/routes/doctors.rb apps/api/spec/requests/doctor_session_settings_spec.rb
git commit -m "feat: add doctor session settings with validated time range"
```

---

### Task 5: `doctor_availability_days`, `GET/PUT /doctor/availability`

**Files:**
- Create: `apps/api/db/migrate/008_create_doctor_availability_days.rb`,
  `apps/api/app/models/doctor_availability_day.rb`
- Modify: `apps/api/app/routes/doctors.rb`
- Test: `apps/api/spec/requests/doctor_availability_spec.rb`

**Interfaces:**
- Consumes: `require_role!` (Task 1).
- Produces: `DoctorAvailabilityDay` (`many_to_one :user`). `GET
  /doctor/availability?month=YYYY-MM` (doctor-only) → 200
  `{days: ["YYYY-MM-DD", ...]}` (only the available dates in that
  month). `PUT /doctor/availability` (doctor-only) body
  `{set: ["YYYY-MM-DD", ...], unset: ["YYYY-MM-DD", ...]}` → upserts/
  deletes rows accordingly, 200 with the resulting `{days: [...]}` for
  whatever month(s) were touched (or just echo back `set`/`unset` — your
  call on the exact response shape, pick one and test it).

- [ ] **Step 1: Write the migration**

```ruby
Sequel.migration do
  change do
    create_table(:doctor_availability_days) do
      primary_key :id
      foreign_key :user_id, :users, null: false
      Date :date, null: false
      TrueClass :is_available, null: false, default: true
      DateTime :created_at, null: false
      DateTime :updated_at, null: false
      index %i[user_id date], unique: true
    end
  end
end
```

A unique index on `(user_id, date)` is the natural key — this table only
ever holds "available" rows in practice (per the design spec's "one row
per date a doctor has explicitly set"); this plan's call: only insert a
row when a day is set *available*, and `unset` means deleting the row
(an absent row = not available), rather than storing explicit
`is_available: false` rows. Simpler reads, no ambiguity between "unset"
and "explicitly closed." (The `is_available` column still exists for
forward-compatibility with a future "explicitly closed holiday" concept,
but this plan writes only `true` rows.)

- [ ] **Step 2: Run migrations on both databases**

- [ ] **Step 3: Write the failing tests**

- `PUT` with `{set: [...]}` creates rows; a later `GET ?month=` for that
  month returns exactly those dates.
- `PUT` with `{unset: [...]}` on previously-set dates removes them.
- `PUT` with a date far outside a reasonable booking window (e.g. 3
  years in the future) → 422, per this task's Review Focus item — pick
  a bound (e.g. reuses `MAX_BOOKING_WINDOW_DAYS`-shaped thinking even
  though that clinic-setting doesn't exist as configurable yet; hardcode
  a generous sane bound like 180 days from today for now, and leave a
  comment that it should become the admin-configurable
  `max_booking_window_days` once Settings exists).
- A `patient` role → 403.
- No way to pass another doctor's id — always `current_user`.

- [ ] **Step 4: Run tests to verify they fail**

- [ ] **Step 5: Implement `DoctorAvailabilityDay` and the routes**

`before '/doctor/availability' do require_role!('doctor') end`. `PUT`
validates every date in `set`/`unset` is within the sane bound before
writing any of them (all-or-nothing — reject the whole request on one
bad date rather than partially applying).

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Commit**

```bash
git add apps/api/db/migrate/008_create_doctor_availability_days.rb apps/api/app/models/doctor_availability_day.rb apps/api/app/routes/doctors.rb apps/api/spec/requests/doctor_availability_spec.rb
git commit -m "feat: add doctor availability days with bounded set/unset"
```

---

### Task 6: Public `GET /doctors/:id/availability` and `GET /doctors/:id/slots`

**Files:**
- Modify: `apps/api/app/routes/doctors.rb`
- Test: additions to `apps/api/spec/requests/doctors_spec.rb`

**Interfaces:**
- Consumes: `DoctorAvailabilityDay`, `DoctorSessionSettings` (Tasks 4, 5).
- Produces: `GET /doctors/:id/availability?month=YYYY-MM` (any
  authenticated role) → 200 `{days: ["YYYY-MM-DD", ...]}` for that
  doctor — same shape as the doctor's own endpoint, but keyed by `:id`
  in the path and with no role restriction (a patient needs this to
  render a booking calendar in the next plan). `GET
  /doctors/:id/slots?date=YYYY-MM-DD` → 200 `{slots: ["09:00", "09:20",
  ...]}` generated from that doctor's session settings for the given
  date — every slot the settings produce, per this plan's documented
  scope limit (no booked-slot filtering yet).

- [ ] **Step 1: Write the failing tests**

- A doctor with availability set → the public endpoint returns the same
  dates the doctor's own `GET /doctor/availability` would.
- A doctor with no `DoctorSessionSettings` row yet → `/slots` returns
  the slots implied by this task's defaults (same defaults as Task 4's
  GET, applied here too) rather than a 500 — this is the task's Review
  Focus item.
- A doctor with session settings → `/slots` returns the right count/
  spacing (e.g. 09:00–17:00, 20-minute slots, no break → 24 slots;
  verify the exact math with one concrete worked example in the test).
- An unknown doctor id → 404.
- A `patient` role caller succeeds (no role restriction on this path).

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement both routes**

Slot generation: starting at `start_time`, stepping by
`slot_length_minutes`, stopping before `end_time`, skipping any slot
that falls inside `[break_start, break_end)` when both are set. Pure
function, easy to unit-test directly if you prefer a model/service
method over inlining it in the route — your call, but keep the route
body thin either way.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routes/doctors.rb apps/api/spec/requests/doctors_spec.rb
git commit -m "feat: add public doctor availability and slot lookup"
```

---

### Task 7: `rake db:seed` — departments and demo doctors

**Files:**
- Create: `apps/api/db/seeds.rb`
- Modify: `apps/api/Rakefile` (add a `db:seed` task)

**Interfaces:**
- Produces: `rake db:seed` — idempotent (safe to run more than once;
  use `find_or_create` throughout), creates a handful of departments and
  2-3 doctor users (each with a `DoctorProfile`, a
  `DoctorSessionSettings` row, and a few `DoctorAvailabilityDay` rows in
  the current month) via the models directly, so local dev/demo has
  doctors to book against ahead of the Admin plan's real account-
  creation UI.

- [ ] **Step 1: Write `db/seeds.rb`**

A plain Ruby script (`require_relative '../config/environment'` at the
top so models/DB are loaded) that `find_or_create`s 2-3 departments
(e.g. "General Medicine", "Pediatrics", "Dermatology") and, per
department, one doctor `User` (role `'doctor'`, status `'active'`,
`must_change_password: false` — seeded accounts don't need the forced-
change flow since there's no real temp-password UX to demo here) with a
memorable username/password printed to stdout when created (so whoever
runs this can log in), a `DoctorProfile`, default `DoctorSessionSettings`,
and availability set for, say, every weekday in the current and next
month.

- [ ] **Step 2: Add the Rake task**

`task :seed do require_relative 'db/seeds' end` (or load `config/
environment` first if `seeds.rb` doesn't do it itself — match whatever
`db:migrate`'s task already does for consistency).

- [ ] **Step 3: Run it against the dev database and verify by hand**

Run: `cd apps/api && RACK_ENV=development bundle exec rake db:seed`
Expected: output listing the created departments/doctors with
credentials; running it a second time makes no duplicates (verify with
a row count check or a second run's output showing "already exists"-
style messaging — your call on exact wording).

- [ ] **Step 4: Commit**

```bash
git add apps/api/db/seeds.rb apps/api/Rakefile
git commit -m "feat: add db:seed task for demo departments and doctors"
```

(No RSpec test for this task — it's a dev-convenience script, not
request-tested application behavior. Verifying it runs cleanly against
the dev DB, as in Step 3, is this task's verification.)

---

### Task 8: `ProtectedRoute` `allowedRoles` + `DoctorAvailability` page

**Files:**
- Modify: `apps/web/src/lib/protected-route.tsx`,
  `apps/web/src/lib/protected-route.test.tsx`, `apps/web/src/App.tsx`
- Create: `apps/web/src/features/doctor/doctor.api.ts`,
  `apps/web/src/features/doctor/doctor-availability.page.tsx`
- Test: `apps/web/src/features/doctor/__tests__/doctor-availability.page.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (merged — `authedFetch`), `applyApiError` (merged).
- Produces: `ProtectedRoute` gains an optional `allowedRoles?: string[]`
  prop — when given and `user.role` isn't in the list, redirect to `/`
  (this plan's call: redirect home rather than show a dedicated "403"
  page, since there's nowhere richer to send someone yet; a future plan
  can add a real forbidden page without changing this component's
  contract). `doctor.api.ts` wraps `GET/PUT /doctor/availability` and
  `GET/PUT /doctor/session-settings` via `authedFetch`.

- [ ] **Step 1: Write the failing tests for `ProtectedRoute`'s new prop**

Two new cases alongside the existing ones: `allowedRoles={['doctor']}`
with a `patient` user → redirects to `/`; with a `doctor` user → renders
children. No `allowedRoles` prop at all → unchanged existing behavior
(every existing test must still pass).

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement the `allowedRoles` check in `ProtectedRoute`**

Add after the existing `must_change_password` check (a role-restricted
page still honors the forced-change redirect first — you can't reach a
role-gated page while owing a password change either).

- [ ] **Step 4: Write the failing tests for `DoctorAvailability`**

Mock `useAuth` and `doctor.api`'s calls. Render the page: a month
calendar (reuse plain `Date` math, no new date library — this repo has
none and the math needed is simple month/day arithmetic), clicking a day
toggles it into a local "pending changes" set, "Save availability"
calls the `PUT` endpoint with the accumulated `set`/`unset` arrays and,
on success, re-fetches (or optimistically updates) the displayed month.
A simple session-settings form (start/end time, slot length) with its
own save action calling the settings `PUT`. Test the save payload shape
matches the backend contract exactly (`{set: [...], unset: [...]}` /
whatever Task 5 settled on — read the actual merged backend route to
confirm, don't guess from this plan's prose alone).

- [ ] **Step 5: Run tests to verify they fail**

- [ ] **Step 6: Implement `doctor.api.ts` and `DoctorAvailability`**

- [ ] **Step 7: Wire the route in `App.tsx`**

`/doctor/availability` → `<ProtectedRoute allowedRoles={['doctor']}>
<DoctorAvailability /></ProtectedRoute>`.

- [ ] **Step 8: Run the full `apps/web` suite once**

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/protected-route.tsx apps/web/src/lib/protected-route.test.tsx apps/web/src/App.tsx apps/web/src/features/doctor
git commit -m "feat: add role-gated routes and the Doctor Availability page"
```

---

### Task 9: Link to Doctor Availability from the role landing stub

**Files:**
- Modify: `apps/web/src/features/dashboard/role-landing.page.tsx`,
  its test file

**Interfaces:**
- Consumes: `DoctorAvailability` route (Task 8).

- [ ] **Step 1: Write the failing test**

When `user.role === 'doctor'`, a link/button to `/doctor/availability`
renders on the role landing page; for any other role, it doesn't.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Add the conditional link**

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Run the full `apps/web` suite once more**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/dashboard/role-landing.page.tsx
git commit -m "feat: link doctors to their availability page from the landing stub"
```

---

## Self-Review

**Spec coverage:** the design spec's Doctor-section API surface items
for availability/session-settings/department/doctor lookup are all
covered; the `DoctorAvailability` screen (desktop) is built — its mobile
variant (`MDoctorAvailability`) is explicitly a later-plan responsive
concern per the frontend plan's "same route, Tailwind breakpoints"
decision, not a separate task here.

**Dependency ordering:** Task 1 (role-gating) before Tasks 4/5 (which
need it); Tasks 2→3 (departments before doctor profiles, since profiles
reference departments); Tasks 4/5 (session settings, availability days)
before Task 6 (public lookup, which reads both); Task 7 (seed) after all
the models it seeds exist; Task 8 (frontend) after the backend contract
it calls is final; Task 9 (landing link) after Task 8's route exists.

**The two sequencing decisions** (seed data standing in for Admin;
no locked-day check until `appointments` exists) are stated up front,
not discovered mid-execution — both are called out again at the exact
tasks they touch (Task 7's commit message, Task 5's migration comment).

**Review Focus:** all five items have an owning task and an explicit
test.

**Proportion:** 9 tasks across two schema-light backend tables (plus one
join table), one new frontend page, and the role-gating infrastructure
both sides needed anyway — proportionate to a "first vertical slice"
plan; later plans reuse `require_role!`/`allowedRoles` without
reinventing them.
