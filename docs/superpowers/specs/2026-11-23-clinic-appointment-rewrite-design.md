# Clinic Appointment Book — Rewrite Design

## Intent

This project supersedes `docs/superpowers/specs/2026-11-13-clinic-scheduling-design.md`
and the plans built from it. The product direction changed: instead of the
24 `ui/*.png` mockups (multi-location/rooms, deposit payments, OTP + 2-step
staff login, kiosk check-in, waitlists), the team is now building from a
different, simpler design — the Claude Artifact canvas "Clinic Appointment
Book – Wireframes" (35 screens across 7 sections: auth, patient, doctor,
records, admin, email, mobile). That canvas is the new source of truth for
every screen.

Because the auth model, roles, and core booking flow are fundamentally
different between the old and new designs (no OTP, no locations/rooms, a
`records` role approves every booking, doctors self-manage availability),
porting the existing NestJS/Prisma `apps/api` and React `apps/web` would mean
deleting as much code as it reuses. The team decided to rewrite both apps
from scratch, targeting a new stack: **Sinatra (Ruby) + MySQL** for the API,
**React + Vite** for the SPA — replacing NestJS and the current `apps/web`
in place, inside the existing monorepo.

The 35 screens themselves are extracted field-by-field into
`docs/superpowers/specs/2026-11-23-clinic-appointment-screen-specs.md`
(fields, buttons, table columns, status enums per screen) so the design
lives in this repo rather than only behind the live canvas link.

## Goals

- Every one of the 35 canvas screens (minus the empty stray artboard) is a
  working, responsive page or flow, built against a real API — not a
  mockup.
- One username + password login for every role, routed to that role's
  dashboard. Self-registration creates a **patient** account only; Doctor,
  Records, and Admin accounts are Admin-created with a forced password
  change on first login.
- A patient can pick a department → doctor → an available day → a time
  slot, submit a request, and track it (pending/approved/declined/
  cancelled/completed/no-show) until resolution.
- A doctor manages their own available days (calendar + weekly quick-set +
  session settings), works their appointment list, and writes SOAP-structured
  clinical notes that only doctors can ever read.
- A **records** role is the approval gate for every booking request: approve,
  approve-a-different-slot, or decline-with-reason, each triggering the
  matching email(s).
- An **admin** role registers staff, manages users (deactivate/reset
  password/unlock), configures departments and clinic-wide booking rules and
  email toggles, and can read the audit log.
- Doctors and patients can connect Google/Outlook/Apple calendars (read
  busy-time, push approved appointments, optional privacy mode hiding
  patient details) and get a private iCal subscribe link.
- Every screen group (auth/patient/doctor/records/admin) works at both
  desktop and phone width from the **same** route and component — the
  `M*` canvas artboards are phone-width mockups of the same screens, not a
  separate app.

## Non-goals (this phase)

- Payments/deposits, physical rooms, multiple clinic locations, waitlists,
  and a lobby kiosk — all present in the *old* design, absent from the new
  canvas. Not in scope now; revisit only if asked.
- Native mobile apps. Responsive web only.
- OAuth implementation detail for Google/Outlook/Apple calendar connect is
  stubbed behind a clean interface (see "What's left to the builder") —
  getting real OAuth app credentials from each provider is outside this
  design.
- Telehealth/video visits.
- A general EMR. Clinical notes are the SOAP structure the wireframes show,
  not a full charting system.
- A real ICD-10 terminology service. The diagnosis search in Clinical Notes
  uses a small curated static list (builder's call, see below).
- Real SMS delivery. `sms_reminder` / `sms_reminder_opt_in` are stored as
  user preference, but no SMS provider is integrated this phase — the
  checkbox persists and does nothing yet. Wiring a provider (e.g. Twilio) is
  a separate, later piece of work.
- External calendar busy-time actually constraining patient-facing booking
  slots. This phase's calendar sync is one-directional and advisory: it
  reads/shows the doctor's own connected-calendar status and pushes
  approved appointments out, but a patient's bookable slots are computed
  only from `doctor_availability_days` + existing appointments, never from
  an external calendar's busy blocks. (Revisit once real OAuth exists —
  doing real busy-time enforcement against a stubbed OAuth connection isn't
  meaningful work yet.)

## Anti-goals (would be a failure even if "working")

- A patient or doctor double-booking a slot that's already taken, or a
  doctor closing a day that already holds an approved appointment, without
  Records rescheduling it first.
- Records or Admin ever reading clinical note content — doctor-only, with
  every note view/edit audit-logged.
- A declined or auto-expired request that doesn't free its slot.
- A signed clinical note being silently editable — later changes must be
  addenda, dated and separate from the original.
- A deactivated staff or patient account that can still log in, or whose
  history disappears from the audit trail (no hard deletes, anywhere).

## Constraints

- Single clinic deployment — no multi-tenant fields.
- MySQL, accessed via Sequel (ORM + migrations) from the Sinatra side.
- JWT access + refresh tokens for auth; bcrypt for password hashing.
- No hard deletion anywhere — "deactivate" is a status flip that keeps the
  row and its history (matches the wireframes' own "Deactivate" vs
  "View activity" distinction, and the audit log's need for stable targets).
- Fixed 20-minute default appointment slot length is a per-doctor session
  setting, not hardcoded (wireframe shows a slot-length select).

## Approaches considered

1. **Incremental port** — keep `apps/api`'s NestJS/Prisma code and
   `apps/web`'s React components, adapting them screen-by-screen to the new
   canvas. Rejected: the auth model, role set, and booking flow changed
   enough that most existing auth/RBAC code (OTP, 2-step, location picker)
   has no equivalent in the new design, and would just be deleted. Keeping
   the shell would save little and risk leftover assumptions leaking into
   the new flow.
2. **Fresh rewrite in the new stack** (chosen) — new Sequel/MySQL schema and
   new Sinatra API shaped directly around the 35 new screens; new React +
   Vite SPA built the same way. No code carried over from the NestJS app;
   the monorepo layout (`apps/api`, `apps/web`) stays, just with new
   contents. This is what the team picked in conversation, for the reasons
   above.

## Tech stack (the "how," decided across this conversation)

**Backend —** modular `Sinatra::Base` apps by domain (auth, patients,
doctors, appointments, clinical-notes, calendar-sync, records, admin),
mounted under `/api/v1`. Sequel for the ORM and migrations against MySQL.
Username + password auth, bcrypt, JWT access + refresh tokens. RSpec +
Rack::Test for tests. Outbound email via the `mail` gem — logged to console
in dev, SMTP-configured in prod — matching the wireframes' "send test email"
/ template-toggle settings screen.

**Frontend —** TypeScript, React Router, TanStack Query for data-fetching,
React Hook Form (most screens are form-heavy), Tailwind for styling, Vitest
+ Testing Library for tests (matches this repo's existing frontend test
convention).

## Data model

Status/role enums are shared across tables:

- `users.role`: `patient` | `doctor` | `records` | `admin`
- `users.status`: `active` | `invited` | `locked` | `deactivated`
- `appointments.status`: `pending` | `approved` | `declined` | `cancelled` |
  `completed` | `no_show`
- `appointments.visit_type`: `new_consultation` | `follow_up` |
  `review_results`
- `clinical_notes.status`: `draft` | `signed`
- `calendar_connections.provider`: `google` | `outlook` | `apple`

Tables (fields are illustrative, not final column types — see "What's left
to the builder"):

- **users** — role, username (unique), password_digest, email, phone,
  first_name, last_name, date_of_birth, gender, status, must_change_password,
  failed_login_count, locked_at, deactivated_at, timestamps.
- **doctor_profiles** (1:1 with a `doctor` user) — department_id, specialty
  title, medical_licence_no, consulting_room.
- **notification_preferences** (1:1 per user) — email_on_decision,
  email_reminder_24h, sms_reminder.
- **departments** — name.
- **doctor_availability_days** — doctor_id, date, is_available. One row per
  date a doctor has explicitly set; "locked" (can't be turned off) is
  derived at read time from whether an approved appointment exists that day,
  not stored. The wireframes' "quick set: repeat weekly" button is a
  write-time convenience that bulk-inserts/updates these rows for the
  patient-visible booking window — it is not a stored recurring rule.
- **doctor_session_settings** (1:1 per doctor) — start_time, end_time,
  slot_length_minutes, max_patients_per_day, break_start, break_end.
- **appointments** — patient_id, doctor_id, department_id, date, time,
  duration_minutes, visit_type, reason, status, submitted_at, decided_at,
  decided_by_user_id, decline_reason_code, decline_message, internal_note,
  reschedule_of_id (self-reference, used for both Records' "approve a
  different slot" and a doctor's "book follow-up" from clinical notes),
  sms_reminder_opt_in.
- **clinical_notes** (1:1 per appointment) — patient_id, doctor_id, status,
  chief_complaint, history_of_presenting_complaint, bp, pulse, temp, spo2,
  weight, examination_findings, diagnosis_primary, diagnosis_differential,
  clinical_impression, lab_requests, referral, advice, signed_at,
  signed_by_user_id.
- **prescriptions** — clinical_note_id, drug_name, dose, frequency,
  duration, position.
- **note_addenda** — clinical_note_id, text, created_by_user_id,
  created_at.
- **note_attachments** — clinical_note_id, file_name, storage_path,
  uploaded_at (uploads disabled once the note is signed).
- **calendar_connections** — user_id, provider, status, account_email,
  auto_add_approved, two_way_sync (doctor only), hide_patient_details
  (doctor only), reminder_enabled, reminder_offset_minutes, sync_on_change,
  ical_token, last_synced_at.
- **clinic_settings** — single row: earliest_booking_offset, max_
  booking_window_days, cancel_window_hours, pending_auto_expire_hours,
  closed_dates (JSON), sender_name, sender_email.
- **email_toggles** — event_key (`approved_patient`, `approved_doctor`,
  `declined_patient`, `request_received_patient`, `reminder_24h`,
  `new_staff_account`), enabled, template_subject, template_body.
- **password_reset_tokens** — user_id, token, expires_at, used_at (the
  emailed "forgot password" link; the separate in-app forced-change-on-
  first-login flow uses `users.must_change_password`, no token needed since
  the user is already authenticated with their temp password).
- **audit_logs** — actor_user_id, actor_role, action, target_type,
  target_id, metadata (JSON), created_at. Clinical note reads/writes are
  logged here too, per the wireframes' explicit "every view/edit is
  audit-logged" note.
- **refresh_tokens** — user_id, token_hash, expires_at, revoked_at,
  created_at. Needed so a deactivated/locked account's outstanding refresh
  token can be revoked immediately rather than staying valid until natural
  expiry — a stateless-only JWT refresh can't satisfy the anti-goal that a
  deactivated account can't keep working. Access tokens stay short-lived and
  stateless; only refresh tokens are tracked server-side.

## API surface (`/api/v1`, JSON)

**Auth** — `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`,
`POST /auth/register` (patient only), `GET /auth/username-availability`,
`POST /auth/password/forgot`, `POST /auth/password/reset`,
`POST /auth/password/change`.

**Patient self-service** — `GET/PATCH /me`, `GET/PATCH
/me/notification-preferences`, `GET /dashboard/patient`, `GET /departments`,
`GET /doctors?department_id=`, `GET /doctors/:id/availability?month=`,
`GET /doctors/:id/slots?date=`, `POST /appointments`,
`GET /appointments` (mine; filters: status/search/date range),
`GET /appointments/:id`, `POST /appointments/:id/cancel`.

**Doctor** — `GET /dashboard/doctor`, `GET/PUT /doctor/availability`,
`GET/PUT /doctor/session-settings`, `GET /doctor/appointments` (filters),
`PATCH /appointments/:id` (mark completed/no-show, visit notes),
`GET/PUT /clinical-notes/:appointment_id`, `POST
/clinical-notes/:id/sign`, `POST /clinical-notes/:id/addenda`, `POST
/clinical-notes/:id/attachments`, `GET
/clinical-notes/:id/patient-history`.

**Clinical note read scope (flagging for sign-off):** "doctor-only" in the
anti-goals means Records/Admin never see note content — it does not by
itself say whether Doctor A can read Doctor B's notes on the same patient.
The wireframe's own "previous visits timeline" sidebar on ClinicalNotes
implies a doctor can see a patient's history across visits, so this design
assumes **continuity-of-care**: any active doctor can open any patient's
past clinical notes (still role-gated to `doctor`, still audit-logged per
view, regardless of who wrote it). If you want notes restricted to only the
doctor who wrote them, say so — it's a one-line change to the
authorization check, but it changes what `GET /clinical-notes/:id/patient-
history` is allowed to return.

**Calendar sync** (shared, scoped to the current user) — `GET
/calendar-connections`, `POST /calendar-connections/:provider/connect`,
`DELETE /calendar-connections/:provider`, `PATCH
/calendar-connections/:provider`, `GET/POST
/calendar-connections/ical-link`, `GET /calendar/ics`, `POST
/calendar/sync-now`.

**Records** — `GET /records/queue` (tabs/filters), `GET
/records/requests/:id`, `POST /records/requests/:id/approve`, `POST
/records/requests/:id/approve-alternate`, `POST
/records/requests/:id/decline`, `POST /records/requests/:id/undo`.

**Admin** — `GET /admin/dashboard`, `GET/POST /admin/users`, `PATCH
/admin/users/:id`, `POST /admin/users/:id/reset-password`, `POST
/admin/users/:id/deactivate`, `POST /admin/users/:id/resend-invite`, `POST
/admin/users/:id/unlock`, `GET /admin/users/:id/activity`, `GET/POST/PATCH
/admin/departments`, `GET/PUT /admin/settings/booking-rules`, `GET/PUT
/admin/settings/email`, `POST /admin/settings/email/test`, `GET
/admin/audit-log`.

**Shared** — `GET /notifications` (bell dropdown, all roles).

## Screens → routes

One React route per canvas screen (desktop and phone width share the route;
layout reflows via Tailwind breakpoints — there is no parallel `/m/...`
route tree for the `M*` artboards):

| Route | Screen(s) |
|---|---|
| `/login` | Main, MLogin |
| `/register` | Register |
| `/forgot-password`, `/reset-password/:token` | ForgotPassword |
| `/` (role-routed) | PatientDashboard / DoctorDashboard / AdminDashboard / RecordsQueue |
| `/book` | BookAppointment, MBookDay, MBookTime |
| `/appointments` | MyAppointments, MMyAppts |
| `/profile` | Profile |
| `/calendar-sync` | PatientCalendarSync, DoctorCalendarSync, MPatientCalendar, MDoctorCalendar |
| `/doctor/availability` | DoctorAvailability, MDoctorAvailability |
| `/doctor/appointments`, `/doctor/appointments/:id` | DoctorAppointments, MDoctorAppt |
| `/notes/:appointmentId` | ClinicalNotes, MClinicalNotes |
| `/records/queue`, `/records/requests/:id` | RecordsQueue, RequestReview |
| `/admin/users` | StaffUsers, MAdminUsers |
| `/admin/users/new` | CreateStaff, MAdminCreate |
| `/admin/settings` | Settings |
| *(server-rendered, not SPA routes)* | EmailPatient, EmailDoctor, EmailRejected — these are email templates, sent by the mailer, not pages. |

## What's left to the builder

- Exact Sequel migration column types/indexes, and migration ordering.
- OAuth app registration and token-exchange detail for Google/Outlook/Apple
  calendar connect — build the `calendar_connections` interface so a stub
  ("connected" with a fake account email) can stand in locally until real
  credentials exist. No busy-time caching/sync job is needed this phase
  (see calendar sync non-goal above).
- The diagnosis search in Clinical Notes: ship a small curated static list
  of common diagnoses rather than integrating a real ICD-10 service.
- Exact wording of email templates and the 24h-reminder job's scheduling
  mechanism (a simple cron-style rake task is sufficient at this scale).
- Pagination style (offset vs cursor) for queues/lists — offset is fine
  given expected volumes at one clinic.
- Component-level breakdown on the frontend and exact Tailwind tokens/design
  system — no design system was named for this rewrite, so match the
  canvas's look where it's visible, otherwise use sensible defaults.
- Seed data for local dev (departments, a handful of doctors, demo
  appointments).
- CI wiring for the new RSpec and Vitest suites (the repo doesn't have CI
  configured yet — out of scope for this doc unless asked).
