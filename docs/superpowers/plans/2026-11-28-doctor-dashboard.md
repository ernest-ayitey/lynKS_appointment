# Doctor Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full `DoctorDashboard.dc.html` wireframe — stat cards,
today's schedule with a working "Mark arrived" action, next-available-days
tags, and a recent-emails feed — as a new `DoctorDashboardPage`, backed by a
new `arrived` appointment status and two small new backend endpoints.

**Architecture:** A new optional `arrived` status slots between `approved`
and `completed`/`no_show` in `Appointment`'s existing state machine
(additive — the current `approved → completed/no_show` direct path keeps
working unchanged). Two new tiny GET endpoints
(`/doctor/dashboard/stats`, `/doctor/dashboard/emails`) feed the new page;
"full" day tagging reuses existing availability/slots endpoints entirely
client-side, no new backend needed for it. A new `AppointmentEmail` model
logs the doctor-addressed half of each approval email, via a small optional
parameter on the existing `Mailer.deliver`, not a new delivery mechanism.

**Tech Stack:** Same as every prior plan — Sinatra/Sequel/MySQL backend,
React/Vite/TypeScript frontend, RSpec + Rack::Test, Vitest + Testing
Library.

**Spec:** `docs/superpowers/specs/2026-11-28-doctor-dashboard-design.md`.
Wireframe: artifact `https://claude.ai/code/artifact/3dcb54ae-73db-42f1-a317-863b548286ad`,
file `project/DoctorDashboard.dc.html` — every task below says when to
read it directly; per this repo's established convention, read the live
file, never trust a paraphrase for exact copy/layout.

**Builds on:** the merged Doctor Appointments plan (the `GET
/doctor/appointments` / `PATCH /appointments/:id` routes and
`DoctorAppointmentsPage` this plan extends) and the App Shell & Wireframe
Parity plan (`AppShell`, whose `doctor-dashboard` `NavKey` is currently
inert and becomes real here).

## Global Constraints

- **`Appointment::STATUSES` gains `arrived`.** No DB migration needed for
  this — `009_create_appointments.rb`'s `status` column is a plain
  `String` with no DB-level CHECK constraint (confirmed by reading the
  live migration), so this is a model-layer change only.
- **`OCCUPYING_STATUSES` (slot-conflict purposes — `occupied_slot?`, `GET
  /doctors/:id/slots`) becomes `%w[pending approved arrived]`.** A new,
  separate `CANCELLABLE_STATUSES = %w[pending approved]` (the OLD value of
  `OCCUPYING_STATUSES`) takes over `POST /appointments/:id/cancel`'s
  eligibility check. `arrived` is occupying (the patient is in the
  building, the slot stays taken) but NOT cancellable (you can't cancel a
  visit you've already checked in for) — these are different questions
  that used to share one constant by coincidence, not by design.
- **`PATCH /appointments/:id`'s precondition becomes target-status-aware,
  not a single uniform check.** Transitioning *to* `arrived` requires
  current status `approved`. Transitioning *to* `completed`/`no_show`
  requires current status `approved` **OR** `arrived`. The existing
  `approved → completed/no_show` direct path (today's only path, fully
  tested) must keep working exactly as it does today — this plan adds a
  path, it does not replace one.
- **`GET /doctor/appointments`'s status filter gains `arrived`**:
  `%w[approved arrived completed no_show]`, not just the current
  `%w[approved completed no_show]` — otherwise an arrived appointment
  would vanish from the doctor's own list the moment it's marked arrived.
- **Only the doctor-addressed half of an approval email gets logged**,
  never the patient-addressed half, never a decline email, never the
  password-reset email. One `AppointmentEmail` row per approved
  appointment, matching the wireframe's own one-row-per-approval example.
- **Stat semantics, exact**: "Patients today"/"This week" =
  `COUNT(DISTINCT patient_id)` over the relevant date range (a patient
  with two appointments the same day counts once). "Available days this
  month" = a plain `COUNT` of `DoctorAvailabilityDay` rows for the current
  calendar month — no full-day exclusion (that exclusion is scoped only
  to the separate next-available-days widget).
- **`arrived` renders with this codebase's existing amber/pending badge
  convention** (`bg-amber-100 text-amber-800`, the same classes
  `RecordsQueuePage`/`MyAppointmentsPage` already use for `pending`)
  wherever an appointment status badge is shown — not a new color.
- **"Full" day tagging has no new backend endpoint.** The frontend already
  has `getAvailability` (the doctor's own availability days for a month)
  and `getSlots` (a specific day's free times) in
  `apps/web/src/features/doctor/doctor.api.ts` — reuse both directly;
  a day is "full" when `getSlots` returns an empty array.
- **Every existing test must keep passing, with one deliberate, named
  exception**: `app-shell.test.tsx`'s assertion that the doctor's
  "Dashboard" nav item is inert must flip to assert it's now a real link
  to `/doctor/dashboard` — the underlying feature genuinely changed
  (this plan is exactly what makes it real), so updating that one
  assertion is correct, not a loosened check.

## Review Focus

- Marking an already-`arrived` appointment `arrived` again, or marking
  `arrived` on anything other than an `approved` appointment (pending,
  declined, cancelled, completed, no_show) — must 422, same state-machine
  discipline the existing `completed`/`no_show` transitions already have.
- An `arrived` appointment's slot must still read as occupied — a second
  patient must not be able to book that exact (doctor, date, time) slot
  just because its appointment moved past `approved`.
- A patient attempting to cancel an `arrived` appointment — must 422, not
  succeed, now that `CANCELLABLE_STATUSES` excludes it.
- The dashboard's "Patients today"/"This week" counts — two appointments
  for the same patient on the same day must count as 1, not 2.
- A doctor with zero recent emails, zero appointments today, or zero
  available days this month — every dashboard section renders its own
  empty state, not an error or a crash.

---

### Task 1: Split `Appointment`'s status constants; add `arrived`

**Files:**
- Modify: `apps/api/app/models/appointment.rb`
- Modify: `apps/api/app/routes/appointments.rb` (the `POST
  /appointments/:id/cancel` route only, in this task — its PATCH route is
  Task 2)
- Test: `apps/api/spec/models/appointment_spec.rb`
- Test: `apps/api/spec/requests/appointments_spec.rb` (cancel-route tests
  only)
- Test: `apps/api/spec/requests/doctors_spec.rb` (the `GET
  /doctors/:id/slots` describe block — read the live file to find it)

**Interfaces:**
- Produces: `Appointment::STATUSES` now includes `'arrived'`.
  `Appointment::OCCUPYING_STATUSES = %w[pending approved arrived]`.
  `Appointment::CANCELLABLE_STATUSES = %w[pending approved]` (new
  constant). Consumed by Task 2 (PATCH precondition) and already consumed
  by `doctors.rb`'s `occupied_slot?`/`GET /doctors/:id/slots` (no change
  needed there — it already reads `OCCUPYING_STATUSES` by name, so it
  picks up `arrived` automatically once the constant's value changes).

- [ ] **Step 1: Write the failing tests.**
  ```ruby
  # appointment_spec.rb
  it 'accepts arrived as a valid status' do
    appointment = build_appointment(status: 'arrived')
    expect(appointment).to be_valid
  end

  # appointments_spec.rb, existing cancel describe block
  it "404/422s a cancel attempt on an arrived appointment the same way an already-completed one 422s" do
    # create an appointment with status: 'arrived', call
    # POST /appointments/:id/cancel, expect 422 ALREADY_FINAL_MESSAGE,
    # same shape as the existing "already completed" cancel-rejection test
    # in this same file.
  end

  # doctors_spec.rb, existing 'GET /doctors/:id/slots' describe block
  # (Review Focus: an arrived appointment must still occupy its slot —
  # this is the one new behavior Task 1 introduces that no pre-existing
  # test can prove, since no test today creates an 'arrived' appointment
  # at all)
  it "excludes a slot held by an arrived appointment from the free-slots list, same as an approved one" do
    # create an appointment with status: 'arrived' at a known (doctor,
    # date, time); call GET /doctors/:id/slots for that date; assert the
    # slot is NOT in the returned list — mirroring this file's existing
    # "excludes a slot held by an approved appointment" test exactly,
    # just with status: 'arrived' instead.
  end
  ```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement.** In `appointment.rb`:
  ```ruby
  STATUSES = %w[pending approved arrived declined cancelled completed no_show].freeze
  OCCUPYING_STATUSES = %w[pending approved arrived].freeze
  CANCELLABLE_STATUSES = %w[pending approved].freeze
  ```
  In `appointments.rb`'s `POST /appointments/:id/cancel` route, change its
  one reference from `Appointment::OCCUPYING_STATUSES` to
  `Appointment::CANCELLABLE_STATUSES` (same check, same message, just the
  correctly-scoped constant now that the two questions have split).

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Run the full API suite, confirm no regression** — pay
  particular attention to `GET /doctors/:id/slots`'s and `occupied_slot?`'s
  existing tests, since `OCCUPYING_STATUSES`'s value changed (gained
  `arrived`) even though neither file's code changed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/models/appointment.rb apps/api/app/routes/appointments.rb apps/api/spec/models/appointment_spec.rb apps/api/spec/requests/appointments_spec.rb apps/api/spec/requests/doctors_spec.rb
git commit -m "feat: add arrived status, split OCCUPYING_STATUSES/CANCELLABLE_STATUSES"
```

---

### Task 2: `PATCH /appointments/:id` accepts `arrived`; `GET /doctor/appointments` includes it

**Files:**
- Modify: `apps/api/app/routes/appointments.rb`
- Test: `apps/api/spec/requests/appointments_spec.rb`

**Interfaces:**
- Consumes: `Appointment::STATUSES`/`OCCUPYING_STATUSES` from Task 1.
- Produces: `PATCH /appointments/:id` now accepts `status: 'arrived'` (in
  addition to `'completed'`/`'no_show'`), each with its own precondition.
  `doctor_appointment_json` needs no shape change — `status` already
  serializes whatever the DB holds.

- [ ] **Step 1: Write the failing tests**, alongside the existing
  `PATCH /appointments/:id (doctor)` describe block:
  ```ruby
  it 'marks an approved appointment arrived' do
    # approved -> PATCH status: 'arrived' -> 200, status now 'arrived'
  end

  it 'marks an arrived appointment completed' do
    # approved -> arrived (via PATCH) -> PATCH status: 'completed' -> 200
  end

  it 'marks an arrived appointment no_show' do
    # same shape, status: 'no_show'
  end

  it 'rejects marking an already-arrived appointment arrived again' do
    # arrived -> PATCH status: 'arrived' -> 422
  end

  %w[pending declined cancelled completed no_show].each do |non_approved_status|
    it "rejects marking a #{non_approved_status} appointment arrived" do
      # same loop shape the existing completed/no_show precondition test already uses
    end
  end

  it "includes an arrived appointment in GET /doctor/appointments" do
    # create an appointment with status: 'arrived' for the doctor, confirm
    # it appears in the list (today's filter excludes it: %w[approved completed no_show])
  end
  ```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement.**
  `PATCHABLE_STATUSES = %w[arrived completed no_show].freeze` (add
  `arrived`). The precondition becomes target-status-aware instead of one
  uniform check:
  ```ruby
  required_current_status =
    new_status == 'arrived' ? %w[approved] : %w[approved arrived]
  unless required_current_status.include?(appointment.status)
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, status: '...'
  end
  ```
  (Exact message text and variable names are the implementer's call —
  match this file's existing error-message conventions.) Change `GET
  /doctor/appointments`'s dataset line from
  `status: %w[approved completed no_show]` to
  `status: %w[approved arrived completed no_show]`.

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Run the full API suite, confirm no regression** — the
  existing `approved → completed/no_show` direct-path tests (written
  before `arrived` existed) must still pass unchanged, proving this task
  added a path rather than replacing one.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routes/appointments.rb apps/api/spec/requests/appointments_spec.rb
git commit -m "feat: PATCH /appointments/:id accepts arrived, GET /doctor/appointments includes it"
```

---

### Task 3: `AppointmentEmail` log + `Mailer.deliver` attribution

**Files:**
- Create: `apps/api/db/migrate/011_create_appointment_emails.rb`
- Create: `apps/api/app/models/appointment_email.rb`
- Modify: `apps/api/app/services/mailer.rb`
- Modify: `apps/api/app/routes/records.rb` (the doctor-addressed
  `Mailer.deliver` call inside the approve flow only)
- Test: `apps/api/spec/services/mailer_spec.rb`
- Test: `apps/api/spec/requests/records_spec.rb` (or wherever the approve
  route's existing email-sending behavior is already tested — read the
  live spec file to find it)

**Interfaces:**
- Produces: `AppointmentEmail` (`id, appointment_id, recipient_email,
  subject, sent_at`), consumed by Task 4's `GET /doctor/dashboard/emails`.
- Produces: `Mailer.deliver(to:, subject:, body:, appointment: nil)` — the
  new `appointment:` keyword is optional; existing call sites that don't
  pass it (the password-reset email in `auth.rb`, the patient-addressed
  and decline emails in `records.rb`) are unchanged and log nothing.

- [ ] **Step 1: Write the migration**
  ```ruby
  Sequel.migration do
    change do
      create_table(:appointment_emails) do
        primary_key :id
        foreign_key :appointment_id, :appointments, null: false
        String :recipient_email, null: false
        String :subject, null: false
        DateTime :sent_at, null: false
        index :appointment_id
      end
    end
  end
  ```

- [ ] **Step 2: Run it** against dev and test DBs, confirm
  `bundle exec rspec` still passes in full.

- [ ] **Step 3: Write the failing tests.**
  ```ruby
  # mailer_spec.rb
  it 'logs an AppointmentEmail when appointment: is passed' do
    # Mailer.deliver(to: ..., subject: ..., body: ..., appointment: some_appointment)
    # expect(AppointmentEmail.count).to eq(1), recipient_email/subject match
  end

  it 'does not log anything when appointment: is omitted' do
    # existing call shape, e.g. the password-reset email — count stays 0
  end

  # records_spec.rb (approve flow)
  it "logs the doctor-addressed approval email but not the patient-addressed one" do
    # approve a request -> expect AppointmentEmail.count to eq(1),
    # recipient_email == the doctor's email, not the patient's
  end

  it "does not log anything on decline" do
    # decline a request -> expect AppointmentEmail.count to eq(0)
  end
  ```

- [ ] **Step 4: Run it, confirm it fails.**

- [ ] **Step 5: Implement.** `AppointmentEmail < Sequel::Model` with
  `many_to_one :appointment`. `Mailer.deliver` gains the optional
  `appointment:` keyword; when present, creates one `AppointmentEmail`
  row (`sent_at: Time.now`) alongside its existing delivery behavior. In
  `records.rb`'s approve flow, pass `appointment: appointment` only on the
  call whose `to:` is the doctor's email — read the live file first to
  find the exact two `Mailer.deliver` calls and confirm which is which
  before editing (don't guess from this plan's prose).

- [ ] **Step 6: Run it, confirm it passes.**

- [ ] **Step 7: Run the full API suite, confirm no regression.**

- [ ] **Step 8: Commit**

```bash
git add apps/api/db/migrate/011_create_appointment_emails.rb apps/api/app/models/appointment_email.rb apps/api/app/services/mailer.rb apps/api/app/routes/records.rb apps/api/spec/services/mailer_spec.rb apps/api/spec/requests/records_spec.rb
git commit -m "feat: log the doctor-addressed approval email per appointment"
```

---

### Task 4: `GET /doctor/dashboard/stats` and `GET /doctor/dashboard/emails`

**Files:**
- Modify: `apps/api/app/routes/appointments.rb`
- Test: `apps/api/spec/requests/appointments_spec.rb`

**Interfaces:**
- Consumes: `Appointment`, `AppointmentEmail`, `DoctorAvailabilityDay`
  (read the live model file for its exact table/column names before
  querying it).
- Produces:
  `GET /doctor/dashboard/stats` → `{ patients_today: int, this_week: int,
  pending: int, available_days_this_month: int }`.
  `GET /doctor/dashboard/emails` → `{ emails: [{ recipient_email,
  subject, sent_at, ref }] }` (last 5, newest first; `ref` is the same
  `format('REQ-%05d', appointment.id)` convention this file already
  duplicates elsewhere — reuse via the appointment's ref, not a new
  format). Consumed by Task 5's frontend wrapper.

- [ ] **Step 1: Write the failing tests**, mirroring this file's existing
  `before`/role-gating/test conventions for a new `/doctor/*` path:
  ```ruby
  describe 'GET /doctor/dashboard/stats' do
    it 'returns distinct-patient counts for today and this week, a pending count, and an availability-day count' do
    end
    it 'counts a patient with two appointments the same day once, not twice' do
    end
    it 'rejects a patient or records role with 403' do
    end
  end

  describe 'GET /doctor/dashboard/emails' do
    it "returns the doctor's own 5 most recent appointment-related emails, newest first" do
    end
    it 'returns an empty list when there are none' do
    end
    it 'rejects a patient or records role with 403' do
    end
  end
  ```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement**, with a `before('/doctor/dashboard') {
  authenticate!; require_role!('doctor') }` filter matching this file's
  existing per-literal-path filter convention. `patients_today`/
  `this_week` — `Appointment.where(doctor_id:, date: ...).distinct.count(:patient_id)`
  (today = `Date.today`; this week = Monday-Sunday containing today,
  reusing this file's or the frontend's existing week-boundary convention
  if one already exists server-side, otherwise a straightforward
  `Date.today` to `Date.today + 6` range — implementer's call, state the
  choice in the PR). `pending` — `Appointment.where(doctor_id:,
  status: 'pending').count`. `available_days_this_month` —
  `DoctorAvailabilityDay.where(user_id:, date: start_of_month..end_of_month).count`.
  Emails — `AppointmentEmail.join(:appointments, id: :appointment_id)
  .where(Sequel[:appointments][:doctor_id] => current_user.id)
  .order(Sequel.desc(:sent_at)).limit(5)` (exact Sequel join syntax is the
  implementer's call — read this file's existing join/eager patterns
  first).

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Run the full API suite, confirm no regression.**

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routes/appointments.rb apps/api/spec/requests/appointments_spec.rb
git commit -m "feat: GET /doctor/dashboard/stats and GET /doctor/dashboard/emails"
```

---

### Task 5: `doctor-dashboard.api.ts`; widen `markAppointmentOutcome`

**Files:**
- Create: `apps/web/src/features/doctor/doctor-dashboard.api.ts`
- Modify: `apps/web/src/features/doctor/doctor-appointments.api.ts`
- Test: `apps/web/src/features/doctor/__tests__/doctor-dashboard.api.test.ts`
- Test: `apps/web/src/features/doctor/__tests__/doctor-appointments.api.test.ts`

**Interfaces:**
- Consumes: `GET /doctor/dashboard/stats`/`GET /doctor/dashboard/emails`
  from Task 4 — read the live Ruby response shape to confirm exact field
  names rather than relying on this plan's prose.
- Consumes: `getAvailability`/`getSlots` (already exist in
  `apps/web/src/features/doctor/doctor.api.ts`) — do not duplicate them,
  import and reuse directly.
- Produces:
  ```ts
  export interface DashboardStats {
    patients_today: number;
    this_week: number;
    pending: number;
    available_days_this_month: number;
  }
  export interface RecentEmail { recipient_email: string; subject: string; sent_at: string; ref: string; }
  export function getDashboardStats(authedFetch: AuthedFetch): Promise<DashboardStats>;
  export function getRecentEmails(authedFetch: AuthedFetch): Promise<{ emails: RecentEmail[] }>;
  ```
  Consumed by Task 7's `DoctorDashboardPage`.
- Modifies: `markAppointmentOutcome`'s `payload.status` type widens from
  `'completed' | 'no_show'` to `'arrived' | 'completed' | 'no_show'` — same
  function, same endpoint, just a wider type now that the backend accepts
  a third value. Consumed by Task 6 and Task 7.

- [ ] **Step 1: Write the failing tests** for both new functions
  (mirroring `doctor-appointments.api.test.ts`'s existing style) and for
  `markAppointmentOutcome`'s widened type (a call with `status: 'arrived'`
  should type-check and call the same endpoint).

- [ ] **Step 2: Run it, confirm it fails, implement, confirm it passes.**

- [ ] **Step 3: Run the full web suite + `tsc -b --noEmit`, confirm no
  regression.**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/doctor/doctor-dashboard.api.ts apps/web/src/features/doctor/doctor-appointments.api.ts apps/web/src/features/doctor/__tests__/doctor-dashboard.api.test.ts apps/web/src/features/doctor/__tests__/doctor-appointments.api.test.ts
git commit -m "feat: doctor-dashboard.api.ts, widen markAppointmentOutcome to accept arrived"
```

---

### Task 6: `DoctorAppointmentsPage` gains "Mark arrived"

**Files:**
- Modify: `apps/web/src/features/doctor/doctor-appointments.page.tsx`
- Test: `apps/web/src/features/doctor/__tests__/doctor-appointments.page.test.tsx`

**Interfaces:**
- Consumes: `markAppointmentOutcome`'s widened type from Task 5.

- [ ] **Step 1: Write the failing tests**, alongside this page's existing
  action-button tests:
  ```ts
  it('shows a Mark arrived button for an approved appointment, which calls markAppointmentOutcome with status arrived and refetches', async () => {})
  it('shows Mark completed/No-show (not Mark arrived) for an arrived appointment', async () => {})
  it('renders an amber Arrived badge for an arrived appointment\'s status', async () => {})
  ```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement.** Add `'arrived': 'bg-amber-100 text-amber-800'`
  to this page's existing `STATUS_BADGE_CLASSES` map. The action-button
  block, currently gated on `selected.status === 'approved'` showing
  Mark-completed/No-show, now also shows a "Mark arrived" button when
  `status === 'approved'` (alongside, or instead of, the existing two —
  implementer's call on exact button grouping, matching the wireframe's
  own "Mark arrived" placement if helpful, but this page's detail panel
  isn't a 1:1 copy of the dashboard's row — use judgment), and shows
  Mark-completed/No-show (not Mark arrived) when `status === 'arrived'`.

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Run the full web suite, confirm no regression.**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/doctor/doctor-appointments.page.tsx apps/web/src/features/doctor/__tests__/doctor-appointments.page.test.tsx
git commit -m "feat: wire Mark arrived into DoctorAppointmentsPage"
```

---

### Task 7: `DoctorDashboardPage`

**Files:**
- Create: `apps/web/src/features/doctor/doctor-dashboard.page.tsx`
- Test: `apps/web/src/features/doctor/__tests__/doctor-dashboard.page.test.tsx`

**Interfaces:**
- Consumes: `getDashboardStats`/`getRecentEmails` (Task 5),
  `getAvailability`/`getSlots` (existing, `doctor.api.ts`),
  `markAppointmentOutcome` (Task 5, widened), `listDoctorAppointments`
  (existing, `doctor-appointments.api.ts`, filtered to today for the
  schedule section).

- [ ] **Step 1: Read `project/DoctorDashboard.dc.html`** directly for the
  stat-card grid, "Today's schedule" row layout (including the
  highlighted "Next" row and its "Mark arrived" button), "My next
  available days" tag row, and "Recent emails" list — copy and structure.

- [ ] **Step 2: Write the failing tests**, modeled on
  `doctor-appointments.page.test.tsx`'s conventions:
  ```ts
  it('renders the four stat cards from getDashboardStats', async () => {})
  it("renders today's schedule in time order with Completed/Next/Approved/Arrived tags and an Open-slot row for a gap", async () => {})
  it('clicking Mark arrived on the next appointment calls markAppointmentOutcome and refetches', async () => {})
  it('tags a next-available-day as full when getSlots returns an empty array for it', async () => {})
  it('renders the recent-emails list from getRecentEmails, or an empty state when there are none', async () => {})
  it('renders empty states for a doctor with no appointments today / no available days this month, without crashing', async () => {})
  ```

- [ ] **Step 3: Run it, confirm it fails.**

- [ ] **Step 4: Implement `DoctorDashboardPage`.** Model the fetch/state
  shape on `doctor-appointments.page.tsx` (plain `useState`/`useEffect`,
  `listBanner`/`actionBanner` pattern). "Next" is the chronologically
  next `approved` (or `arrived`) appointment in today's schedule relative
  to the current time — same kind of time-comparison this app's slot
  code already does elsewhere (`parse_time_of_day`-equivalent on the
  frontend, implementer's call on the exact helper). "Full" days: take
  the next 4 dates from `getAvailability` that are today-or-later, call
  `getSlots` for each, tag "full" when the result is empty.

- [ ] **Step 5: Run it, confirm it passes.**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/doctor/doctor-dashboard.page.tsx apps/web/src/features/doctor/__tests__/doctor-dashboard.page.test.tsx
git commit -m "feat: DoctorDashboardPage"
```

---

### Task 8: Wire the route and flip `AppShell`'s Dashboard entry live

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/__tests__/app-shell.test.tsx`

**Interfaces:**
- Consumes: `DoctorDashboardPage` (Task 7), `ProtectedRoute`'s existing
  `allowedRoles` prop.

- [ ] **Step 1: Update the failing test** — `app-shell.test.tsx`'s
  existing assertion that the doctor's "Dashboard" item is inert (no
  `href`, `aria-disabled`) must change to assert it IS now a real link
  with `href="/doctor/dashboard"`, matching the new route. This is the
  one deliberate, named exception in
  this plan's Global Constraints — update it, don't work around it.

- [ ] **Step 2: Run it, confirm it fails** (current `NAV_ITEMS` still has
  `href: null` for `doctor-dashboard`).

- [ ] **Step 3: Implement.** In `app-shell.tsx`'s `NAV_ITEMS`, change the
  doctor role's `{ key: 'doctor-dashboard', label: 'Dashboard', href: null }`
  to `href: '/doctor/dashboard'`. In `App.tsx`, add:
  ```tsx
  <Route
    path="/doctor/dashboard"
    element={
      <ProtectedRoute allowedRoles={['doctor']}>
        <AppShell activeNavKey="doctor-dashboard">
          <DoctorDashboardPage />
        </AppShell>
      </ProtectedRoute>
    }
  />
  ```

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Run the full web suite + `tsc -b --noEmit`, confirm no
  regression.**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/app-shell.tsx apps/web/src/components/__tests__/app-shell.test.tsx
git commit -m "feat: wire DoctorDashboardPage route, make AppShell's Dashboard link real"
```
