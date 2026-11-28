# Doctor Dashboard — Design

## Intent

The last roadmap item left `DoctorDashboard` as "a landing-page link is enough,
the full dashboard is a later, separate concern nobody has asked for yet."
That later moment is now: the user wants the full wireframe
(`DoctorDashboard.dc.html` in the "Clinic Appointment Book" canvas) built,
not a trimmed version — stat cards, today's schedule with a working "Mark
arrived" action, next-available-days tags, and a recent-emails feed.

Unlike the App Shell & Wireframe Parity plan (pure restyle, zero backend
changes), this one is genuinely new feature work: three of the wireframe's
four pieces need new backend surface that doesn't exist today.

## Goals

1. **A new `DoctorDashboardPage`** at `/doctor` (or wherever routing lands
   it — see Non-goals on the route path), wired into `AppShell`'s existing
   `doctor-dashboard` nav key (currently inert) and set as the landing
   destination the "Dashboard" sidebar item finally points to.
2. **Stat cards**: Patients today, This week, Pending (with Records),
   Available days this month — one new backend aggregate endpoint
   (see Approaches) rather than four separate round trips.
   **Builder-check findings, settled:**
   - "Patients today"/"This week" count **distinct patients**
     (`COUNT(DISTINCT patient_id)`), matching the card's literal label —
     a patient with two appointments the same day counts once, not twice.
   - "Available days this month" is a **raw count** of
     `DoctorAvailabilityDay` rows for the current month — it does *not*
     exclude full days (that exclusion is scoped only to the separate
     "next available days" widget, Goal 5). Keeping this a plain `COUNT`
     is what keeps the stats endpoint a single cheap query pass, per
     Approach B's own rationale below — computing slot-fullness across
     up to 31 days just for this card would defeat that.
3. **Today's schedule**: today's appointments for this doctor, in time
   order, each tagged Completed/Next/Approved/Open-slot exactly as the
   wireframe shows, with a working **"Mark arrived"** action on the next
   upcoming approved appointment.
   **Builder-check finding, settled:** the wireframe is a single static
   state and never depicts what an `arrived` row itself looks like (it has
   no fifth tag of its own in the markup). The wireframe's own stylesheet
   already defines three tag colors, though —`.t-pend` (amber,
   `#FFF1D6`/`#7A4B00`), `.t-ok` (green), `.t-n` (gray) — and this
   particular wireframe file only ever uses the latter two. Call: give
   `arrived` its own tag using the wireframe's own unused `.t-pend` amber
   treatment (mapped to this codebase's existing amber token, the same one
   `RecordsQueuePage`'s `pending` status already uses), labeled "Arrived".
   This is the wireframe's own design system, just applied to the one
   state its single static mock didn't happen to render.
4. **A new `arrived` appointment status**, sitting between `approved` and
   `completed`/`no_show` as an *optional* checkpoint — `approved` →
   `completed`/`no_show` directly still works exactly as it does today
   (this plan changes nothing about the already-shipped Doctor
   Appointments page's tested behavior); `approved` → `arrived` →
   `completed`/`no_show` is simply another valid path. "Mark arrived" is
   exposed everywhere an approved appointment's actions are shown — both
   the new Dashboard and the existing Doctor Appointments list — for
   consistency, not just on the dashboard.
5. **Next available days with a real "full" tag**: computed from the
   doctor's existing slot data (a day with zero free slots left is
   "full"), not invented.
6. **A real "Recent emails" feed**: every `Mailer.deliver` call this app
   already makes gets attributed to the appointment/doctor it concerns and
   persisted, so the dashboard can show the doctor's own recent
   notifications (approvals affecting their patients) — not a general
   admin-wide audit log, just what's relevant to the viewing doctor.
   **Builder-check finding, settled:** `deliver_approved_emails` sends two
   emails per approval — one to the patient, one to the doctor. Only the
   doctor-addressed email gets logged/attributed (recipient's email ==
   the appointment's doctor's email), not the patient-addressed one —
   this naturally produces exactly one feed row per approved appointment,
   matching the wireframe's own two example rows for two approvals.
   Decline emails (`deliver_declined_email`, patient-only, no doctor
   recipient) are never logged — the doctor never had this request on
   their calendar in the first place, and the wireframe's own example
   copy is exclusively the "New approved appointment: …" pattern, not a
   decline pattern. The password-reset email (`auth.rb`) has no
   appointment context and is never logged either, per the original
   Approach B description.

## Non-goals

- Patient Dashboard, Profile, Admin area, Calendar Sync, Settings, Clinical
  Notes, mobile-specific screens — separate projects, per the already-agreed
  order.
- A general-purpose, admin-facing email audit log with search/filtering —
  this plan's log exists only to feed the doctor's own dashboard feed.
- Changing how `Mailer.deliver` actually sends mail (it stays the existing
  `MAIL_DELIVERY_METHOD=log` behavior) — this plan only adds *persistence*
  of what's already being sent, not a new transport.
- The exact dashboard route path (`/doctor` vs `/doctor/dashboard`) and
  whether `RoleLandingPage` keeps existing as a separate thin page or is
  replaced by this dashboard for the doctor role specifically — left to
  the plan to decide against the live `App.tsx`/`AppShell` code, same as
  every prior plan's "read the live file, don't trust prose" rule.

## Anti-goals

- Breaking any currently-passing test, especially the Doctor Appointments
  page's existing `approved → completed/no_show` 422-on-anything-else
  contract — `arrived` is additive, not a replacement for that path.
- Letting `arrived` create a slot-availability hole: an appointment marked
  `arrived` must still block that slot from being booked by someone else
  (see the `OCCUPYING_STATUSES` finding below) — a real bug this design
  doc catches before it ships, not an incidental side effect to discover
  later.
- Fabricating "recent emails" content or a "full" day computation from
  data that doesn't exist — both must be real, derived from real state.

## A backend wrinkle found during research (decided here, not re-litigated in the plan)

`apps/api/app/models/appointment.rb`'s `OCCUPYING_STATUSES = %w[pending
approved]` currently serves two different jobs at once:

1. **Slot-conflict checking** (`occupied_slot?` in `appointments.rb`) — an
   appointment in one of these statuses blocks that slot from being booked
   again.
2. **Patient cancel-eligibility** (`POST /appointments/:id/cancel`) — a
   patient can only cancel an appointment whose status is in this list.

`arrived` needs **yes** for (1) (the slot is still taken — the patient is
in the building) and **no** for (2) (you shouldn't be able to cancel a
visit you've already checked in for — that's as final as `completed` for
cancellation purposes). One constant can't serve both answers once
`arrived` exists.

**Decision:** split the constant. `OCCUPYING_STATUSES` keeps its name and
its slot-conflict job, gains `arrived`: `%w[pending approved arrived]`. A
new `CANCELLABLE_STATUSES = %w[pending approved]` (unchanged from today's
`OCCUPYING_STATUSES` value) takes over the cancel-route's check. The plan
updates both the constant and the one call site in
`POST /appointments/:id/cancel` that currently reads `OCCUPYING_STATUSES`
for this purpose.

## Constraints

- A new migration: extend `Appointment::STATUSES` to include `arrived`
  (and split `OCCUPYING_STATUSES`/`CANCELLABLE_STATUSES` per above — a
  model change, not a schema change, so no migration needed for the
  constants themselves, only if the `status` column has a DB-level CHECK
  constraint beyond the model's `validates_includes` — the plan confirms
  this against the live `009_create_appointments.rb` migration before
  assuming either way).
- A new migration for the email-log table.
- Every existing test must keep passing; the Doctor Appointments page's
  current `PATCHABLE_STATUSES = %w[completed no_show]` either gains
  `arrived` as a third value the same route accepts, or gets a sibling
  route — the plan decides which, consuming the same patterns Task 2 of
  the original Doctor Appointments plan already established.
  **Builder-check finding, settled:** today's single precondition
  (`unless appointment.status == 'approved'`, applied uniformly to every
  value in `PATCHABLE_STATUSES`) cannot simply gain `arrived` as a list
  member — once an appointment is `arrived`, that check would make
  `completed`/`no_show` unreachable, directly breaking this plan's own
  goal. The precondition must become target-status-aware: transitioning
  *to* `arrived` requires current status `approved`; transitioning *to*
  `completed`/`no_show` requires current status `approved` **or**
  `arrived`. Both the Ruby conditional and the matching frontend
  button-gating logic (on both the Dashboard and the existing Doctor
  Appointments page) need this two-case shape, not the single uniform
  check that works today.
- No change to `Mailer.deliver`'s actual delivery mechanism — only
  persistence alongside it.

## Approaches

### Dashboard stats: one aggregate endpoint vs. four filtered list calls

**A — reuse `GET /doctor/appointments` four times** with different
filters (today/this-week/pending/none) and compute counts client-side from
`total`. Zero new backend code, but four round trips on every dashboard
load, and "pending" isn't even in that endpoint's allowed status set today
(it's deliberately excluded — "Records' queue, not the doctor's list").

**B — one new endpoint**, e.g. `GET /doctor/dashboard/stats`, computing
all four counts server-side in one query pass and returning
`{patients_today, this_week, pending, available_days_this_month}`.

**Decision: B.** One round trip, and it's the only way to get the
`pending` count at all without loosening `GET /doctor/appointments`'s
deliberate status restriction (which this plan does not want to touch —
that restriction protects a different, already-reviewed design decision).

### Email log: wrap `Mailer.deliver` vs. log at each of the 3 call sites

**A — each of the 3 existing `Mailer.deliver` call sites** (`auth.rb`,
`records.rb` ×2) also writes its own log row with whatever appointment/
doctor context it has at hand.

**B — `Mailer.deliver` itself gains optional context parameters**
(e.g. `appointment_id:`) and persists the row in one place, so every
current and future call site that passes that context gets logged for
free, and call sites that don't concern an appointment (e.g. the password
reset email in `auth.rb`) simply don't pass it and nothing is logged for
them.

**Decision: B.** One choke point, consistent with this codebase's existing
preference for small shared helpers over duplicated logic — the three
`Mailer.deliver` call sites in `records.rb` already have `appointment` in
scope; `auth.rb`'s password-reset call does not, and reasonably logs
nothing (not every email is appointment-related, and the dashboard feed
is specifically "recent emails about your patients").

## What's Left to the Builder

- Confirming the dashboard route path and `RoleLandingPage`'s relationship
  to it against the live `App.tsx`/`AppShell` code (Non-goals).
- The exact DB-level check for whether `009_create_appointments.rb`'s
  `status` column needs a migration-level constraint change beyond the
  model layer.
- Whether `PATCHABLE_STATUSES` gains `arrived` on the existing PATCH route
  or gets its own route — whichever matches this file's existing
  conventions once read live.
- The exact query/index needs for `GET /doctor/dashboard/stats` and the
  email-log table's schema (recipient, subject, appointment_id, sent_at —
  exact column set and migration number against the live `db/migrate/`
  directory).
- "Full" day computation's exact implementation (reusing
  `GET /doctors/:id/slots` per candidate day vs. a new batch endpoint) —
  performance/complexity tradeoff left to the plan.
