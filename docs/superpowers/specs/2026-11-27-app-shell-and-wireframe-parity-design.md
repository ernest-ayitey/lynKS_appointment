# App Shell & Wireframe Parity — Design

## Intent

The app was built page-by-page across several plans, each page styled as its
own standalone card with no shared chrome. The user has since shared the
"Clinic Appointment Book – Wireframes" design canvas
(`https://claude.ai/artifact/8daQHsXsroNtxLhyeRkoyn`, canonical id
`3dcb54ae-73db-42f1-a317-863b548286ad`) and asked that the shipped app be
brought in line with it: "fix every page to match the way the screens are
looking in the wireframe link... the old design should be updated to what
we have now in the wireframe."

The wireframe canvas is much bigger than what's been built — see
"Non-goals." This design covers only the first slice, agreed with the user
as the starting point: a shared app shell (header + role-based sidebar,
which nothing shipped today has at all) and bringing the pages that already
exist in line with their own wireframe counterpart's layout.

## Goals

1. **One shared `AppShell` component** — a persistent header (clinic name
   placeholder, the logged-in user's name + role, a "Log out" button) and a
   left sidebar nav, matching each wireframe's chrome exactly.
2. **Role-based nav items exactly as each wireframe lists them**, including
   destinations with no shipped page yet (Dashboard, Profile, All
   appointments, Doctors' calendars, Patients, Reports). These render as
   inert, visually muted placeholders — mirroring the wireframe's *own*
   `href="#"` convention for exactly these same not-yet-built items (see
   `RecordsQueue.dc.html`'s nav, which already uses `href="#"` for "All
   appointments"/"Doctors' calendars"/"Patients"/"Reports"). Not hidden, not
   guessed into existence as real pages.
3. **Visual/structural refresh of the 9 pages that already exist**, each
   matching its own wireframe artboard:
   - Login → `Main.dc.html` (titled "Login")
   - Register → `Register.dc.html`
   - Forgot password → `ForgotPassword.dc.html`
   - Book appointment → `BookAppointment.dc.html`
   - My appointments → `MyAppointments.dc.html`
   - Doctor availability → `DoctorAvailability.dc.html`
   - Doctor appointments → `DoctorAppointments.dc.html` (already mostly
     aligned this session — ref heading, no false "Dr." prefix, Day/List/
     Export toggle; wrapping it in the new shell is what's left)
   - Records queue → `RecordsQueue.dc.html`
   - Request review → `RequestReview.dc.html`

   Plus `RoleLandingPage` (route `/`, no wireframe artboard of its own —
   see the builder-check finding under Design): wrapped in the new shell
   and stripped of its own inline nav links/logout button, so it isn't the
   one page left looking chromeless once every other page has the shell.

## Non-goals (separate, later projects, in the order already agreed)

- New pages the canvas shows but nothing in the app has yet: Doctor
  Dashboard, Patient Dashboard, Profile, Admin Dashboard, Create Staff,
  Staff Users, Doctor/Patient Calendar Sync, Settings, Clinical Notes.
  `admin` already exists as a role in `apps/api/app/models/user.rb`'s
  `ROLES` constant, but zero admin routes exist — that's new backend work,
  not a restyle.
- Mobile-specific artboards (`M*.dc.html`) — need their own scoping
  conversation (separate routes vs. responsive breakpoints of the same
  pages) before any work starts on them.
- Any backend change. The My Appointments wireframe shows per-tab counts
  ("All (9)", "Upcoming (1)") that nothing today computes — getting real
  counts needs either 5 extra list calls per tab or a new summary endpoint.
  Cut from this pass; flagged as a small future addition.
- `ResetPasswordPage` and `ChangePasswordPage` — no wireframe artboard for
  either exists anywhere in the canvas. Left exactly as they are; there's
  nothing to match them against.

## Anti-goals

- Breaking any currently-passing test, or any role-gating/data-fetching
  behavior. This is a restyle, not a rewrite of logic.
- A new, separately-maintained color palette that drifts from conventions
  already shipped (e.g. `MyAppointmentsPage`'s existing blue "completed"
  badge, confirmed in a prior session to deliberately match across pages).
  Wireframe colors map onto the *closest already-used Tailwind utility*,
  not raw hex values copied verbatim.
- Inventing content for the unbuilt nav destinations. They stay inert.

## Constraints

- Every existing test must keep passing. Where a layout change alters DOM
  structure a test currently asserts against (e.g. a wrapper `div` becomes
  part of `AppShell` instead of the page), the test is updated to match the
  new structure while still asserting the same underlying behavior — never
  loosened to stop checking something it checked before.
- No existing API contract changes.

## Approaches Considered (shell composition)

**A — each page imports and wraps itself in `<AppShell>`.** Simple, but
repeats the import/usage in 9+ files and couples every page to the shell's
existence.

**B — wrap each protected `<Route>`'s element in `App.tsx`:**
`<ProtectedRoute><AppShell activeNavKey="...">`<Page />`</AppShell></ProtectedRoute>`.
One line added per route; the shell's own logic (header, nav config,
active-item highlighting) lives in exactly one file; every page component
stays focused purely on its own content, unaware the shell exists.

**Decision: B.** It matches this codebase's existing pattern of composing
cross-cutting concerns (`ProtectedRoute` itself) at the route-definition
level rather than inside each page, and keeps the page components' existing
tests (which render the page directly, not through a router) working
without needing to also mock/wrap a shell.

## Design

### `AppShell` (new: `apps/web/src/components/app-shell.tsx`)

- **Header**: clinic name placeholder + logo box (dashed-border placeholder,
  same treatment the wireframe itself uses for "[Clinic Name]" and "LOGO" —
  there's no real logo asset, and inventing one isn't this project's job),
  the signed-in user's name + role from `useAuth()`, and a "Log out" button
  wired to the existing `logout()`.
- **Sidebar**: one `NAV_ITEMS` config keyed by role (`patient`, `doctor`,
  `records`), each entry `{ label, href, implemented }`:
  - `patient`: Dashboard (not implemented), Book appointment (`/book`), My
    appointments (`/appointments`), Profile (not implemented)
  - `doctor`: Dashboard (not implemented), My availability
    (`/doctor/availability`), Appointments (`/doctor/appointments`),
    Profile (not implemented)
  - `records`: Approval queue (`/records/queue`), All appointments (not
    implemented), Doctors' calendars (not implemented), Patients (not
    implemented), Reports (not implemented)
  - An `implemented: false` entry renders as a visually muted,
    `aria-disabled="true"` span — no `href`, no click handler — rather than
    a real link to a route that doesn't exist.
  - `activeNavKey` prop (passed at each route in `App.tsx`) highlights the
    current page's entry, mirroring the wireframe's `.nav a.on` style.
  - **Builder-check finding, settled:** `NAV_ITEMS` has no `admin` entry —
    no admin routes or pages exist anywhere yet (confirmed: `admin` is
    declared in the backend's `User::ROLES` but has zero routes). Call: an
    unmapped role falls back to an empty nav list rather than crashing on
    `NAV_ITEMS[user.role]` being `undefined`. Not worth inventing an admin
    nav from the wireframe's Admin artboards — that's the Admin project's
    job, not this one's.
- **Wrapped, but restyled rather than shell-wrapped**: Login, Register,
  Forgot password — these get their own two-panel layout (next section)
  instead of `AppShell`'s header+sidebar, matching their wireframes
  (`Main.dc.html`/`Register.dc.html`/`ForgotPassword.dc.html`, none of
  which show the sidebar chrome). Reset/Change password are untouched
  entirely (no wireframe artboard for either exists in the canvas).
- **Builder-check finding, settled:** `RoleLandingPage` (route `/`, the
  first page every authenticated user lands on) is in scope too, even
  though it isn't one of the "9 pages" above and has no wireframe artboard
  of its own. It already renders its own inline per-role links and its own
  "Log out" button — once every other page has `AppShell`'s header/sidebar
  (which duplicates both), leaving it as the one chromeless page with a
  second, differently-styled logout button would look broken, not
  intentional. Call: wrap it in `AppShell` like the other 9, and delete its
  now-redundant inline nav links and logout button — the shell provides
  both.
- **Builder-check finding, settled:** wrapping a page in `AppShell` means
  removing that page's own outermost `min-h-screen bg-slate-50 px-4 py-8`
  wrapper (confirmed present at the top of all 5 pages being wrapped,
  plus `RoleLandingPage`) rather than nesting it inside the shell's content
  region. `AppShell` owns the full-viewport frame and background; each
  page keeps only its own inner `mx-auto max-w-Xxl` content container.
  This is a root-JSX edit per page, so each page's existing tests (which
  render the page directly, without a router/shell) need their top-level
  container assertions, if any, checked against the new structure —
  per the Constraints section, updated to match, never loosened.

### Design tokens (mapped onto existing Tailwind usage, no new raw hex)

| Wireframe | Mapped to |
|---|---|
| Primary blue `#2F5BD3` / hover `#1E3F99` | `blue-600` / `blue-700` (already the primary-button color on My Appointments and Request Review) |
| Borders `#D0D4DB` / `#B9BEC7` | `slate-300` |
| Muted text `#59606A` / `#3D434B` | `slate-500` |
| Body text `#1F2328` | `slate-900` |
| Page background `#F4F5F7` | `slate-50` (already used everywhere) |
| Success tag `#DDF3E4`/`#1B5E34` | existing `bg-green-100 text-green-800` |
| Neutral tag `#E6E8EC`/`#3D434B` | existing `bg-slate-100 text-slate-600` |
| Font: Inter | Add once as a Google Fonts `<link>` in `index.html` plus a Tailwind font-family token, not per-page — nothing currently sets a font family beyond the browser default |

### Per-page changes

- **Login / Register / Forgot password**: replace today's single centered
  card with the wireframe's two-panel layout — a left branding panel
  (clinic name/logo placeholder, an illustration placeholder, the
  one-line pitch text) and a right panel holding the existing form
  unchanged in behavior, restyled to the card treatment.
- **Book appointment, My appointments, Doctor availability, Doctor
  appointments, Records queue**: wrapped in `AppShell`; inner content
  restyled to the wireframe's card/table conventions. Most of the
  underlying structure already exists from prior plans (Records queue
  already has its 4 stat cards; My Appointments already has its 5-tab
  filter switcher) — this is mainly wrapper, spacing, border, and ARIA-role
  changes, not new logic. My Appointments' tab bar gains real
  `role="tablist"`/`role="tab"`/`aria-selected` semantics to match the
  wireframe (it's already a working tab switcher, just without those
  roles today).
- **Request review**: restructured from one stacked column into the
  wireframe's two-column layout — left column (requested-appointment card,
  patient card, a slot-grid visualization), right column (a sticky
  decision card with the three options rendered as clickable
  description-cards instead of plain radio buttons, and an emails-preview
  list). The existing `requestedFreeTimes`/`altFreeTimes` state and
  conflict logic are reused as-is; only the presentation changes from one
  text line to an actual color-coded grid of time slots.
  **Builder-check finding, settled:** the doctor's email is never sent to
  the frontend (`request_json` in `apps/api/app/routes/records.rb` only
  adds the *patient's* email/phone under `detailed: true`; the doctor's
  address is used server-side only, inside `deliver_approved_emails`).
  Showing it for real would need a backend change, which this doc's
  Constraints already rule out. Call: the emails-preview shows the
  patient's real address (already available via
  `RecordsPatientDetail.email`) and a generic descriptor for the doctor
  (e.g. "the attending doctor"), not a fabricated or newly-exposed address.

## What's Left to the Builder

- The exact Tailwind classes per element (this doc fixes the color/spacing
  *mapping*, not every literal class name).
  - The slot-grid's exact visual encoding (free vs. booked vs. the
    currently-selected slot) — reuse the existing free-times arrays
    already fetched by `RequestReviewPage`; no new data needed.
- Confirming the `NAV_ITEMS` labels/hrefs against the live wireframe files
  one more time at plan-writing time, the same "read the live file, not
  this doc's prose" rule every prior plan in this repo has followed.
