# App Shell & Wireframe Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a shared header+sidebar shell (which nothing shipped
today has) and restyle every existing page to match its own artboard in the
"Clinic Appointment Book – Wireframes" canvas, with zero behavior or API
changes.

**Architecture:** Three new shared components (`AppShell`, `AuthSplitLayout`,
`AuthCard`) in a new `apps/web/src/components/` directory, wired in at the
route level in `App.tsx` (not imported into each page) per the design doc's
Approach B. Every other task is a restyle of one existing page's JSX —
removing its own outer full-viewport wrapper (now owned by `AppShell`) and
mapping wireframe colors onto already-used Tailwind utilities. No task
touches `apps/api` or changes any component's props/behavior beyond what's
needed to add ARIA roles the wireframe's own markup already implies (the My
Appointments tab switcher).

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, React Router v6,
Vitest + Testing Library — same as every prior frontend plan.

**Spec:** `docs/superpowers/specs/2026-11-27-app-shell-and-wireframe-parity-design.md`.
The wireframe canvas itself — artifact
`https://claude.ai/code/artifact/3dcb54ae-73db-42f1-a317-863b548286ad`
("Clinic Appointment Book – Wireframes"), files under its `project/`
directory — is the ultimate source of exact labels, copy, and layout.
**Every task below says which `project/*.dc.html` file to read directly**
for the values this plan doesn't repeat verbatim; per this repo's own
established convention (see the Doctor Appointments plan's Task 3), read
the live file, never trust a paraphrase.

**Builds on:** every prior frontend plan (Backend/Frontend Foundation,
Departments/Doctors/Availability, Patient Booking & My Appointments, Records
Approval, Doctor Appointments & Clinical Notes — appointments half).

**Scope correction found during planning:** the approved design doc says
`ForgotPasswordPage`/`ResetPasswordPage` restyle only the former, and
`ChangePasswordPage` + `ResetPasswordPage` have no wireframe at all. Reading
`ForgotPassword.dc.html` directly during planning shows it actually draws
**two** form cards side by side as two states of one flow: the left card
("STEP 1 OF 2 — Reset your password") is `ForgotPasswordPage`; the right
card ("STEP 2 OF 2 · opened from email link — Choose a new password") is
`ResetPasswordPage`, and its own caption note — "Also used for staff
first-login (temporary password → new password)" — says it doubles as
`ChangePasswordPage`'s reference too. Task 6 below folds all three pages
into the same shared card component instead of leaving two of them
untouched.

## Global Constraints

- **`AppShell` replaces each wrapped page's own outermost
  `min-h-screen`/full-page wrapper** — it is never nested inside it. Each
  page keeps only its own inner content container (its existing
  `mx-auto max-w-*` div and everything inside it).
- **`NAV_ITEMS` is the single source of per-role sidebar entries** (exact
  values in Task 1). An entry with `href: null` renders as a visually
  muted, non-interactive element with `aria-disabled="true"` — no real
  `<a>`, no click handler, never a link to a route that doesn't exist.
- **A role with no entry in `NAV_ITEMS` renders an empty sidebar list**,
  never a crash (`NAV_ITEMS[role] ?? []`).
- **Color/token mapping (fixed, from the design doc — reuse these exact
  existing Tailwind utilities, never introduce new raw hex or arbitrary
  values for anything this table covers):**
  | Wireframe | Tailwind |
  |---|---|
  | Primary blue `#2F5BD3`/`#1E3F99` | `blue-600`/`blue-700` |
  | Borders `#D0D4DB`/`#B9BEC7` | `slate-300` |
  | Muted text `#59606A`/`#3D434B` | `slate-500` |
  | Body text `#1F2328` | `slate-900` |
  | Page background `#F4F5F7` | `slate-50` |
  | Success tag `#DDF3E4`/`#1B5E34` | `bg-green-100 text-green-800` |
  | Neutral tag `#E6E8EC`/`#3D434B` | `bg-slate-100 text-slate-600` |
- **Inter is the app's font**, added once (Task 1), not per-page.
- **No `apps/api` changes anywhere in this plan.** `RequestReviewPage`'s
  emails-preview (Task 12) shows the patient's real, already-available
  email and a generic, non-address line for the doctor — never a
  fabricated or newly-exposed doctor address.
- **Every test passing before a task started must still pass after it.**
  Where a task's own restructuring changes DOM a test currently asserts
  against, that test is updated to match the new structure while still
  proving the same behavior — never deleted or loosened to stop checking
  something it checked before.

## Review Focus

- An authenticated user whose role has no `NAV_ITEMS` entry (e.g. the
  `admin` role, which already exists in the backend's `User::ROLES` with
  zero routes behind it) opens any shell-wrapped page — the sidebar must
  render empty, not throw.
- A sidebar entry with `href: null` (Dashboard, Profile, and every
  Records item but "Approval queue") — must never be focusable or
  clickable as a navigation target.
- `RoleLandingPage` after Task 2 removes its own inline logout button —
  logging out must still work through `AppShell`'s single header button;
  this is the one place a dangling dead feature would be invisible to
  every other task's own tests.
- The My Appointments tab switcher (Task 10) after gaining real
  `role="tablist"`/`"tab"`/`aria-selected` — the existing click-to-refetch
  behavior (each tab's distinct `AppointmentFilters`) must be provably
  unchanged, not just visually relabeled.
- `RequestReviewPage`'s slot-grid (Task 12) on a day with zero free slots
  — must render the (empty) grid without crashing, the same case the
  current single conflict-text line already handles silently today.

---

### Task 1: `AppShell` component + font

**Files:**
- Create: `apps/web/src/components/app-shell.tsx`
- Create: `apps/web/src/components/__tests__/app-shell.test.tsx`
- Modify: `apps/web/index.html` (Google Fonts `<link>`)
- Modify: `apps/web/src/index.css` (`body` font-family)

**Interfaces:**
- Produces, consumed by Task 2 and every later page task:
  ```ts
  export type NavKey =
    | 'patient-dashboard' | 'patient-book' | 'patient-appointments' | 'patient-profile'
    | 'doctor-dashboard' | 'doctor-availability' | 'doctor-appointments' | 'doctor-profile'
    | 'records-queue' | 'records-all-appointments' | 'records-doctors-calendars'
    | 'records-patients' | 'records-reports';

  export interface AppShellProps {
    // Optional: `RoleLandingPage` ('/') doesn't correspond to any single
    // sidebar entry for every role (Records' own nav has no "Dashboard"
    // item at all), so it's the one route that passes no activeNavKey —
    // nothing highlights, which is correct, not a bug.
    activeNavKey?: NavKey;
    children: ReactNode;
  }
  export default function AppShell(props: AppShellProps): JSX.Element;
  ```
  Reads `user`/`logout` from `useAuth()` itself (same pattern every page
  already uses — no auth data is passed as a prop).

- [ ] **Step 1: Read the live wireframe files** for the header and sidebar
  chrome — `project/DoctorAppointments.dc.html`'s `<header>` block (clinic
  name/logo placeholder, user name+role, "Log out") and its `.nav` sidebar;
  `project/MyAppointments.dc.html`'s patient nav; `project/RecordsQueue.dc.html`'s
  records nav — in artifact `3dcb54ae-73db-42f1-a317-863b548286ad`, to
  confirm exact labels before writing `NAV_ITEMS`.

- [ ] **Step 2: Write the failing tests** in `app-shell.test.tsx`, mocking
  `useAuth` the same way `role-landing.page.test.tsx` already does:
  ```ts
  it('renders the Dashboard/My availability/Appointments/Profile nav for a doctor, with Dashboard and Profile inert', () => {})
  it('renders the Dashboard/Book appointment/My appointments/Profile nav for a patient, with Dashboard and Profile inert', () => {})
  it('renders the Approval queue/All appointments/Doctors\' calendars/Patients/Reports nav for records, with every item but Approval queue inert', () => {})
  it('an inert nav item has no href and aria-disabled="true", and is not in the accessible link list', () => {})
  it('renders an empty sidebar for a role with no NAV_ITEMS entry (e.g. admin), not a crash', () => {})
  it('highlights the nav item matching activeNavKey', () => {})
  it('highlights nothing when activeNavKey is omitted', () => {})
  it("renders the signed-in user's name and role, and a working Log out button", async () => {})
  ```
  "Inert" assertions: `screen.queryByRole('link', { name: /dashboard/i })`
  must be null, but the label text itself must still be present (via
  `getByText`), with `aria-disabled="true"` on its container.

- [ ] **Step 3: Run it, confirm it fails** (module doesn't exist).

- [ ] **Step 4: Implement `AppShell`** — `NAV_ITEMS: Record<'patient' | 'doctor' | 'records', Array<{ key: NavKey; label: string; href: string | null }>>`
  exactly per Step 1's confirmed labels; `const items = NAV_ITEMS[user.role] ?? []`;
  map each to a real `<Link>` (has `href`) or a muted `<span aria-disabled="true">`
  (no `href`); header renders `[Clinic Name]`/`LOGO` placeholders (dashed
  box, same treatment the wireframe itself uses — there's no real logo
  asset, and this plan doesn't invent one), `${user.first_name} ${user.last_name}`,
  `user.role`, and a "Log out" button calling the existing `logout()`.

- [ ] **Step 5: Add the Inter font** — a Google Fonts `<link>` in
  `apps/web/index.html`'s `<head>` (same `family=Inter:wght@400;500;600;700`
  the wireframes use) and `body { font-family: 'Inter', system-ui, sans-serif; }`
  in `apps/web/src/index.css`.

- [ ] **Step 6: Run it, confirm it passes.**

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/app-shell.tsx apps/web/src/components/__tests__/app-shell.test.tsx apps/web/index.html apps/web/src/index.css
git commit -m "feat: add AppShell (header + role-based sidebar nav)"
```

---

### Task 2: Wire `AppShell` into every protected route; simplify `RoleLandingPage`

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/dashboard/role-landing.page.tsx`
- Modify: `apps/web/src/features/dashboard/__tests__/role-landing.page.test.tsx`

**Interfaces:**
- Consumes: `AppShell`/`NavKey` from Task 1.

- [ ] **Step 1: Write the failing test changes.** Rewrite
  `role-landing.page.test.tsx`: delete every assertion about nav links
  (availability/appointments/book/my-appointments/records-queue — those
  behaviors moved to Task 1's own `app-shell.test.tsx`, where they're
  already covered) and the logout-button test (ditto). Keep/add only:
  ```ts
  it('renders the signed-in-as message for the current user', () => {})
  ```
  asserting `screen.getByText(/signed in as patient: John Doe/i)` (or the
  per-role equivalent) — `RoleLandingPage` no longer renders any link or
  button itself.

- [ ] **Step 2: Run the rewritten test file against the still-unmodified
  `RoleLandingPage`.** The kept "signed in as" assertion passes already
  (that message isn't changing); this step confirms the rewrite correctly
  dropped only the moved assertions and nothing else.

- [ ] **Step 3: Simplify `RoleLandingPage`** — delete its own outer
  `<div className="flex min-h-screen ...">` wrapper, every per-role
  `<Link>` block, the `handleLogout`/logout button, and the now-unused
  `useNavigate` import. What's left: just the "Signed in as {role}:
  {first_name} {last_name}" message, in a simple content container (no
  full-viewport wrapper — `AppShell` supplies that now).

- [ ] **Step 4: Wire `AppShell` into `App.tsx`.** For every
  `ProtectedRoute`-wrapped route except the auth pages (Login, Register,
  Forgot/Reset/Change password — those stay exactly as routed today, no
  `AppShell`), insert `<AppShell activeNavKey="...">` between
  `<ProtectedRoute>` and the page element:
  - `/` → `RoleLandingPage` — pass no `activeNavKey` at all (prop
    omitted). It doesn't correspond to any single sidebar entry for every
    role: Records' own nav has no "Dashboard" item, so there is no `NavKey`
    that would be correct across all three roles. Nothing highlights here,
    for any role — that's correct, not a gap.
  - `/doctor/availability` → `'doctor-availability'`
  - `/doctor/appointments` → `'doctor-appointments'`
  - `/book` → `'patient-book'`
  - `/appointments` → `'patient-appointments'`
  - `/records/queue` → `'records-queue'`
  - `/records/requests/:id` → `'records-queue'` (it's reached from the
    queue; the wireframe's own `RequestReview.dc.html` highlights
    "Approval queue" too, confirmed by reading that file in Task 12)

- [ ] **Step 5: Write one failing integration test in `App.test.tsx`**
  proving logout still works end-to-end now that `RoleLandingPage` no
  longer has its own logout button (Review Focus: this is the one place a
  dangling dead feature would be invisible to every other task's own
  isolated-component tests):
  ```ts
  it('lets an authenticated user log out from the landing page via AppShell', async () => {})
  ```
  Render `<App>` with `useAuth` mocked as authenticated at `/`, click the
  "Log out" button, assert the mocked `logout` was called.

- [ ] **Step 6: Run it, confirm it fails** (route not yet wired to
  `AppShell`).

- [ ] **Step 7: Run `role-landing.page.test.tsx`, the new `App.test.tsx`
  test, and the full web suite — confirm everything passes** (expect
  `App.test.tsx`'s original unauthenticated-login test to be unaffected,
  since Login isn't shell-wrapped).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/features/dashboard/role-landing.page.tsx apps/web/src/features/dashboard/__tests__/role-landing.page.test.tsx
git commit -m "feat: wire AppShell into every protected route, simplify RoleLandingPage"
```

---

### Task 3: `AuthSplitLayout` and `AuthCard` components

**Files:**
- Create: `apps/web/src/components/auth-split-layout.tsx`
- Create: `apps/web/src/components/auth-card.tsx`
- Create: `apps/web/src/components/__tests__/auth-split-layout.test.tsx`
- Create: `apps/web/src/components/__tests__/auth-card.test.tsx`

**Interfaces:**
- Produces, consumed by Tasks 4-6:
  ```ts
  export interface AuthSplitLayoutProps { children: ReactNode; }
  export default function AuthSplitLayout(props: AuthSplitLayoutProps): JSX.Element;

  export interface AuthCardProps {
    title: string;
    subtitle?: string;
    stepLabel?: string;        // e.g. "STEP 1 OF 2" — when present, no logo/clinic-name header row is rendered
    maxWidth?: 'narrow' | 'wide'; // default 'narrow' (~420px); 'wide' (~720px) for Register
    children: ReactNode;
  }
  export default function AuthCard(props: AuthCardProps): JSX.Element;
  ```

- [ ] **Step 1: Read `project/Main.dc.html`** (the branding left panel:
  logo/clinic-name row, illustration placeholder box, h1 pitch copy, phone
  line) for `AuthSplitLayout`'s exact static copy, and
  **`project/Register.dc.html`**'s top logo/clinic-name row plus
  **`project/ForgotPassword.dc.html`**'s step-label row for `AuthCard`'s
  two header variants.

- [ ] **Step 2: Write the failing tests.**
  ```ts
  // auth-split-layout.test.tsx
  it('renders the branding panel copy and the children in the form panel', () => {})

  // auth-card.test.tsx
  it('renders a logo/clinic-name header when no stepLabel is given', () => {})
  it('renders the stepLabel instead of a logo header when stepLabel is given', () => {})
  it('renders title, subtitle, and children inside the card', () => {})
  ```

- [ ] **Step 3: Run it, confirm it fails.**

- [ ] **Step 4: Implement both components** — `AuthSplitLayout` is a fixed
  two-panel flex layout (left: static branding content from Step 1; right:
  centered `children`) on the `slate-50` background. `AuthCard` renders
  either the logo/clinic-name row or the `stepLabel` span (never both),
  then a white `slate-300`-bordered rounded card (`max-w-[420px]` or
  `max-w-[720px]` per `maxWidth`) containing `title`/optional `subtitle`
  and `children`.

- [ ] **Step 5: Run it, confirm it passes.**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/auth-split-layout.tsx apps/web/src/components/auth-card.tsx apps/web/src/components/__tests__/auth-split-layout.test.tsx apps/web/src/components/__tests__/auth-card.test.tsx
git commit -m "feat: add AuthSplitLayout and AuthCard components"
```

---

### Task 4: Restyle `LoginPage`

**Files:**
- Modify: `apps/web/src/features/auth/login.page.tsx`
- Modify: `apps/web/src/features/auth/__tests__/login.page.test.tsx` (if it
  asserts against the current outer wrapper's structure — check and update
  only what the restyle actually changes)

**Interfaces:**
- Consumes: `AuthSplitLayout` from Task 3.

- [ ] **Step 1: Read `project/Main.dc.html`**'s right-hand form panel for
  exact copy/order: "Sign in" / "Patients, doctors, records and admin
  staff all sign in here." / Username / Password + "Forgot password?" /
  "Keep me signed in" checkbox / Sign in button / "New patient? Create an
  account".

- [ ] **Step 2: Run the existing `login.page.test.tsx`, confirm it still
  passes against the current implementation** (baseline before touching
  anything).

- [ ] **Step 3: Restyle `LoginPage`'s JSX** — wrap the existing form (same
  `react-hook-form` logic, same field names, same submit handler,
  unchanged) in `<AuthSplitLayout>`; remove the page's own outer
  `min-h-screen`/centering wrapper; match the card/input/button classes
  per this plan's Global Constraints color mapping.

- [ ] **Step 4: Run `login.page.test.tsx` and `App.test.tsx`, confirm both
  still pass** (fix only assertions that targeted removed wrapper
  elements, never loosen a behavioral assertion).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/login.page.tsx apps/web/src/features/auth/__tests__/login.page.test.tsx
git commit -m "style: restyle LoginPage to match Main.dc.html"
```

---

### Task 5: Restyle `RegisterPage`

**Files:**
- Modify: `apps/web/src/features/auth/register.page.tsx`
- Modify: `apps/web/src/features/auth/__tests__/register.page.test.tsx` (structure-only updates, if any)

**Interfaces:**
- Consumes: `AuthCard` (maxWidth `'wide'`, no `stepLabel`) from Task 3.

- [ ] **Step 1: Read `project/Register.dc.html`** for the exact two-fieldset
  grouping ("Personal details": first name, last name, date of birth,
  gender, email, phone; "Login details": username, password, confirm
  password), the password-strength bar, and the legend/hint copy — confirm
  these match `RegisterPage`'s current fields one-for-one (they already do,
  per this plan's own recon) before touching anything, and flag in the
  commit if a real mismatch turns up.

- [ ] **Step 2: Run the existing `register.page.test.tsx`, confirm it
  passes** (baseline).

- [ ] **Step 3: Restyle `RegisterPage`'s JSX** — wrap in
  `<AuthCard title="Create your patient account" subtitle="..." maxWidth="wide">`,
  keep every existing field/`register()` call/validation untouched, only
  change wrapper classes and fieldset/grid presentation to match.

- [ ] **Step 4: Run `register.page.test.tsx`, confirm it still passes.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/register.page.tsx apps/web/src/features/auth/__tests__/register.page.test.tsx
git commit -m "style: restyle RegisterPage to match Register.dc.html"
```

---

### Task 6: Restyle `ForgotPasswordPage`, `ResetPasswordPage`, `ChangePasswordPage`

**Files:**
- Modify: `apps/web/src/features/auth/forgot-password.page.tsx`
- Modify: `apps/web/src/features/auth/reset-password.page.tsx`
- Modify: `apps/web/src/features/auth/change-password.page.tsx`
- Modify: their respective `__tests__` files (structure-only updates, if any)

**Interfaces:**
- Consumes: `AuthCard` (maxWidth `'narrow'`, with `stepLabel`) from Task 3.

- [ ] **Step 1: Read `project/ForgotPassword.dc.html`**'s two cards —
  left ("STEP 1 OF 2", "Reset your password", explanation, username field,
  "Send reset link" button, success-state copy, "← Back to sign in" link)
  and right ("STEP 2 OF 2 · opened from email link", "Choose a new
  password", new password + confirm fields, expiry note, "Save and sign
  in" button) — for exact copy and order.

- [ ] **Step 2: Run the three existing test files, confirm they pass**
  (baseline).

- [ ] **Step 3: Restyle all three pages** — `ForgotPasswordPage` wraps in
  `<AuthCard stepLabel="STEP 1 OF 2" title="Reset your password" subtitle="...">`
  around its existing username field/submit logic, unchanged.
  `ResetPasswordPage` wraps in
  `<AuthCard stepLabel="STEP 2 OF 2 · opened from email link" title="Choose a new password">`
  around its existing password/confirm fields, unchanged. `ChangePasswordPage`
  wraps in the same card shape (reusing the wireframe's own note that this
  card "is also used for staff first-login") — its existing
  `currentPassword` field (not drawn in the wireframe, since the mock only
  shows the two states that exist in our app as two *different* pages) stays,
  added above the new-password fields, unchanged in logic.

- [ ] **Step 4: Run all three test files, confirm they still pass.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/forgot-password.page.tsx apps/web/src/features/auth/reset-password.page.tsx apps/web/src/features/auth/change-password.page.tsx apps/web/src/features/auth/__tests__/forgot-password.page.test.tsx apps/web/src/features/auth/__tests__/reset-password.page.test.tsx apps/web/src/features/auth/__tests__/change-password.page.test.tsx
git commit -m "style: restyle ForgotPassword/ResetPassword/ChangePassword to match ForgotPassword.dc.html"
```

---

### Task 7: Restyle `BookAppointmentPage`

**Files:**
- Modify: `apps/web/src/features/appointments/book-appointment.page.tsx`
- Modify: `apps/web/src/features/appointments/__tests__/book-appointment.page.test.tsx` (structure-only updates, if any)

**Interfaces:**
- Consumes: Task 2's `AppShell` wiring (already wraps this route) —
  this task touches only the page's own inner content.

- [ ] **Step 1: Read `project/BookAppointment.dc.html`** directly for its
  card/section layout, button/tag styling, and copy — this plan doesn't
  repeat its full structure.

- [ ] **Step 2: Run the existing test file, confirm it passes** (baseline).

- [ ] **Step 3: Restyle the page** — delete its own outer
  `min-h-screen`/centering wrapper (now redundant under `AppShell`); keep
  every existing fetch/state/submit behavior unchanged; update classes on
  the remaining inner content to the Global Constraints' color/spacing
  mapping and the wireframe's card conventions.

- [ ] **Step 4: Run the test file, confirm it still passes.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/appointments/book-appointment.page.tsx apps/web/src/features/appointments/__tests__/book-appointment.page.test.tsx
git commit -m "style: restyle BookAppointmentPage to match BookAppointment.dc.html"
```

---

### Task 8: Restyle `DoctorAvailabilityPage`

**Files:**
- Modify: `apps/web/src/features/doctor/doctor-availability.page.tsx`
- Modify: `apps/web/src/features/doctor/__tests__/doctor-availability.page.test.tsx` (structure-only updates, if any)

**Interfaces:**
- Consumes: Task 2's `AppShell` wiring.

- [ ] **Step 1: Read `project/DoctorAvailability.dc.html`** directly for
  its calendar/card layout and copy.

- [ ] **Step 2: Run the existing test file, confirm it passes** (baseline).

- [ ] **Step 3: Restyle the page** — same pattern as Task 7: remove the
  outer wrapper, keep all calendar/session-settings logic unchanged, match
  classes to the wireframe.

- [ ] **Step 4: Run the test file, confirm it still passes.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/doctor/doctor-availability.page.tsx apps/web/src/features/doctor/__tests__/doctor-availability.page.test.tsx
git commit -m "style: restyle DoctorAvailabilityPage to match DoctorAvailability.dc.html"
```

---

### Task 9: Restyle `DoctorAppointmentsPage` (wrapper removal only)

**Files:**
- Modify: `apps/web/src/features/doctor/doctor-appointments.page.tsx`
- Modify: `apps/web/src/features/doctor/__tests__/doctor-appointments.page.test.tsx` (structure-only updates, if any)

**Interfaces:**
- Consumes: Task 2's `AppShell` wiring.

This page's inner content already matches `DoctorAppointments.dc.html`
closely (ref heading, no false "Dr." prefix, Day/List/Export toggle — all
done earlier this session). The only remaining gap is the outer wrapper.

- [ ] **Step 1: Run the existing test file, confirm it passes** (baseline).

- [ ] **Step 2: Remove the page's own outer `min-h-screen bg-slate-50 px-4 py-8`
  wrapper** (now redundant under `AppShell`), keeping its inner
  `mx-auto max-w-6xl space-y-6` content container and everything inside it
  exactly as-is.

- [ ] **Step 3: Run the test file, confirm it still passes.**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/doctor/doctor-appointments.page.tsx apps/web/src/features/doctor/__tests__/doctor-appointments.page.test.tsx
git commit -m "style: remove DoctorAppointmentsPage's own wrapper now that AppShell supplies it"
```

---

### Task 10: Restyle `MyAppointmentsPage` + real tab semantics

**Files:**
- Modify: `apps/web/src/features/appointments/my-appointments.page.tsx`
- Modify: `apps/web/src/features/appointments/__tests__/my-appointments.page.test.tsx`

**Interfaces:**
- Consumes: Task 2's `AppShell` wiring.

- [ ] **Step 1: Read `project/MyAppointments.dc.html`** directly for its
  `role="tablist"`/`role="tab"`/`aria-selected` markup on the 5-tab filter
  bar and its card/table conventions.

- [ ] **Step 2: Write the failing test** confirming the tab bar now exposes
  real tab semantics:
  ```ts
  it('exposes the tab bar with role="tablist" and each tab with role="tab" and the correct aria-selected', () => {})
  ```

- [ ] **Step 3: Run it, confirm it fails** (current tabs are plain buttons
  with `aria-pressed`, not `role="tab"`/`aria-selected`).

- [ ] **Step 4: Restyle the page** — remove the outer wrapper; change the
  tab bar's container to `role="tablist"` and each button to
  `role="tab"` + `aria-selected={activeTab === tab.key}` (replacing
  `aria-pressed`), keeping `filtersForTab`/`refetch`/every other behavior
  completely unchanged; match card/table classes to the wireframe.

- [ ] **Step 5: Run the new test and the rest of the file, confirm all
  pass** (the existing tab-click-refetches-with-right-filters tests must
  still pass unmodified in behavior, only the role/attribute queried may
  need updating from `aria-pressed` to `aria-selected` where a test reads
  that attribute directly).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/appointments/my-appointments.page.tsx apps/web/src/features/appointments/__tests__/my-appointments.page.test.tsx
git commit -m "style: restyle MyAppointmentsPage, give its tab bar real ARIA tab semantics"
```

---

### Task 11: Restyle `RecordsQueuePage`

**Files:**
- Modify: `apps/web/src/features/records/records-queue.page.tsx`
- Modify: `apps/web/src/features/records/__tests__/records-queue.page.test.tsx` (structure-only updates, if any)

**Interfaces:**
- Consumes: Task 2's `AppShell` wiring.

- [ ] **Step 1: Read `project/RecordsQueue.dc.html`** directly — its 4 stat
  cards (already present in the live page, confirmed during planning),
  table/card conventions, and copy.

- [ ] **Step 2: Run the existing test file, confirm it passes** (baseline).

- [ ] **Step 3: Restyle the page** — remove the outer wrapper, keep every
  stat/fetch/filter/action behavior unchanged, match classes to the
  wireframe's stat-card grid and table conventions.

- [ ] **Step 4: Run the test file, confirm it still passes.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/records/records-queue.page.tsx apps/web/src/features/records/__tests__/records-queue.page.test.tsx
git commit -m "style: restyle RecordsQueuePage to match RecordsQueue.dc.html"
```

---

### Task 12: Restyle `RequestReviewPage` (two-column layout + slot-grid)

**Files:**
- Modify: `apps/web/src/features/records/request-review.page.tsx`
- Modify: `apps/web/src/features/records/__tests__/request-review.page.test.tsx`

**Interfaces:**
- Consumes: Task 2's `AppShell` wiring (`activeNavKey="records-queue"`,
  per Task 2 Step 4).
- Consumes: this page's own existing `requestedFreeTimes`/`altFreeTimes`/
  `noConflicts`/`isOwnSlot` state and `patientStats` — all reused as-is;
  this task only changes what renders, never what's fetched or computed.

- [ ] **Step 1: Read `project/RequestReview.dc.html`** directly for the
  exact two-column structure: left column (requested-appointment card,
  patient card with previous-visits/no-shows/other-pending stats, the
  slot-grid section with its per-slot free/booked coloring and the
  "No conflicts: doctor is available and the slot is free." line), right
  column (sticky decision card: the three options as clickable
  description-cards — "Approve"/"Confirms the slot and emails patient +
  doctor", "Approve a different slot"/"Move to another open slot on the
  doctor's available days", "Decline"/"Frees the slot and emails the
  patient the reason" — an internal-note textarea, an emails-preview list,
  and the confirm button).

- [ ] **Step 2: Run the existing test file, confirm it passes** (baseline).

- [ ] **Step 3: Write the failing test** for the slot-grid's empty case
  (Review Focus: a fully-booked day, `relevantFreeTimes` already arrives
  as `[]` for this case today — same data the current single conflict
  line already handles):
  ```ts
  it('renders the slot grid without crashing when the requested date has zero free slots', () => {})
  ```

- [ ] **Step 4: Run it, confirm it fails** (no slot-grid element exists
  yet to query).

- [ ] **Step 5: Restructure the page's JSX into the two-column layout** —
  left column holds the existing "Requested appointment"/"Patient"
  sections plus a new slot-grid visualization built from
  `relevantFreeTimes` (already computed): render each of the doctor's
  known slots for the relevant date as a small cell, colored free vs.
  booked, with the selected/requested slot visually distinguished —
  replacing today's single `data-testid="no-conflicts-line"` text (which
  stays, as a line below the grid, unchanged in its own logic). Right
  column wraps the existing `decision`/`altDate`/`altTime`/
  `declineReasonCode`/`declineMessage`/`internalNote` fields (same
  `react-hook-form` registration, unchanged) inside description-cards per
  radio option instead of plain `<label><input type="radio">`. The
  emails-preview line changes from the generic
  `"Emails that will be sent: {decision === 'decline' ? 'Patient only.' : 'Patient and doctor.'}"`
  to a short list: the patient's real `requestDetail.patient.email` always,
  plus — only when `decision !== 'decline'` — a generic "the attending
  doctor" line (never a real address; see Global Constraints).

- [ ] **Step 6: Run the full test file, confirm it all passes** — the new
  empty-slot-grid test from Step 3 included, plus fix only assertions
  that targeted removed/renamed elements (e.g. if a test queried the old
  single-line emails-preview by exact text, update it to query the new
  list's patient-email line and, separately, assert the generic doctor
  line's presence/absence per decision — never remove the underlying
  behavioral check).

- [ ] **Step 7: Run the full web suite + `tsc -b --noEmit`, confirm no
  regression** (this is the plan's last task — a good point to catch any
  cross-task drift before the final review).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/records/request-review.page.tsx apps/web/src/features/records/__tests__/request-review.page.test.tsx
git commit -m "style: restructure RequestReviewPage into the two-column layout with a real slot-grid"
```
