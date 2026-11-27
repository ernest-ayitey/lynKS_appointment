# Doctor Appointments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a doctor their own appointment list (search + date-range
filtered), a detail panel to review one appointment, and the ability to
mark it completed or no-show with a free-text visit note — the
`DoctorAppointments` screen end-to-end.

**Architecture:** Extends the existing `AppointmentRoutes` class
(`apps/api/app/routes/appointments.rb`) with two new routes rather than a
new route class — this file already owns every `/appointments*` path and
every shared serializer/filter helper this work needs. One new frontend
page, `DoctorAppointmentsPage`, following the exact plain-fetch
conventions `MyAppointmentsPage`/`RecordsQueuePage` already established.

**Tech Stack:** Same as every prior plan — Sinatra/Sequel/MySQL backend,
React/Vite/TypeScript frontend, RSpec + Rack::Test, Vitest + Testing
Library.

**Spec:** `docs/superpowers/specs/2026-11-23-clinic-appointment-rewrite-design.md`
(Doctor API surface, `appointments` data model) and
`docs/superpowers/specs/2026-11-23-clinic-appointment-screen-specs.md`
§3 `DoctorAppointments`.

**Builds on:** the merged Backend Foundation & Auth, Frontend Foundation
& Auth UI, Departments/Doctors/Availability, Patient Booking & My
Appointments, and Records Approval plans.

**Relationship to the roadmap item this plan is half of:** the original
roadmap step "Doctor Appointments & Clinical Notes" is split into two
plans — this one (the appointments list/detail/status-transition half)
and a separate, later "Clinical Notes" plan (SOAP notes, prescriptions,
signing, addenda, attachments, diagnosis search). They're independent
subsystems: Clinical Notes needs an `appointment_id` to exist, not any
UI this plan builds. `DoctorDashboard` (stat cards, "Today's schedule",
"Mark arrived") is out of scope for both — same treatment
`PatientDashboard` got in the Patient Booking plan: a landing-page link
is enough, the full dashboard is a later, separate concern nobody has
asked for yet.

## Global Constraints

- **The shared `/appointments/:id` path's `before` filter changes from
  role-gated to `authenticate!`-only.** Sinatra's `before 'path'` filters
  match on path alone, regardless of HTTP verb — so the existing filter
  (`authenticate!; require_role!('patient')`, `appointments.rb:43`) would
  incorrectly reject this plan's new `PATCH /appointments/:id` from a
  doctor, since that filter fires for ANY request whose path matches,
  GET or PATCH alike. Fix: change that one filter to `before('/appointments/:id') { authenticate! }`
  and move `require_role!('patient')` inside the existing `get
  '/appointments/:id'` handler (first line, before its body), and
  `require_role!('doctor')` inside this plan's new `patch
  '/appointments/:id'` handler. The other two filters
  (`/appointments`, `/appointments/:id/cancel`) are untouched — they're
  distinct literal paths, each used by exactly one HTTP verb today.
- **`GET /doctor/appointments` lists only `approved`/`completed`/`no_show`
  appointments** — the set a doctor actually needs to track, not raw
  booking requests they have no say over. `pending` appointments are
  Records' queue, not the doctor's list; `declined`/`cancelled` never
  happened from the doctor's perspective. No status tabs on this screen
  (unlike `RecordsQueue`) — a flat list, search + date-range only.
- **`visit_notes` is a new column, not a reuse of `internal_note` or the
  future Clinical Notes record.** The screen spec's detail-panel
  "Visit notes (textarea)" is a doctor's own quick free-text note,
  separate from `internal_note` (Records-staff-only, already exists) and
  separate from the full SOAP-structured clinical note the next plan
  builds. Add it as a new nullable `String` column on `appointments` via
  a new migration — do not repurpose an existing field.
- **`PATCH /appointments/:id` only accepts the two transitions the
  screen offers: `approved` → `completed` or `approved` → `no_show`.**
  Any other current status (pending/declined/cancelled/already
  completed/already no_show) is rejected with 422 — this endpoint is not
  a general status-editor. Reuses the existing `VALIDATION_FAILED_MESSAGE`
  envelope convention.
- **Day view and Export (the screen's other two view-toggle options) are
  out of scope.** The spec marks "List" as the active/default view and
  says nothing about Day's layout or Export's format; building either
  without that information would be guessing. List ships; Day/Export are
  either omitted entirely or a disabled/placeholder control,
  implementer's call — matching the precedent set for `RecordsQueue`'s
  four placeholder nav items in the prior plan.
- **The appointment serializer doctors see is its own shape, not a reuse
  of the patient-facing `appointment_json`.** A doctor needs `patient`
  details (name, phone, sex, age) and `approved_by` (the Records user who
  approved it) that the patient-facing serializer correctly never
  exposes to anyone else, and doesn't need `decline_reason_code`/
  `decline_message` (nothing in this doctor list is ever declined). Add
  a small `doctor_appointment_json(appointment)` helper in
  `AppointmentRoutes`, not a flag on the existing one.

## Review Focus

- A doctor calling `PATCH /appointments/:id` on another doctor's
  appointment (ownership bypass) — must 404, identically to how a
  patient calling `GET /appointments/:id` on someone else's appointment
  already 404s rather than 403s, so existence can't be inferred either
  way.
- Marking an appointment `no_show` or `completed` a second time, or
  marking a `pending`/`declined`/`cancelled` one directly — must 422,
  never silently overwrite or skip the state machine.
- A patient or `records` role hitting `GET /doctor/appointments` or
  `PATCH /appointments/:id` directly — must 403.
- A date-range filter with no matching appointments, or a doctor with
  zero appointments at all — list renders an empty state, not an error
  or a crash.
- `visit_notes` being optional on the PATCH payload — marking
  completed/no-show with no note text must still succeed (the spec
  shows the textarea as an open field, not a required one).

---

### Task 1: `visit_notes` column

**Files:**
- Create: `apps/api/db/migrate/010_add_visit_notes_to_appointments.rb`
- Test: `apps/api/spec/models/appointment_spec.rb`

**Interfaces:**
- Produces: `appointments.visit_notes` (nullable `String`, i.e.
  `VARCHAR(255)` — matching this table's existing convention for every
  other free-text column: `decline_message`, `internal_note`), consumed
  by Task 2's PATCH route and Task 2's `doctor_appointment_json`.

- [ ] **Step 1: Write the migration**

```ruby
Sequel.migration do
  change do
    alter_table(:appointments) do
      add_column :visit_notes, String
    end
  end
end
```

- [ ] **Step 2: Run it** (`bundle exec rake db:migrate` or this repo's
  equivalent task) against both the dev and test databases, and confirm
  `bundle exec rspec` still passes in full (a new nullable column should
  not break any existing fixture).

- [ ] **Step 3: Write a failing model test**

```ruby
it 'accepts a visit_notes value up to the column length and rejects over it' do
  appointment = build_appointment(visit_notes: 'a' * 256)
  expect(appointment).not_to be_valid

  appointment.visit_notes = 'a' * 255
  expect(appointment).to be_valid

  appointment.visit_notes = nil
  expect(appointment).to be_valid
end
```

- [ ] **Step 4: Run it, confirm it fails** (no validation exists yet).

- [ ] **Step 5: Add the validation in `apps/api/app/models/appointment.rb`**,
  inside the existing `validate` method (added by the Records Approval
  plan — you'll see `validates_includes` and `validates_max_length`
  calls there already): `validates_max_length 255, :visit_notes,
  allow_nil: true`, matching the exact calling convention already used
  for `decline_message`/`internal_note`.

- [ ] **Step 6: Run it, confirm it passes**, then run the full suite.

- [ ] **Step 7: Commit**

```bash
git add apps/api/db/migrate/010_add_visit_notes_to_appointments.rb apps/api/app/models/appointment.rb apps/api/spec/models/appointment_spec.rb
git commit -m "feat: add visit_notes column to appointments"
```

---

### Task 2: `GET /doctor/appointments` and `PATCH /appointments/:id`

**Files:**
- Modify: `apps/api/app/routes/appointments.rb`
- Test: `apps/api/spec/requests/appointments_spec.rb`

**Interfaces:**
- Consumes: `appointments.visit_notes` from Task 1.
- Produces: `doctor_appointment_json(appointment)` — `{ id, ref, patient:
  {id, first_name, last_name, phone, sex: <gender>, age: <computed from
  date_of_birth, or null>}, date, time, duration_minutes, visit_type,
  reason, status, approved_by: {id, first_name, last_name} | null,
  visit_notes }`. `ref` reuses the same `format('REQ-%05d',
  appointment.id)` convention the Records plan established (duplicate
  the one-liner here rather than importing it from `RecordsRoutes` — the
  established house convention in this codebase is small duplicated
  helpers across route files, not cross-class imports).
- Produces: Task 4's frontend wrapper consumes this exact shape.

- [ ] **Step 1: Write the failing tests**

```ruby
describe 'GET /doctor/appointments' do
  it "lists only the doctor's own approved/completed/no_show appointments, newest-relevant first" do
    # pending and declined/cancelled appointments for this same doctor
    # must NOT appear.
  end

  it 'filters by search (patient name) and date range' do
  end

  it 'rejects a patient or records role with 403' do
  end
end

describe 'PATCH /appointments/:id (doctor)' do
  it 'marks an approved appointment completed, with an optional visit_notes' do
  end

  it 'marks an approved appointment no_show' do
  end

  it 'rejects a status other than completed/no_show with 422' do
  end

  it 'rejects marking a non-approved appointment (pending/declined/cancelled/already-decided) with 422' do
  end

  it "404s for another doctor's appointment (ownership-scoped, same as a nonexistent id)" do
  end

  it 'rejects a patient or records role with 403' do
  end
end
```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Change the shared filter and add the new routes**

In `apps/api/app/routes/appointments.rb`, change line 43's filter:

```ruby
# Was: before('/appointments/:id') { authenticate!; require_role!('patient') }
before('/appointments/:id') { authenticate! }
```

Add `require_role!('patient')` as the first line inside the existing
`get '/appointments/:id' do` handler body (so its behavior is otherwise
unchanged — same 404-for-not-mine semantics as before, just with the
role check moved from the filter into the handler).

Add a new path-scoped filter and route for the list:

```ruby
before('/doctor/appointments') { authenticate!; require_role!('doctor') }

get '/doctor/appointments' do
  dataset = Appointment.where(doctor_id: current_user.id, status: %w[approved completed no_show])
  dataset = filter_by_patient_name(dataset, params['search'])
  dataset = filter_by_date_range(dataset, params['from'], params['to'])

  appointments = dataset.order(:date, :time).all
  json(appointments: appointments.map { |a| doctor_appointment_json(a) }, total: appointments.size)
end
```

Reuse `filter_by_date_range` exactly as it already exists in this file.
Do **not** reuse `filter_by_search`: its current implementation matches
against *doctor*/*department* name (`appointments.rb`'s existing
`filter_by_search`, built for the patient-facing `GET /appointments`,
where the patient already knows who they booked and is searching for a
doctor). This screen's search is the opposite direction — a doctor
searching their own list by *patient* name — so add a small new private
helper, `filter_by_patient_name(dataset, raw_search)`, matching
`filter_by_search`'s exact shape (case-insensitive substring via
`Sequel.ilike` against `first_name`/`last_name`, blank-is-no-filter) but
looking up `patient_id` instead of `doctor_id`.

Add the PATCH route with its own filter. **No existing body-parsing
`before` block covers `/appointments/:id`** — the file's only body-parser
is scoped to the literal path `/appointments` (the booking route), and
per this same file's own established rule, a `before 'path'` filter
matches that exact path string only, never as a prefix, so it does not
also run for `/appointments/:id`. Add a new one, mirroring the existing
one exactly:

```ruby
before('/appointments/:id') do
  if request.body
    request.body.rewind
    parsed = JSON.parse(request.body.read)
    @payload = parsed.is_a?(Hash) ? parsed : {}
  else
    @payload = {}
  end
rescue JSON::ParserError
  @payload = {}
end

PATCHABLE_STATUSES = %w[completed no_show].freeze

patch '/appointments/:id' do
  require_role!('doctor')
  appointment = Appointment.where(id: params['id'], doctor_id: current_user.id).first
  halt_json_error 404, NOT_FOUND_MESSAGE unless appointment

  new_status = @payload['status']
  unless new_status.is_a?(String) && PATCHABLE_STATUSES.include?(new_status)
    halt_json_error 422, VALIDATION_FAILED_MESSAGE, status: "Status must be one of: #{PATCHABLE_STATUSES.join(', ')}"
  end
  halt_json_error 422, VALIDATION_FAILED_MESSAGE, status: 'Only an approved appointment can be marked completed or no-show' unless appointment.status == 'approved'

  appointment.update(status: new_status, visit_notes: @payload['visit_notes'])
  json(doctor_appointment_json(appointment))
end
```

(No concurrency guard is needed here — unlike booking/approving, marking
an already-approved appointment completed/no-show never contends for a
slot; two doctors can't both own the same appointment, and the
ownership-scoped lookup already makes this safe. Confirm this reasoning
holds before implementing, and flag it in your report if you see a race
this plan missed.)

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Run the full API suite, confirm no regression** — pay
  particular attention to the existing `GET /appointments/:id` tests,
  since its `require_role!` moved from the filter into the handler.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routes/appointments.rb apps/api/spec/requests/appointments_spec.rb
git commit -m "feat: GET /doctor/appointments and PATCH /appointments/:id"
```

---

### Task 3: `doctor-appointments.api.ts` + `DoctorAppointmentsPage`

**Files:**
- Create: `apps/web/src/features/doctor/doctor-appointments.api.ts`
- Create: `apps/web/src/features/doctor/doctor-appointments.page.tsx`
- Test: `apps/web/src/features/doctor/__tests__/doctor-appointments.api.test.ts`
- Test: `apps/web/src/features/doctor/__tests__/doctor-appointments.page.test.tsx`

**Interfaces:**
- Consumes: `GET /doctor/appointments`'s `{ appointments, total }` shape
  and `PATCH /appointments/:id`'s response, both from Task 2 — read the
  live `doctor_appointment_json` in `apps/api/app/routes/appointments.rb`
  directly to confirm the exact field names rather than relying on this
  plan's prose.

- [ ] **Step 1: Write `doctor-appointments.api.ts`**

```ts
export interface DoctorAppointmentPatient {
  id: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  sex: string | null;
  age: number | null;
}

export interface DoctorAppointment {
  id: number;
  ref: string;
  patient: DoctorAppointmentPatient;
  date: string;
  time: string;
  duration_minutes: number;
  visit_type: string;
  reason: string;
  status: string;
  approved_by: { id: number; first_name: string; last_name: string } | null;
  visit_notes: string | null;
}

export interface DoctorAppointmentFilters {
  search?: string;
  from?: string;
  to?: string;
}

export function listDoctorAppointments(
  authedFetch: AuthedFetch,
  filters?: DoctorAppointmentFilters,
): Promise<{ appointments: DoctorAppointment[]; total: number }> {
  // Mirrors appointments.api.ts's listAppointments / records.api.ts's
  // getQueue: URLSearchParams built from whichever filters are present.
}

export function markAppointmentOutcome(
  authedFetch: AuthedFetch,
  id: number,
  payload: { status: 'completed' | 'no_show'; visit_notes?: string },
): Promise<DoctorAppointment> {
  return authedFetch<DoctorAppointment>(`/appointments/${id}`, { method: 'PATCH', body: payload });
}
```

- [ ] **Step 2: Write the failing API-wrapper test**, mirroring
  `appointments.api.test.ts`'s/`records.api.test.ts`'s style.

- [ ] **Step 3: Run it, confirm it fails, implement, confirm it passes.**

- [ ] **Step 4: Write the failing page tests**

Covering: list renders on mount; a search input re-fetches with
`search`; a date-range preset (This week/Today/Next 30 days — compute
the `from`/`to` pair for each preset client-side, matching
`MyAppointmentsPage`'s own `isoDate` helper convention) re-fetches with
the matching `from`/`to`; clicking a row opens the detail panel showing
patient name/sex/age/phone, When/Type/Reason/Approved-by, and a Visit
notes textarea; "Mark completed" and "No-show" buttons call
`markAppointmentOutcome` with the right status and then refetch (matching
`MyAppointmentsPage#handleCancel`'s refetch-after-action pattern); a 422
from the PATCH surfaces as a banner, not silently swallowed.

- [ ] **Step 5: Run it, confirm it fails.**

- [ ] **Step 6: Implement `DoctorAppointmentsPage`**

Model this directly on `RecordsQueuePage`: plain
`useState`/`useEffect`/`useCallback`, `listBanner`/`actionBanner`
pattern, `role="alert"` banners. Table columns per screen-specs.md:95
(Date, Time, Patient, Reason, Status). Detail side panel opens on row
click (a simple conditional render keyed by a `selectedId` state is
sufficient — no routing change needed, this is a panel within the page,
not a separate route). View-toggle buttons for Day/List/Export may be
rendered as disabled/placeholder or omitted entirely, per this plan's
Global Constraints — only List needs to actually work.

- [ ] **Step 7: Run it, confirm it passes.**

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/doctor/doctor-appointments.api.ts apps/web/src/features/doctor/doctor-appointments.page.tsx apps/web/src/features/doctor/__tests__
git commit -m "feat: doctor-appointments.api.ts and DoctorAppointmentsPage"
```

---

### Task 4: Wire the route and the landing link

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/dashboard/role-landing.page.tsx`
- Test: `apps/web/src/features/dashboard/__tests__/role-landing.page.test.tsx`

**Interfaces:**
- Consumes: `DoctorAppointmentsPage` (Task 3), `ProtectedRoute`'s
  existing `allowedRoles` prop.

- [ ] **Step 1: Write the failing landing-page test** — a `doctor`-role
  user sees a second link ("View Appointments" or similar) to
  `/doctor/appointments`, alongside the existing "Manage Availability"
  link; a `patient`/`records` user does not see it.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Add the route in `App.tsx`**

```tsx
<Route
  path="/doctor/appointments"
  element={
    <ProtectedRoute allowedRoles={['doctor']}>
      <DoctorAppointmentsPage />
    </ProtectedRoute>
  }
/>
```

Add the second link inside the existing `{user?.role === 'doctor' &&
(...)}` block in `role-landing.page.tsx`, alongside the existing
"Manage Availability" link, same styling.

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Run the full web suite + `tsc -b --noEmit`, confirm no regression.**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/features/dashboard/role-landing.page.tsx apps/web/src/features/dashboard/__tests__/role-landing.page.test.tsx
git commit -m "feat: wire doctor appointments route and landing link"
```
