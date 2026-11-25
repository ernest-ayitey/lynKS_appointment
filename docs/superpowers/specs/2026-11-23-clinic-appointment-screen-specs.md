# Clinic Appointment Book — Screen Specs (from the wireframe canvas)

Field-level extraction of all 35 screens from the Claude Artifact canvas
"Clinic Appointment Book – Wireframes"
(`https://claude.ai/code/artifact/3dcb54ae-73db-42f1-a317-863b548286ad`),
done so the screen content lives in this repo rather than only behind a
live canvas link. Referenced by
`2026-11-23-clinic-appointment-rewrite-design.md`.

Auth model confirmed throughout: single username+password login for every
role (routed by role after sign-in); self-registration creates a **Patient**
role only; Doctor/Records/Admin accounts are Admin-created with a temp
password forced to change on first login.

---

## 1 · Login & Registration

### Main (Login) — `auth`
- Purpose: universal sign-in, routes by role.
- Fields: Username (text), Password (password), "Keep me signed in" (checkbox).
- Buttons/links: Sign in (primary) → PatientDashboard; "Forgot password?" → ForgotPassword; "Create an account" → Register; prototype shortcuts to each role dashboard.
- States: error banner "Incorrect username or password" (lock after 5 tries — *inferred: `failedLoginCount`, lockout threshold = 5*).

### Register (Patient registration) — `auth`
- Fields, Personal details: First name, Last name, Date of birth (DD/MM/YYYY text), Gender (select: Female/Male/Prefer not to say), Email, Phone.
- Fields, Login details: Username (hint: 4–20 chars, letters/numbers/dot/underscore, live-availability-checked), Password (min 8 chars + number + symbol), Confirm password, password-strength meter.
- Checkbox: agree to terms/privacy + consent to appointment emails (required).
- Button: Create account → PatientDashboard. Link: "Sign in" → Main.
- Role is fixed to Patient, not selectable.

### ForgotPassword — `auth`
- Step 1: Username field → "Send reset link" button → success banner "If that username exists, a reset link has been sent to a***@gmail.com".
- Step 2 (opened from emailed link): New password, Confirm new password → "Save and sign in". Link expires after 30 min. Same flow reused for staff first-login (temp password → new password).

---

## 2 · Patient (User)

### PatientDashboard — `patient`
- Nav: Dashboard (on), Book appointment, My appointments, Profile.
- Header: notification bell (badge count), avatar, name/role, Log out.
- Stat cards: Upcoming (approved) count, Awaiting approval count, Past visits count.
- "Next appointment" card: doctor name/dept, date badge, time+room, reason, status tag (Approved); actions: View details, Add to calendar, Request reschedule.
- Notifications panel: list of recent events (title, description, relative time).
- "Pending requests" section: date/time/doctor/dept, submitted date, status tag (Pending approval), Cancel request button.

### BookAppointment — `patient`
- Step 1 — Department (select) + Doctor picker (cards: name, dept, available-days label; click to select).
- Step 2 — Month calendar grid; cells disabled unless doctor-available; states: Available / Selected / Fully booked / Doctor not available (legend shown); month prev/next.
- Step 3 — Time slot grid (shown only once a day is picked); taken slots disabled/struck-through.
- Summary sidebar: Doctor, Date, Time, Duration (fixed 20 min) read-outs; Reason for visit (textarea), Visit type (select: New consultation/Follow-up/Review results), "Send me an SMS reminder too" (checkbox).
- Submit button disabled until day+slot chosen; after submit shows banner "Request sent — pending approval" with "View my appointments" / "Book another".
- Status badge after submit: **Pending approval** (enum values seen across app: `pending` | `approved` | `declined` | `cancelled` | `completed` | `no-show`).

### MyAppointments — `patient`
- Tabs: All / Upcoming / Pending / Past / Declined-cancelled (counts shown).
- Filters: search (doctor/department text), date range select.
- Table columns: Ref, Date & time, Doctor, Department, Status (tag), Actions (contextual: Cancel request / Reschedule+Cancel / See reason / Book follow-up).
- Pagination: "Showing 1–6 of 9", Previous/Next.
- Declined detail drawer: shows Records' decline reason text + "Book a new time" link.

### Profile — `patient`
- Avatar + "Change photo"; name; "Username: … · Role: Patient (fixed)".
- Fields: Email, Phone, Date of birth, Emergency contact (name+phone) → Save changes.
- Change password: Current/New/Confirm password → Update password.
- Notification preferences (checkboxes): email on approve/decline, email reminder 24h before, SMS reminder.

### PatientCalendarSync — `patient`
- Connect-a-calendar cards (Google/Outlook/Apple): connection status, account email, Connect/Disconnect toggle.
- Options (toggle switches): "Add approved appointments automatically", "Reminder the day before", "Update or remove on changes".
- "Add one at a time" panel: list of upcoming appts with in-calendar/pending status tags; Download .ics, Add to Google, Add to Outlook buttons.

---

## 3 · Doctor

### DoctorDashboard — `doctor`
- Nav: Dashboard, My availability, Appointments, Profile.
- Stat cards: Patients today, This week, Pending (with Records), Available days this month.
- "Today's schedule" list: time, patient+reason, status tag (Completed/Next/Approved), "Mark arrived" action on the next patient.
- "My next available days" tag list; "Recent emails" feed.

### DoctorAvailability — `doctor`
- Month calendar: click days to toggle open/closed; "Quick set: repeat every week on" weekday chips (Mon–Sun toggle all matching days).
- Cell states: Available / Available+booked (locked, can't remove) / Not available / Clinic closed(holiday).
- Session settings: Start time, End time (selects), Slot length (select: 20/15/30 min), Max patients/day (number), Break (select).
- Live summary: "`N` days selected" + list of dates.
- Buttons: Save availability, Clear unlocked (keeps booked days).
- Rule: locked (booked) days can't be closed without Records rescheduling first.

### DoctorAppointments — `doctor`
- View toggle: Day / List (list active) / Export.
- Search (patient name/ref), date-range select (This week/Today/Next 30 days).
- Table columns: Date, Time, Patient, Reason, Status.
- Detail side panel (on row click): patient avatar/name/sex/age/phone, dl: When, Type, Reason, Approved by; Visit notes (textarea); actions: Mark completed, No-show.

### DoctorCalendarSync — `doctor`
- Connected-calendars list (Google/Outlook/Apple): connect/disconnect, status tag, and (when connected) per-provider "Add appointments to" calendar select + "Check busy time from" select.
- Sync options (toggles): add approved automatically, two-way busy blocking, hide patient details ("Clinic appointment" only), reminder 15 min before, remove event on cancel/reschedule.
- Private iCal subscribe link (read-only, copy / reset link).
- Event preview card reflecting hide-details toggle.
- "Sync now" button + last-synced timestamp.

### ClinicalNotes — `doctor`
- Header: patient avatar/name/status tag (Draft/Signed), demographics line, allergy/chronic alert box.
- SOAP sections:
  - **S**ubjective: Note template (select incl. Blank note), "Copy from last visit"; Chief complaint (text), History of presenting complaint (textarea).
  - **O**bjective: BP, Pulse, Temp, SpO₂, Weight (vitals inputs), Examination findings (textarea).
  - **A**ssessment: Diagnosis search (ICD-10), Primary/Differential diagnosis tags, Clinical impression (textarea).
  - **P**lan: Prescriptions table (Medication, Dose, Frequency, Duration, Remove) + "Add medication"; allergy-check note; Lab/imaging requests (text), Referral (select); Advice & instructions (textarea); Follow-up (select) — explicitly "creates a follow-up request on an available day, approved by Records."
- All fields disable once signed; "Sign & finalise" locks note; "Add addendum" appears after signing (dated, separate textarea+save).
- Sidebar: Previous visits timeline (links to open past notes), Attachments (drag-drop + Upload file, disabled once signed), Access note ("doctors only; Records/Admin can't see; every view/edit audit-logged").
- Footer bar: autosave status label, Print/PDF, Save draft, Sign & finalise.

---

## 4 · Records

### RecordsQueue — `records`
- Nav: Approval queue (on), All appointments, Doctors' calendars, Patients, Reports.
- Stat cards: Pending, Approved today, Declined today, Oldest waiting.
- Tabs: Pending / Approved / Declined / Cancelled.
- Filters: search (patient/ref/doctor), Doctor select, Sort select.
- Table columns: Ref, Patient, Doctor, Requested slot, Submitted (relative time), Status (tag), Actions.
- Row actions (pending rows): Review (→ RequestReview), Approve, Decline. Done rows: outcome note + Undo.

### RequestReview — `records`
- Header: Request ref + status tag.
- Requested-appointment dl: Doctor, Date & time, Visit type, Reason, Submitted (timestamp + channel).
- Patient card: avatar, name, Patient ID, email, phone; dl: Previous visits count+last date, No-shows count, Other pending.
- Doctor-day-load grid: that day's slots color-coded booked/free with a "no conflicts" confirmation line.
- Decision panel (radio): Approve / Approve a different slot / Decline.
  - Alt slot: New date + New time selects.
  - Decline: Reason (select: Doctor unavailable/Slot already taken/Needs referral first/Other, required) + Message to patient (textarea).
- Internal note (staff-only, textarea).
- "Emails that will be sent" preview box (patient only on decline; patient+doctor otherwise).
- Confirm button label changes with decision; post-confirm banner states outcome (approved → emails sent; declined → slot freed + patient emailed).

---

## 5 · Admin

### AdminDashboard — `admin`
- Nav: Dashboard (on), Users, Register staff, Departments & settings, Audit log.
- Stat cards: Patients, Doctors, Records staff, Admins (counts).
- Chart placeholder: "Appointments – last 6 weeks, Requested vs approved" (bar pairs) + metrics: Pending now, Avg. approval time, Email failures (7d).
- Recent activity feed (actor, action, target, relative time) → link to Audit log.

### StaffUsers — `admin`
- Role filter chips: All / Patients / Doctors / Records / Admins (with counts).
- Search (name/username/email), Status select (Any/Active/Deactivated/Locked).
- Table columns: select checkbox, Name, Username, Role (tag), Department, Status (tag: Active/Invite sent/Locked), Last login, Actions.
- Row actions vary by status: Edit + "⋯" menu (Edit details · Change role · Reset password (emails temp password) · Deactivate · View activity) / Resend invite / Unlock / View.
- Bulk actions: Reset password, Deactivate. Pagination.

### CreateStaff (Register staff user) — `admin`
- Section 1 · Role (radio cards): Doctor / Records / Admin, each with a help line.
- Section 2 · Personal details: First name, Last name, Work email, Phone.
- Section 3 (conditional, Doctor only) · Doctor details: Department (select), Specialty/title, Medical licence no., Consulting room.
- Section 4 · Login: Username (suggested, must be unique), Temporary password (readonly + Regenerate), "Email login details to the user" (checked), "Require password change on first login" (checked).
- Buttons: Cancel → StaffUsers; "Create {role} account" → success banner.

### Settings (Departments, booking rules, email, audit) — `admin`
- Departments table: Name, Doctors count, Edit; "+ Add".
- Booking rules: Earliest booking (Next day/Same day), Book up to (60/30 days ahead), Patient can cancel until (24h/12h before), Auto-expire pending after (48h/Never), Clinic closed days/holidays (text, comma list).
- Email notifications: toggle list — Appointment approved→patient+doctor, Appointment declined→patient, Request received→patient, Reminder 24h before→patient+doctor, New staff account→staff; "Edit templates" / "Send test email"; Sender name, Sender email.
- Audit log table: Time, User, Role, Action, Target; "Export CSV".
- Save settings button.

---

## 6 · Email notifications

### EmailDoctor (approved) — `email`
- Mock email: From/To/Subject header, body card with "Added to your schedule" tag, patient/date/time/visit-type/reason/approved-by dl, "You now have N patients on [day]" line, "Open my schedule" CTA, confidentiality footer.

### EmailPatient (approved) — `email`
- "Appointment approved" tag, doctor/date/time/where/reference dl, arrival/cancellation instructions, "View appointment" + "Add to calendar (.ics)" CTAs.

### EmailRejected (not approved) — `email`
- "Not approved" tag, request detail line, "Reason from Records" callout box, note that slot was released, "Book a new time" CTA.

---

## 7 · Mobile views (390×844, bottom tab bar per role)

### MLogin
- Username, Password, "Keep me signed in", "Forgot?" link, Sign in → MPatientHome; "Create an account" link; prototype role shortcuts.

### MPatientHome — tabs: Home(on)/Book/Appointments/Profile
- Header: greeting, avatar, notification bell (badge).
- "+ Book an appointment" CTA.
- Next-appointment card (date block, doctor, time/room, status tag) with Details/Add to calendar.
- "Waiting for approval" card (date, doctor, pending tag).
- Notifications list.

### MBookDay — step 1 of 2 — tabs: (within booking flow, back → home)
- Department select, doctor picker cards, month calendar (same state model as desktop: available/full/unavailable), legend, running summary line, "Continue to time" → MBookTime.

### MBookTime — step 2 of 2
- Doctor/day summary chip with "Change" link.
- Morning/Afternoon slot grids (taken disabled).
- Visit type select, Reason textarea.
- "Submit request" (disabled until slot picked) → bottom-sheet modal "Request sent" with "View my appointments" / "Done".

### MMyAppts — tabs: Home/Book/Appointments(on)/Profile
- Segmented control: Upcoming/Pending/Past.
- Appointment cards: date/time, status tag, doctor+dept, room+ref, contextual actions (Reschedule/Cancel, Cancel request, decline-reason + Book a new time, Book follow-up).

### MPatientCalendar — tabs: …/Profile(on)
- Calendar provider rows (connect/remove), options toggles (add approved visits, reminder, sync changes), "Download .ics for next visit".

### MDoctorToday — tabs: Today(on)/Availability/Patients/Profile
- Horizontal day-picker strip (available days only).
- Stat tiles: Patients, Seen, Open slots.
- Appointment list rows (time, patient, status tag) → MDoctorAppt.

### MDoctorAvailability — tabs: Today/Availability(on)/Patients/Profile
- Weekly-repeat chip row, month calendar (same states as desktop), collapsible "Session settings" (Start/End/Slot/Max per day), "Save · N days" sticky footer.

### MDoctorAppt (appointment detail)
- Patient card (avatar, name/sex/age/ID, "Approved by Records" tag, Call/Patient history buttons).
- dl: When, Type, Reason, Approved.
- Visit notes textarea.
- Footer: No-show / Mark completed.

### MDoctorCalendar — tabs: …/Profile(on)
- Same provider rows + sync options (add approved, two-way, hide details, sync changes) as desktop, condensed; event preview; iCal copy-link button; "Sync now".

### MClinicalNotes
- Header with status tag + allergy banner.
- S/O/A/P tab strip (segmented).
- Per-tab fields mirror desktop ClinicalNotes (chief complaint/history/dictate; vitals/examination; diagnosis search/tags/impression; prescriptions list+add/lab/follow-up).
- Footer: Save draft / Sign & finalise; signed banner replaces editable fields.

### MAdminHome — tabs: Overview(on)/Users/Add staff/Settings
- "+ Register staff user" CTA.
- 2×2 stat-card grid (Patients/Doctors/Records staff/Admins) linking to Users.
- "Appointments this week" (Requested/Approved/Pending) + chart placeholder.
- Recent activity feed.

### MAdminUsers — tabs: Overview/Users(on)/Add staff/Settings
- Search field, role filter chips (All/Patients/Doctors/Records/Admins).
- User rows: avatar, name/@username/role, status tag (Active/Invited/Locked), "⋮" actions.
- "+ " FAB → MAdminCreate.

### MAdminCreate
- Segmented role picker (Doctor/Records/Admin) with help text.
- Full name, Work email, Phone.
- Conditional (Doctor): Department select, Medical licence no.
- Username, Temporary password (readonly), "Email login details" checkbox.
- "Create {role} account" sticky footer button.

---

## Cross-screen data model notes

- **Appointment** status enum: `pending` (shown "Pending approval"), `approved`, `declined`, `cancelled`, `completed`, `no-show`.
- **User** role enum: `patient`, `doctor`, `records`, `admin`. User status enum: `active`, `invited` (pre-first-login), `locked` (5 failed attempts), `deactivated`.
- **Doctor availability**: per-day boolean within a month, derived from weekly-repeat rules + individual day toggles; locked once that day has an approved appointment. Session settings (`startTime`, `endTime`, `slotLengthMinutes`, `maxPatientsPerDay`, `breakWindow`) appear to be per-doctor, not per-day.
- **ClinicalNote**: SOAP fields (`chiefComplaint`, `historyOfPresentingComplaint`, vitals: `bp`,`pulse`,`temp`,`spo2`,`weight`, `examinationFindings`, `diagnosisPrimary`/`diagnosisDifferential`, `clinicalImpression`, `prescriptions[]` {drug, dose, frequency, duration}, `labRequests`, `referral`, `advice`, `followUp`), plus `status` (`draft`|`signed`), `signedAt`, `signedBy`, `addenda[]` {date, text}. Doctor-only visibility; audit-logged per view/edit.
- **CalendarSync**: per-user per-provider connection (`google`/`outlook`/`apple`), booleans for `autoAddApproved`, `twoWaySync` (doctor only), `hidePatientDetails` (doctor only), `reminder`, `syncOnChange`; plus a private iCal token/link.
- **Department**: name + doctor count (simple lookup table).
- **Clinic settings**: booking-rule fields (`earliestBookingOffset`, `maxBookingWindowDays`, `cancelWindowHours`, `pendingAutoExpireHours`, `closedDates[]`), email-template toggles, sender identity.
- **AuditLog** entry: timestamp, user, role, action, target.

Scope note: the empty stray artboard `Artboard-ku6z.dc.html` was skipped.
