# Clinic Scheduling & Provider Calendar Sync — Design

## Intent

A single specialist clinic (multiple doctors, multiple locations/branches,
multiple treatment rooms — e.g. the "Airport" and "Osu" branches already
named in the mockups) needs a web app that lets patients book appointments
with a specific doctor weeks in advance, lets front-desk staff run the daily
schedule across rooms and providers with minimal patient wait time, and keeps
each doctor's clinic calendar in sync with their personal Google/Outlook
calendar so the clinic never double-books someone who already has something
on their personal calendar, and personal calendars show clinic bookings too.

24 high-fidelity screens already exist in `ui/` covering most of this
end-to-end. This project turns those designs into a working product: filling
the real gaps in the design, then building it.

## Goals

- Patients can find a doctor/treatment, see real availability, book, pay a
  deposit, fill pre-visit forms, and manage/reschedule/cancel a visit — all
  from a phone-sized browser.
- Front desk can run a live, multi-provider, multi-room day view; book by
  phone on a patient's behalf; manage a waitlist; check patients in via a
  lobby kiosk.
- Each doctor's availability reflects their real calendar: two-way sync with
  Google Calendar and Microsoft Outlook, so an external personal event blocks
  clinic bookings and a clinic booking shows up on their personal calendar
  (free/busy only is read from the personal calendar — never event titles or
  details, per the existing mockup's own privacy framing).
- Clinic admins configure treatments, rooms, locations/hours, booking rules,
  reminders, and staff roles/permissions, matching what `6.1` and `6.2`
  already show.
- One clinic, one deployment. No multi-tenant / multi-clinic concerns.

## Non-goals (this phase)

- Multi-clinic / multi-tenant SaaS — explicitly ruled out; this is one
  clinic's system.
- Native mobile apps — responsive web only (the "(mobile)" screens are
  mobile-web layouts of the same app, not a separate app).
- Telehealth / video visits.
- Full EMR / clinical charting — the "Pre-visit form" and "Treatment plan"
  concepts already in the mockups (intake questions, multi-visit treatment
  plans like the root-canal 3-visit tracker in `3.1`) are in scope; a general
  medical records system is not.
- Integration with external practice-management or billing systems.

## Anti-goals (would be a failure even if "working")

- A booking flow that doesn't reflect the doctor's real calendar — the whole
  point of the calendar-sync feature is that "available" always means
  actually available.
- Any staff role seeing patient contact details or clinical notes they
  weren't granted — `6.1` already shows per-role toggles for this
  (Abena Kusi's front-desk role: "See patient contact details: Yes",
  "Read clinical notes: No") and that granularity must hold throughout.
- A deposit payment that can be lost or double-charged if a hold expires
  mid-payment (`2.2` shows a "Held for 9:42" countdown on the slot).

## Current state (already designed, in `ui/`)

- **Auth & identity (1.x):** patient sign-in, patient enter-code, doctor
  mobile sign-in, staff web sign-in with password + 2-step check, then a
  role/location picker for staff who have more than one (`1.6` — e.g. a
  doctor who is also clinic admin, at a specific branch today).
- **Patient booking (2.x):** choose a doctor/treatment, pick a time (with a
  held-slot countdown and "confirm and pay deposit"), booking confirmation,
  pre-visit form, day-of-visit screen.
- **Patient self-service (3.x):** my visits (incl. multi-visit treatment
  plans), manage/reschedule a visit, waitlist offer, profile and family
  members.
- **Clinic operations (4.x):** day schedule (switchable Providers / Rooms /
  Week views, live status per chair, "needs attention" and "arriving next"
  panels, calendar-sync health inline), phone booking, patient list,
  waitlist, lobby check-in kiosk (QR scan or phone-last-4).
- **Provider (5.x):** "My day" mobile view; availability & calendar sync
  (weekly hours, time off, connected calendars, conflict resolution, sync
  activity log, booking rules).
- **Admin (6.x):** users & roles with per-role permission toggles and
  per-location assignment; treatments & rooms (duration, prep/clean-up time,
  equipment needs, deposit, who can book online, which rooms/doctors can
  perform it) plus a cross-check that flags scheduling contradictions (e.g.
  a treatment needing a room the assigned doctor has no hours at).
- Clinic settings (within `6.2`'s tab bar) already includes: Treatments,
  Rooms, Locations and hours, Booking rules, Reminders.

## Gaps to design and add

1. **Clinic profile & branding** — every screen placeholders the name as
   `[CLINIC NAME]`; need a settings screen for clinic name, logo, address,
   contact info, timezone.
2. **Reports & analytics** — the schedule screen has live-only stats
   (checked in, in lobby, avg wait). Need a historical view: no-show rate,
   utilization by provider/room, revenue by treatment, booking source
   (online vs. phone vs. waitlist).
3. **Audit log viewer** — `6.1` states deactivating a user "keeps their
   booking history and audit trail," but no screen shows that trail. Add one
   (who did what, when — role changes, cancellations, reschedules, deposit
   refunds).
4. **Account recovery** — no forgot-password / account-recovery flow exists
   for staff or patients.
5. **Outlook connect flow** — `5.2` shows Google already connected and
   Outlook as a bare "Not connected / Connect" button; need the actual
   OAuth-connect screens/states (connecting, connected, token-expired /
   needs reconnecting — the last one is already referenced from `4.1` and
   `6.1` but never shown as its own state).
6. **Error / empty / loading states** — a pass across the existing screens
   (e.g., no availability in next 12 weeks, sync failure, payment failure)
   rather than new numbered screens.

Payment: `2.2`'s "Confirm and pay deposit" button means online deposit
payment is already part of the intended booking flow, not a future
add-on — it needs a real payment integration, not just a configured amount.

## Decided (my calls, stated so they can be corrected)

- **Frontend:** React + Vite + TypeScript, matching the clean card-based
  style already established in the mockups (Tailwind CSS for styling).
- **Backend:** Node.js with NestJS (TypeScript) — the module/guard structure
  fits the heavy role/permission model already designed in `6.1` far better
  than an unstructured Express app.
- **ORM/DB:** Prisma + MySQL, as requested.
- **Real-time:** Socket.IO for the live schedule panel (checked-in counts,
  "arriving next," sync-activity feed) — those numbers are shown updating
  live in `4.1` and polling would be a visibly worse version of the same
  screen.
- **Calendar sync:** Google Calendar API and Microsoft Graph API (OAuth2 per
  provider), using push notifications (Google watch channels / Graph
  subscriptions) with periodic polling as a fallback, processed through a
  BullMQ (Redis-backed) queue so a sync delay never blocks a user-facing
  request. Only free/busy is read from a connected personal calendar, never
  event details — matching the mockup's own stated privacy rule.
- **Payments:** Paystack (cards + Mobile Money, supports GHS) for deposit
  collection — fits the Ghanaian names/locations already in the mockups.
  Flag if a different processor is preferred.
- **Notifications:** SMS + email for reminders/confirmations/waitlist
  offers, behind a provider-agnostic interface so the concrete SMS vendor
  (e.g. Africa's Talking) can be swapped without touching business logic.
- **Auth:** JWT access + refresh tokens. Patients sign in passwordless via
  phone + one-time code (matches `1.1`/`1.2`); staff sign in with
  password + mandatory 2-step check (matches `1.4`/`1.5`), then pick
  role/location if they have more than one (`1.6`). Staff 2-step check is
  SMS OTP, reusing the same SMS infrastructure as the patient one-time-code
  flow rather than adding a TOTP-app dependency.
- **Data retention / deletion:** sensitive fields (contact info, clinical
  notes, pre-visit form answers) are encrypted at rest. Deleting a patient
  or staff record is a soft-delete that anonymizes personal fields but
  keeps the audit trail and appointment history intact — matching `6.1`'s
  "booking history and audit trail are kept" on deactivation. No hard
  deletion path in this phase. Revisit if a formal data-protection review
  later requires true erasure.

## Decided (previously open, now settled)

1. **Family/dependent accounts** — one login per adult account holder, with
   multiple linked patient profiles underneath it (e.g. a parent's account
   lists their children as profiles). The account holder can book, pay, and
   view forms/clinical notes for any profile linked to their account. An
   adult dependent getting their own independent login, separate from a
   family account, is a later phase if ever needed.
2. **Deposit refund policy** — full refund if cancelled before the existing
   48-hours-before cutoff (`5.2`'s "Free changes until 48 hours before").
   After that cutoff, or on a no-show, the deposit is fully forfeited (no
   partial-refund tier, to keep the payment state machine simple). A
   clinic-initiated cancellation (e.g. doctor on leave) always fully
   refunds regardless of timing.
3. **Payment processor** — Paystack, as proposed.

## What's left to the builder

- Exact Prisma schema and migration plan.
- REST/WebSocket API surface and module boundaries within NestJS.
- The visual design of the 6 new/completed screens listed above, in the
  same style as the existing 24.
- Test strategy (unit/integration/e2e) and CI setup.
- Deployment target and environment config (no preference given yet beyond
  "web app" — Docker Compose for local dev either way).
