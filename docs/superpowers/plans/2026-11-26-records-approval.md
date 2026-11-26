# Records Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `records` role's approval workflow end-to-end — a
queue of booking requests, a per-request review/decide screen (approve,
approve a different slot, or decline with reason), an undo on any decided
request, and the two patient/doctor emails each decision triggers.

**Architecture:** Two new backend route-class additions
(`RecordsRoutes`, mounted the same way `AppointmentRoutes`/`DoctorRoutes`
already are) plus two small hardening changes to the existing
`Appointment` model and `AppointmentRoutes#appointment_json`. Two new
frontend pages (`RecordsQueuePage`, `RequestReviewPage`) following the
exact plain-`useEffect`/`useState` + `authedFetch` conventions already
used by `MyAppointmentsPage` and `BookAppointmentPage` — no new frontend
infra.

**Tech Stack:** Same as every prior plan — Sinatra/Sequel/MySQL backend,
React/Vite/TypeScript frontend, RSpec + Rack::Test, Vitest + Testing
Library. Email delivery reuses the existing `Mailer.deliver(to:, subject:,
body:)` service (`apps/api/app/services/mailer.rb`) introduced in Plan 1
for password-reset — no new gem.

**Spec:** `docs/superpowers/specs/2026-11-23-clinic-appointment-rewrite-design.md`
(Records role, data model, `/records/*` API surface) and
`docs/superpowers/specs/2026-11-23-clinic-appointment-screen-specs.md`
(§4 Records — `RecordsQueue`, `RequestReview`; §6 Email notifications —
`EmailDoctor`, `EmailPatient`, `EmailRejected`).

**Builds on:** the merged Backend Foundation & Auth, Frontend Foundation &
Auth UI, Departments/Doctors/Availability, and Patient Booking & My
Appointments plans. Three Important findings deferred from that last
plan's final review feed directly into this one's scope decisions below
(#8 status validation, #12 serializer N+1) or are explicitly carried
forward as still-open after this plan (#4 month nav, #6
`max_patients_per_day` enforcement, #7 pending-squatting, #11 unused
search/date-range filters, #14 cancel-cutoff wording) — those five stay
out of scope here too; see "Out of scope" below.

## Global Constraints

- Every `/records/*` route requires `authenticate!` then
  `require_role!('records')`, as a **path-scoped** `before` filter per
  literal path — never a blanket filter on the whole route class. This is
  the established, load-bearing house rule in this codebase: a blanket
  `before` breaks `Rack::Cascade`'s 404-fallthrough for every route class
  mounted after this one. Follow `doctors.rb`'s and `appointments.rb`'s
  existing per-path filters exactly.
- **No new gem, no new mailer class.** Every email in this plan calls the
  existing `Mailer.deliver(to:, subject:, body:)` — same one `POST
  /auth/password/forgot` already uses. Test it the same way that route's
  spec does: `allow(Mailer).to receive(:deliver) { |args| ... }` (see
  `apps/api/spec/requests/auth/forgot_password_spec.rb:21`).
- **No `email_toggles` table and no per-decision toggle check.** That's
  Admin-settings scope (a later plan). Every decision in this plan sends
  its email(s) unconditionally. A later plan wrapping these same call
  sites with a toggle check is additive, not a breaking change to this
  one.
- **Which emails, exactly** — matching `RequestReview`'s own "Emails that
  will be sent" preview box, nothing more: Approve and Approve-a-different-
  slot each send **patient + doctor** (`EmailPatient`/`EmailDoctor`
  content, screen-specs.md:176-179); Decline sends **patient only**
  (`EmailRejected` content, screen-specs.md:181-182). Undo sends no email.
  "Request received" (booking time) and the 24h reminder (needs a
  scheduled job) are out of scope for this plan — see "Out of scope."
- **Decline reasons are a fixed, closed set** matching the screen spec
  exactly: `Appointment::DECLINE_REASON_CODES = %w[doctor_unavailable
  slot_taken needs_referral other]` (screen-specs.md:135: "Doctor
  unavailable/Slot already taken/Needs referral first/Other").
- **"Approve a different slot" updates the existing appointment row in
  place** — it changes that row's own `date`/`time` and sets
  `status: 'approved'`. It does **not** create a new appointment row and
  does **not** write `reschedule_of_id`. The design doc's one mention of
  `reschedule_of_id` groups "Records' approve-a-different-slot" with "a
  doctor's book-follow-up" as its two future uses, but a doctor-initiated
  follow-up (a separate, later plan: Doctor Appointments & Clinical Notes)
  is the one that actually needs a link between two distinct appointment
  rows. Approve-a-different-slot only ever concerns one request becoming
  one appointment at a (possibly different) time, so there is nothing to
  link. `reschedule_of_id` stays null everywhere this plan writes.
- **The doctor-day-load grid and "no conflicts" line are computed
  client-side**, from two endpoints that already exist and already allow
  any authenticated role (`GET /doctors/:id/availability?month=` and
  `GET /doctors/:id/slots?date=` — neither has a `require_role!`, see
  `doctors.rb:63-64`): "booked" times = (the doctor's full generated slot
  grid for that date) minus (the free times `/slots` returns). No new
  backend endpoint for this.
- **`ref` is computed, not stored** — `format('REQ-%05d', appointment.id)`
  wherever the screen spec shows a "Ref" column/field. No new migration
  column.
- **Queue stats are computed from every appointment, not the
  tab-filtered dataset** — so switching tabs never changes the stat cards.
- **Add status validation now** (closing final review Minor #8 from the
  prior plan, which flagged this explicitly: "revisit before the Records
  plan"). This plan is the second code path that writes `appointments.status`
  (previously only `pending`, from booking); a typo in the literal
  `'approved'`/`'declined'` string here would now silently break slot
  exclusion with no error, which is exactly what `validates_includes`
  closes.
- **Fix the list-serializer N+1 now** (closing the same final review's
  Minor #12, flagged for the same reason: "before the Records plan...
  copies this serializer"). `RecordsRoutes`' own queue serializer is a new,
  second consumer of the same doctor/department lookup shape — fix the
  original in `AppointmentRoutes#appointment_json` first so the new one
  doesn't copy the N+1 pattern forward.

## Out of scope (explicitly, not silently)

- `max_patients_per_day` enforcement, pending-request caps/auto-expiry,
  booking-calendar month navigation, `MyAppointments` search/date-range UI,
  and the cancel-cutoff wording mismatch — all five carried forward
  unresolved from the prior plan's final review. None of them are this
  plan's to fix; they're Admin-settings or patient-booking concerns.
- `email_toggles`, `clinic_settings`, and every other Admin-settings table.
- The "Other appointments" admin-facing reports/views mentioned on
  `RecordsQueue`'s nav ("All appointments, Doctors' calendars, Patients,
  Reports") — only the Approval queue tab and its Review screen are this
  plan's scope. The other four nav items are placeholders a later Admin
  plan may build; add the nav links as plain static text or omit them,
  implementer's call, since the spec doesn't describe their content.

## Review Focus

- A records user re-submitting the same decision a second time (double
  click, two tabs open) on a request another decision already resolved —
  must 422, never silently re-decide or send a second round of emails.
- Approving a different slot that another appointment grabbed between the
  doctor-day grid loading and the confirm click — must still be caught by
  the same transactional occupancy check `POST /appointments` already
  uses, not just trusted because the grid looked free a few seconds ago.
- Declining with a missing or invalid `decline_reason_code` — must 422
  with a field error, never persist an out-of-set value.
- A `patient` or `doctor` role hitting any `/records/*` route directly —
  must 403, not just be hidden from by the frontend nav.
- Calling Undo on a request that is still `pending` (nothing to undo) —
  must 422, never silently no-op.

---

### Task 1: Appointment model hardening + serializer fixes

**Files:**
- Modify: `apps/api/app/models/appointment.rb`
- Modify: `apps/api/app/routes/appointments.rb` (`appointment_json`, `GET /appointments`)
- Test: `apps/api/spec/models/appointment_spec.rb`
- Test: `apps/api/spec/requests/appointments_spec.rb`

**Interfaces:**
- Produces: `Appointment::DECLINE_REASON_CODES` (`%w[doctor_unavailable
  slot_taken needs_referral other]`), used by Task 4's decline endpoint.
- Produces: `appointment_json(appointment, department: nil)` — same
  return shape as today plus three new keys (`decline_reason_code`,
  `decline_message`, `decided_at`), and an optional `department:` keyword
  the list route now passes to avoid a per-row query. Every other existing
  call site (`GET /appointments/:id`, `POST /appointments/:id/cancel`)
  keeps calling it with one positional argument — unaffected.

- [ ] **Step 1: Write the failing model test**

```ruby
# apps/api/spec/models/appointment_spec.rb
it 'rejects a status outside the known set' do
  appointment = build_appointment(status: 'bogus')
  expect(appointment).not_to be_valid
  expect(appointment.errors[:status]).not_to be_empty
end

it 'rejects a decline_reason_code outside the known set, but allows nil' do
  declined = build_appointment(status: 'declined', decline_reason_code: 'not_a_real_reason')
  expect(declined).not_to be_valid

  pending_one = build_appointment(status: 'pending', decline_reason_code: nil)
  expect(pending_one).to be_valid
end
```
(Use whatever existing factory/helper this spec file already has for
building a valid appointment's required fields — `patient_id`,
`doctor_id`, `department_id`, `date`, `time`, `duration_minutes`,
`visit_type`, `reason`, `submitted_at` — and override only the field under
test.)

- [ ] **Step 2: Run it, confirm it fails** (`bundle exec rspec spec/models/appointment_spec.rb`) — expect both new examples to fail (no validation exists yet).

- [ ] **Step 3: Add validations in `apps/api/app/models/appointment.rb`**

```ruby
plugin :validation_helpers

DECLINE_REASON_CODES = %w[doctor_unavailable slot_taken needs_referral other].freeze

def validate
  super
  validates_includes STATUSES, :status
  validates_includes DECLINE_REASON_CODES, :decline_reason_code, allow_nil: true
end
```

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Write the failing serializer test**

Add to `apps/api/spec/requests/appointments_spec.rb`, in `GET
/appointments/:id`'s existing describe block: a test asserting the JSON
body includes `decline_reason_code: nil`, `decline_message: nil`,
`decided_at: nil` for a freshly-booked (`pending`) appointment. Add a
second test (in `GET /appointments`'s existing describe block) booking two
appointments in two different departments and asserting each row's
`department.name` in the response matches its own department, not the
other one's (the regression this N+1 fix must not introduce: a shared
lookup hash keyed wrong).

- [ ] **Step 6: Run it, confirm it fails** (missing keys).

- [ ] **Step 7: Implement in `apps/api/app/routes/appointments.rb`**

Change `appointment_json`'s signature to `appointment_json(appointment,
department: nil)`, defaulting `department ||= Department[appointment.department_id]`
when not given, and add the three new keys to the returned hash reading
straight off the model (`decided_at&.iso8601` for the timestamp, nil-safe).

In `GET /appointments`, after `appointments = dataset.order(...).all`,
build `departments_by_id = Department.where(id: appointments.map(&:department_id).uniq).as_hash(:id)`
once and pass `department: departments_by_id[a.department_id]` into each
`appointment_json` call. Also change the dataset to
`Appointment.where(patient_id: current_user.id).eager(:doctor)` so
`appointment.doctor` inside `appointment_json` doesn't issue a query per
row. Leave `GET /appointments/:id` and `POST /appointments/:id/cancel`'s
single-row calls to `appointment_json(appointment)` untouched — one row
needs no eager-loading.

- [ ] **Step 8: Run both specs, confirm everything passes**, then run the
  full API suite to confirm no regression: `bundle exec rspec`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/app/models/appointment.rb apps/api/app/routes/appointments.rb apps/api/spec/models/appointment_spec.rb apps/api/spec/requests/appointments_spec.rb
git commit -m "feat: validate appointment status/decline-reason, fix list serializer N+1"
```

---

### Task 2: `GET /records/queue` and `GET /records/requests/:id`

**Files:**
- Create: `apps/api/app/routes/records.rb`
- Modify: `apps/api/app/api.rb` (mount `RecordsRoutes`)
- Test: `apps/api/spec/requests/records_spec.rb`

**Interfaces:**
- Produces: `RecordsRoutes < ApiRoutes`, the class Tasks 3 and 4 add more
  routes to in this same file (mirrors how `AppointmentRoutes` grew across
  Plan 4's tasks).
- Produces: a private `request_json(appointment)` helper returning the
  `"request"` object shape below — Tasks 3 and 4 reuse it for their own
  responses so every `/records/*` endpoint returns the request in exactly
  one shape.
- Consumes: `Appointment::DECLINE_REASON_CODES` and the validations from
  Task 1 (so a malformed row can never reach this serializer).

- [ ] **Step 1: Write the failing queue test**

```ruby
# apps/api/spec/requests/records_spec.rb
describe 'GET /records/queue' do
  it 'lists pending requests by default, with stats computed across all statuses' do
    # Arrange: one pending, one approved-today, one declined-today, one
    # cancelled, all via direct Appointment.create (not through the booking
    # endpoint) so the fixture doesn't depend on Task 2's own code.
    # Act: GET as a `records` user.
    # Assert: `requests` contains only the pending one; `stats.pending == 1`,
    # `stats.approved_today == 1`, `stats.declined_today == 1`,
    # `stats.oldest_waiting_at` equals the pending row's `submitted_at`.
  end

  it 'rejects a patient or doctor role with 403' do
  end

  it 'filters by status, doctor_id, and search (patient/doctor name)' do
  end
end

describe 'GET /records/requests/:id' do
  it "returns the request plus the patient's stats" do
    # Arrange a patient with: 2 completed appointments (one more recent),
    # 1 no_show, 1 other pending (different id from the one under test).
    # Assert patient_stats == { previous_visits_count: 2, last_visit_date:
    # <the later completed date>, no_show_count: 1, other_pending_count: 1 }.
  end

  it 'returns 404 for a nonexistent id, and 403 for a non-records role' do
  end
end
```

- [ ] **Step 2: Run it, confirm it fails** — no route exists yet.

- [ ] **Step 3: Implement `apps/api/app/routes/records.rb`**

```ruby
require 'json'
require 'date'
require_relative 'api_base'

class RecordsRoutes < ApiRoutes
  helpers AuthHelpers

  NOT_FOUND_MESSAGE = 'Not found'
  QUEUE_STATUSES = %w[pending approved declined cancelled].freeze

  before('/records/queue') { authenticate!; require_role!('records') }
  before('/records/requests/:id') { authenticate!; require_role!('records') }

  get '/records/queue' do
    # status param: one of QUEUE_STATUSES, default 'pending'
    # doctor_id param: optional exact filter
    # search param: substring match against patient/doctor first+last name
    # sort param: 'oldest' (submitted_at asc, default) or 'newest' (desc)
    # Returns { stats: {...}, requests: [...], total: N }
  end

  get '/records/requests/:id' do
    # 404 via Appointment[params['id']] — no ownership scoping, records
    # sees every appointment regardless of patient.
    # Returns { request: request_json(appointment), patient_stats: {...} }
  end

  helpers do
    def ref_for(appointment)
      format('REQ-%05d', appointment.id)
    end

    def request_json(appointment)
      # id, ref, patient: {id, first_name, last_name[, email, phone — see
      # note below]}, doctor: {id, first_name, last_name}, department:
      # {id, name}, date, time, duration_minutes, visit_type, reason,
      # status, submitted_at, decided_at, decline_reason_code,
      # decline_message, internal_note
    end

    def patient_stats_for(patient_id, excluding_appointment_id)
      others = Appointment.where(patient_id: patient_id).exclude(id: excluding_appointment_id)
      completed = others.where(status: 'completed')
      {
        previous_visits_count: completed.count,
        last_visit_date: completed.max(:date)&.iso8601,
        no_show_count: others.where(status: 'no_show').count,
        other_pending_count: others.where(status: 'pending').count
      }
    end
  end
end
```

`request_json`'s `patient` sub-object needs `email`/`phone` only on the
single-request detail endpoint (the patient card on `RequestReview`
shows them; the queue table does not) — either give `request_json` a
`detailed:` flag that includes them only when true, or write a second
small helper for the two extra fields. Implementer's call; keep the
queue's own list response free of email/phone either way, since the
queue table doesn't show them and there's no reason to leak them into a
list response that doesn't need them.

For `search`: reuse the same case-insensitive substring approach
`AppointmentRoutes#filter_by_search` already established in
`appointments.rb` (`Sequel.ilike` against first/last name) — this file's
own small duplicate, matching the established duplication-over-sharing
convention between these route files.

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Mount `RecordsRoutes` in `apps/api/app/api.rb`** — add
  `require_relative 'routes/records'` and append `RecordsRoutes` to
  `MOUNTED_ROUTES`.

- [ ] **Step 6: Run the full API suite, confirm no regression.**

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/routes/records.rb apps/api/app/api.rb apps/api/spec/requests/records_spec.rb
git commit -m "feat: GET /records/queue and GET /records/requests/:id"
```

---

### Task 3: Approve and approve-a-different-slot

**Files:**
- Modify: `apps/api/app/routes/records.rb`
- Test: `apps/api/spec/requests/records_spec.rb`

**Interfaces:**
- Consumes: `request_json` and `NOT_FOUND_MESSAGE` from Task 2.
- Consumes doctor-session-settings slot generation — mirror
  `DoctorRoutes`/`AppointmentRoutes`'s already-duplicated
  `generate_slots`/`parse_time_of_day`/`available_day?`/
  `current_minute_of_day` helpers (see `appointments.rb:219-260`) as this
  file's own small copy, per the established duplication convention
  (`appointments.rb:36-40`'s comment explains why).
- Produces: `ALREADY_DECIDED_MESSAGE` constant, reused by Task 4's decline
  endpoint's own already-decided check.

- [ ] **Step 1: Write the failing tests**

```ruby
describe 'POST /records/requests/:id/approve' do
  it 'approves a pending request, sets decided_at/decided_by, and emails patient+doctor' do
    deliveries = []
    allow(Mailer).to receive(:deliver) { |args| deliveries << args }
    # ... act ...
    expect(deliveries.size).to eq(2)
    expect(deliveries.map { |d| d[:to] }).to contain_exactly(patient.email, doctor.email)
  end

  it 'rejects a request that is not pending, with 422, and sends no email' do
  end

  it 'rejects a non-records role with 403' do
  end
end

describe 'POST /records/requests/:id/approve-alternate' do
  it "moves the request to the given date/time and approves it, emailing patient+doctor with the NEW slot" do
  end

  it 'rejects an alternate slot already held by another appointment, with 422 on `time`' do
    # Arrange a second, unrelated appointment already occupying the target
    # doctor/date/time. Assert the request under test is untouched
    # (still pending, still its original date/time) after the 422.
  end

  it 'rejects a malformed or unavailable alternate date/time with field-level 422s' do
  end
end
```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement both routes in `apps/api/app/routes/records.rb`**

```ruby
ALREADY_DECIDED_MESSAGE = 'This request has already been decided'

before('/records/requests/:id/approve') { authenticate!; require_role!('records') }
before('/records/requests/:id/approve-alternate') { authenticate!; require_role!('records') }
# ... same request-body-parsing before block as appointments.rb uses for
# JSON bodies, scoped to these two paths.

post '/records/requests/:id/approve' do
  appointment = Appointment[params['id']]
  halt_json_error 404, NOT_FOUND_MESSAGE unless appointment
  halt_json_error 422, ALREADY_DECIDED_MESSAGE unless appointment.status == 'pending'

  already_decided = false
  DB.transaction do
    appointment = Appointment.where(id: appointment.id).for_update.first
    if appointment.status == 'pending'
      appointment.update(status: 'approved', decided_at: Time.now, decided_by_user_id: current_user.id,
                          internal_note: @payload['internal_note'] || appointment.internal_note)
    else
      already_decided = true
    end
  end
  halt_json_error 422, ALREADY_DECIDED_MESSAGE if already_decided

  deliver_approved_emails(appointment)
  json(request: request_json(appointment))
end
```

`approve-alternate` follows the same transaction-and-halt-outside shape,
with two extra pieces inside the same transaction: (a) re-validate the
target `date`/`time` the same way `POST /appointments` does (doctor
available that day, time in that day's generated slots, not in the past
if `date == Date.today`, within `DoctorRoutes::MAX_BOOKING_WINDOW_DAYS`),
returning field-level 422s on `date`/`time` exactly like `POST
/appointments` does, and (b) check the target slot isn't held by
*another* appointment: `Appointment.where(doctor_id: appointment.doctor_id,
date: new_date, time: new_time, status: Appointment::OCCUPYING_STATUSES)
.exclude(id: appointment.id).for_update.empty?` — excluding the row being
moved is what makes this safe to call even though that row itself already
occupies its *old* slot. On success, update `date`, `time`, `status:
'approved'`, `decided_at`, `decided_by_user_id`, `internal_note`.

Add a private `deliver_approved_emails(appointment)` helper building
subject/body text per `EmailPatient`/`EmailDoctor`
(screen-specs.md:176-179: doctor/date/time/visit-type/reason/approved-by
for the doctor's email; doctor/date/time/where/reference for the
patient's) and calling `Mailer.deliver` twice (`appointment.patient.email`,
`appointment.doctor.email`).

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Run the full API suite, confirm no regression.**

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routes/records.rb apps/api/spec/requests/records_spec.rb
git commit -m "feat: approve and approve-a-different-slot for records requests"
```

---

### Task 4: Decline, undo, mount, and seed data

**Files:**
- Modify: `apps/api/app/routes/records.rb`
- Modify: `apps/api/db/seeds.rb`
- Test: `apps/api/spec/requests/records_spec.rb`

**Interfaces:**
- Consumes: `ALREADY_DECIDED_MESSAGE`, `request_json`, `NOT_FOUND_MESSAGE`
  from Tasks 2/3.
- Produces: nothing new for later tasks (this is the last backend task).

- [ ] **Step 1: Write the failing tests**

```ruby
describe 'POST /records/requests/:id/decline' do
  it 'declines a pending request with a valid reason, emailing the patient only' do
    deliveries = []
    allow(Mailer).to receive(:deliver) { |args| deliveries << args }
    # decline_reason_code: 'slot_taken', decline_message: 'please rebook'
    expect(deliveries.size).to eq(1)
    expect(deliveries.first[:to]).to eq(patient.email)
  end

  it 'rejects a missing or out-of-set decline_reason_code with a field-level 422' do
  end

  it 'rejects a request that is not pending, with 422' do
  end
end

describe 'POST /records/requests/:id/undo' do
  it 'reverts a declined or approved request back to pending and clears decision fields' do
    # internal_note, if any, is left untouched.
  end

  it 'rejects a request that is still pending, with 422, and sends no email' do
  end
end
```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement both routes**

```ruby
NOTHING_TO_UNDO_MESSAGE = 'This request is still pending — there is nothing to undo'
REASON_REQUIRED_MESSAGE = "Select a reason: #{Appointment::DECLINE_REASON_CODES.join(', ')}"

before('/records/requests/:id/decline') { authenticate!; require_role!('records') }
before('/records/requests/:id/undo') { authenticate!; require_role!('records') }

post '/records/requests/:id/decline' do
  appointment = Appointment[params['id']]
  halt_json_error 404, NOT_FOUND_MESSAGE unless appointment
  halt_json_error 422, ALREADY_DECIDED_MESSAGE unless appointment.status == 'pending'

  reason_code = @payload['decline_reason_code']
  unless reason_code.is_a?(String) && Appointment::DECLINE_REASON_CODES.include?(reason_code)
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, decline_reason_code: REASON_REQUIRED_MESSAGE
  end

  # Same for-update re-check-inside-transaction shape as Task 3's approve.
  # ... update status: 'declined', decided_at, decided_by_user_id,
  # decline_reason_code: reason_code, decline_message: @payload['decline_message'],
  # internal_note: @payload['internal_note'] || appointment.internal_note

  deliver_declined_email(appointment)
  json(request: request_json(appointment))
end

post '/records/requests/:id/undo' do
  appointment = Appointment[params['id']]
  halt_json_error 404, NOT_FOUND_MESSAGE unless appointment
  halt_json_error 422, NOTHING_TO_UNDO_MESSAGE if appointment.status == 'pending'

  appointment.update(status: 'pending', decided_at: nil, decided_by_user_id: nil,
                      decline_reason_code: nil, decline_message: nil)
  json(request: request_json(appointment))
end
```

Add the request-body-parsing `before` block for `/records/requests/:id/decline`
(mirrors the one Task 3 added for approve/approve-alternate; `/undo` takes
no body, so it needs no such block). Add a private
`deliver_declined_email(appointment)` helper per `EmailRejected`
(screen-specs.md:181-182: request detail, "Reason from Records" callout
using `decline_message`, note that the slot was released), calling
`Mailer.deliver` once to `appointment.patient.email`.

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Add a demo `records` user to `apps/api/db/seeds.rb`**

Follow the exact pattern the file already uses for doctors (`find_or_create`
by username, idempotent, password echoed to stdout) — this is explicitly
why that file's header comment says "ahead of the Admin plan's real
account-creation UI," and this plan is the first to need a records login:

```ruby
RECORDS_STAFF = {
  username: 'records.staff',
  email: 'records.staff@lynks.demo',
  first_name: 'Linda',
  last_name: 'Boateng',
  password: 'Records123!'
}.freeze
```

Create it with `role: 'records'`, `status: 'active'`,
`must_change_password: false`, after the `DEPARTMENTS.each` loop, printing
the same "Created ... / already exists" lines the doctor loop does.

- [ ] **Step 6: Run `bundle exec rake db:seed` (or this repo's equivalent
  task) locally and confirm it prints the records user's credentials once
  and "already exists" on a second run.**

- [ ] **Step 7: Run the full API suite, confirm no regression.**

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/routes/records.rb apps/api/db/seeds.rb apps/api/spec/requests/records_spec.rb
git commit -m "feat: decline and undo for records requests; seed a demo records user"
```

---

### Task 5: `records.api.ts` + `RecordsQueuePage`

**Files:**
- Create: `apps/web/src/features/records/records.api.ts`
- Create: `apps/web/src/features/records/records-queue.page.tsx`
- Test: `apps/web/src/features/records/__tests__/records.api.test.ts`
- Test: `apps/web/src/features/records/__tests__/records-queue.page.test.tsx`

**Interfaces:**
- Consumes: `GET /records/queue`'s exact response shape from Task 2
  (`{ stats, requests, total }`).
- Produces: `RecordsQueueStats`, `RecordsQueueRequest`,
  `RecordsQueueFilters`, `getQueue(authedFetch, filters?)` — Task 6's
  `RequestReviewPage` consumes the same `records.api.ts` module (its own
  `getRequest`/`approveRequest`/etc. exports), so match the file's
  existing export style exactly (`appointments.api.ts`'s
  `type AuthedFetch = <T>(path: string, options?: {...}) => Promise<T>`
  convention).

- [ ] **Step 1: Write `records.api.ts`'s types and `getQueue`**

```ts
export interface RecordsQueueStats {
  pending: number;
  approved_today: number;
  declined_today: number;
  oldest_waiting_at: string | null;
}

export interface RecordsPersonSummary {
  id: number;
  first_name: string;
  last_name: string;
}

export interface RecordsQueueRequest {
  id: number;
  ref: string;
  patient: RecordsPersonSummary;
  doctor: RecordsPersonSummary;
  department: { id: number; name: string };
  date: string;
  time: string;
  visit_type: string;
  status: string;
  submitted_at: string;
}

export interface RecordsQueueFilters {
  status?: 'pending' | 'approved' | 'declined' | 'cancelled';
  doctor_id?: number;
  search?: string;
  sort?: 'oldest' | 'newest';
}

export function getQueue(
  authedFetch: AuthedFetch,
  filters?: RecordsQueueFilters,
): Promise<{ stats: RecordsQueueStats; requests: RecordsQueueRequest[]; total: number }> {
  // Mirrors appointments.api.ts's listAppointments: build a URLSearchParams
  // from whichever filters are present, omit the rest.
}
```

- [ ] **Step 2: Write the failing `records.api.test.ts` test** — asserts
  `getQueue` calls `authedFetch` with the right path and query string for
  a representative filter combination (status + doctor_id + search +
  sort all set), same style as
  `apps/web/src/features/appointments/__tests__/appointments.api.test.ts`.

- [ ] **Step 3: Run it, confirm it fails, then implement, then confirm it passes.**

- [ ] **Step 4: Write the failing `RecordsQueuePage` test(s)**

Covering: default tab is Pending and calls `getQueue` with
`status: 'pending'`; stat cards render the four numbers from the response
(including `oldest_waiting_at: null` rendering as an em dash or similar,
not a raw `null`/crash); switching tabs re-fetches with the new `status`;
typing in the search box (debounced or on-blur — implementer's call, no
debounce infra exists yet elsewhere in this codebase so a plain on-change
re-fetch is consistent with the rest of this app) re-fetches with
`search`; a pending row's "Review" action is a link to
`/records/requests/:id`.

- [ ] **Step 5: Run it, confirm it fails.**

- [ ] **Step 6: Implement `RecordsQueuePage`**

Model this directly on `MyAppointmentsPage`
(`apps/web/src/features/appointments/my-appointments.page.tsx`): plain
`useState`/`useEffect`/`useCallback` fetch-on-mount-and-filter-change,
`listBanner`/`actionBanner` pattern, `role="alert"` banners,
`aria-pressed` tab buttons. Four stat cards above the tabs. Table columns
per screen-specs.md:125 (Ref, Patient, Doctor, Requested slot, Submitted,
Status, Actions); "Submitted" renders as a relative time (e.g. "2h ago") —
write one small `relativeTime(iso: string): string` helper in this file,
no new dependency. Row actions: pending rows get a "Review" link (to
`/records/requests/:id`) and an inline "Approve" button calling
`approveRequest` directly from the queue (Task 6 exports it from
`records.api.ts`) followed by a `refetch()` on success, matching
`MyAppointmentsPage#handleCancel`'s refetch-after-action pattern; "Decline"
on a pending row is a link to `/records/requests/:id` too (declining needs
a required reason, which only the Review screen's form collects — ruled
here rather than left ambiguous: no inline decline). Non-pending rows show
the decided outcome (`decided_at`, and `decline_reason_code` if declined)
plus an "Undo" button calling `undoRequest` then `refetch()`.

(`approveRequest`/`undoRequest` are Task 6's exports from
`records.api.ts` — if Task 6 hasn't landed yet when this task is worked,
add minimal versions of those two functions here instead and let Task 6
reuse them rather than re-defining; either ordering is fine since both
land in the same file.)

- [ ] **Step 7: Run it, confirm it passes.**

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/records/records.api.ts apps/web/src/features/records/records-queue.page.tsx apps/web/src/features/records/__tests__
git commit -m "feat: records.api.ts and RecordsQueuePage"
```

---

### Task 6: `RequestReviewPage`

**Files:**
- Modify: `apps/web/src/features/records/records.api.ts` (add
  `getRequest`, `approveRequest`, `approveAlternateRequest`,
  `declineRequest`, `undoRequest` if not already present from Task 5)
- Create: `apps/web/src/features/records/request-review.page.tsx`
- Test: `apps/web/src/features/records/__tests__/request-review.page.test.tsx`

**Interfaces:**
- Consumes: `GET /records/requests/:id`'s `{ request, patient_stats }`
  shape (Task 2) and the four decision endpoints' `{ request: {...} }`
  response shape (Tasks 3-4).
- Consumes: `GET /doctors/:id/availability?month=` and `GET
  /doctors/:id/slots?date=` from `apps/web/src/features/doctor/doctor.api.ts`
  (already exported — `getPublicAvailability`, `getSlots` per Plan 4 Task
  6) — this is how the doctor-day-load grid is built, per this plan's
  Global Constraints.

- [ ] **Step 1: Write the failing tests**

Covering: on load, fetches the request detail and renders the header
(ref + status), the requested-appointment `dl`, and the patient card's
stats; selecting "Approve a different slot" reveals New date/New time
selects and hides them again if the user switches back to "Approve";
selecting "Decline" reveals the reason select (required) and message
textarea; the "Emails that will be sent" preview box text changes with
the selected decision (patient+doctor for Approve/Approve-alternate,
patient-only for Decline); the confirm button's label changes with the
decision ("Approve" / "Approve for the new time" / "Decline request");
submitting calls the matching endpoint (`approveRequest` /
`approveAlternateRequest` with the chosen date+time /
`declineRequest` with the chosen reason+message) and then shows a
post-confirm outcome banner matching screen-specs.md:138 ("approved →
emails sent" / "declined → slot freed + patient emailed"); a 422 from any
of the four decision endpoints surfaces via `applyApiError` (reuse the
existing helper from `apps/web/src/lib/api-error-handling.ts`) rather than
being swallowed.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement `request-review.page.tsx`**

Use React Hook Form for the decision panel (radio for
Approve/Approve-alternate/Decline, conditional fields per the test cases
above), the same `applyApiError` + banner pattern
`BookAppointmentPage`/`RegisterPage` already use. Fetch the doctor-day
grid with a plain `useEffect` once the request detail has loaded (need the
`doctor.id` and requested `date` from it): call `getPublicAvailability`
for that month to confirm the day is open, and `getSlots` for that date to
get the free times; render the day's full generated grid (reuse this
file's own small `generateSlotsClientSide`-style derivation is NOT
needed — simpler: render every time `getSlots` returns as "free" and
every other half-hour-stepped placeholder... no, simplest correct
approach: the grid only needs to show "the requested time" plus whichever
alternate time the records user is considering, each tagged booked/free
by checking membership in the `getSlots` free-list — there is no
requirement to render the doctor's *entire* day as a grid of every
individual slot, re-reading screen-specs.md:132 ("that day's slots
color-coded booked/free with a 'no conflicts' confirmation line") —
implementer's call on exact visual density, but the free/booked
membership check against `getSlots`' response is the one required
mechanism). The "no conflicts" line is simply: the requested (or chosen
alternate) time is present in the free-times list.

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Run the full web suite + `tsc -b --noEmit`, confirm no regression.**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/records/records.api.ts apps/web/src/features/records/request-review.page.tsx apps/web/src/features/records/__tests__
git commit -m "feat: RequestReviewPage"
```

---

### Task 7: Wire routes and the records landing link

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/dashboard/role-landing.page.tsx`
- Test: `apps/web/src/features/dashboard/__tests__/role-landing.page.test.tsx`

**Interfaces:**
- Consumes: `RecordsQueuePage` (Task 5), `RequestReviewPage` (Task 6),
  `ProtectedRoute`'s existing `allowedRoles` prop.

- [ ] **Step 1: Write the failing `role-landing.page.test.tsx` test** —
  a `records`-role user sees a "Review requests" (or similar) link to
  `/records/queue`; a `patient`/`doctor` user does not. Mirrors the
  existing doctor-link test in this same file exactly.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Add the routes in `App.tsx`**

```tsx
<Route
  path="/records/queue"
  element={
    <ProtectedRoute allowedRoles={['records']}>
      <RecordsQueuePage />
    </ProtectedRoute>
  }
/>
<Route
  path="/records/requests/:id"
  element={
    <ProtectedRoute allowedRoles={['records']}>
      <RequestReviewPage />
    </ProtectedRoute>
  }
/>
```

Add the matching conditional `{user?.role === 'records' && (...)}` link
block in `role-landing.page.tsx`, mirroring the existing doctor/patient
blocks exactly (same `mt-4` link styling).

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Run the full web suite + `tsc -b --noEmit`, confirm no regression.**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/features/dashboard/role-landing.page.tsx apps/web/src/features/dashboard/__tests__/role-landing.page.test.tsx
git commit -m "feat: wire records routes and landing link"
```
