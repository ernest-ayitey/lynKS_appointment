# Unified Sign-In & Role Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two separate sign-in screens (patient phone/OTP, staff email/password) with one entry screen that detects which flow to use from the format of what's typed, rename the staff role taxonomy to Records/Doctors/Admin (dropping Dental assistant), and make the app state which identity/role a user signed in as.

**Architecture:** No new auth mechanisms — patients still authenticate via phone+OTP, staff still via email+password(+2FA). Only the entry point changes: one page, one input field, client-side format detection (`@` present → staff/email path; otherwise → patient/phone path) branching into the existing, unchanged backend endpoints and existing downstream pages (enter-code, two-step, role-location picker). A `roleName` claim is added to the staff access token (alongside the existing `permissions` claim) so any page can read "who is this" without a new endpoint, and survives token refresh the same way `permissions` already does.

**Tech Stack:** Same as the existing codebase (NestJS/Prisma/MySQL backend, React/Vite frontend) — no new dependencies.

**Spec:** None — this plan implements decisions made directly in conversation:
- The user asked for one login interface instead of separate patient/staff screens, with the system detecting "this is a patient" (or staff role) after login.
- Role taxonomy confirmed via clarifying question: exactly **Patient** (an `Account`, not a `StaffUser` role), **Records** (renamed from "Front desk"), **Doctors** (renamed from "Doctor"), **Admin** (renamed from "Clinic admin"). **Dental assistant is removed entirely**, not folded into another role.
- This plan modifies already-shipped, merged code from the `2026-11-13-foundation-and-auth` plan (now on `main`).

## Global Constraints

- No new auth mechanisms or new backend endpoints — reuse `/auth/patient/request-otp`, `/auth/patient/verify-otp`, `/auth/staff/login`, `/auth/staff/two-step/request`, `/auth/staff/two-step/verify`, `/auth/staff/role-location` exactly as they exist today.
- Role rename is exactly: `"Front desk"` → `"Records"`, `"Doctor"` → `"Doctors"`, `"Clinic admin"` → `"Admin"`. `"Dental assistant"` is deleted, not renamed.
- No hard deletion of user-generated data — this plan only touches seed-managed `Role`/`RolePermission` rows (system-managed, `isSystemDefault: true`), never `StaffUser` or `Account` rows.
- `usePermission`'s existing framing stays true: any new identity/role-reading hook is UI-convenience only, never a security boundary — the backend's `PermissionsGuard` is unchanged and remains the real enforcement point.
- Single clinic deployment — no multi-tenant fields (unchanged from prior plans).

## Review Focus

- **Format-detection correctness** — a realistic phone number (e.g. `+233241234567`) must never be routed to the staff/password path, and a realistic email must never be routed to the OTP path. Covered in Task 4.
- **Existing 2FA/role-location branching must survive the merge unchanged** — the unified page's email/password branch must still: skip straight to a dashboard for a single-role, no-2FA staff user; go to `/staff/two-step` when `requiresTwoStep`; go to `/staff/choose-role-location` when multiple role/location rows exist. This is a regression risk since the logic is being moved, not just added. Covered in Task 4.
- **`roleName` must survive refresh-token rotation**, not just appear on first login — the existing pattern (`permissions`, `staffUserLocationId` both persist across `POST /auth/refresh`) must hold for `roleName` too. Covered in Task 2.
- **Role rename must leave no orphaned old-named rows** — reseeding after the rename must result in exactly 3 roles (Records, Doctors, Admin), with no leftover `"Front desk"`/`"Doctor"`/`"Clinic admin"`/`"Dental assistant"` rows and no dangling `RolePermission` rows pointing at deleted roles. Covered in Task 1.
- **A staff user with no matching role data (edge case from the rename)** — the rename must not silently break `computeStaffPermissions` for a role that no longer has explicit `RolePermission` rows (the existing "absence means not-allowed" behavior, already relied on by the old "Dental assistant" role, must keep working for any future role seeded without an explicit matrix entry). Covered in Task 1.

---

## File Structure

```
apps/api/
  prisma/seed.ts                                   # modify: new role names, cleanup of old rows
  test/seed.spec.ts                                 # modify: updated role-name assertions
  src/auth/token.service.ts                         # modify: AccessTokenClaims.roleName, buildStaffClaims
  src/auth/auth.service.ts                          # modify: resolveStaffRoleLocation sets roleName
  test/auth.role-location.spec.ts                   # modify: assert roleName on final tokens + after refresh
apps/web/
  src/lib/jwt.ts                                     # create: shared decodeJwtPayload (extracted)
  src/lib/__tests__/jwt.test.ts                      # create: tests for the extracted decoder
  src/lib/use-permission.ts                          # modify: import decodeJwtPayload from jwt.ts
  src/lib/use-account-identity.ts                    # create: useAccountIdentity() hook
  src/lib/__tests__/use-account-identity.test.ts      # create
  src/features/auth/sign-in.page.tsx                 # create: unified entry page
  src/features/auth/__tests__/sign-in.test.tsx        # create
  src/features/auth/patient-sign-in.page.tsx          # delete (merged into sign-in.page.tsx)
  src/features/auth/staff-sign-in.page.tsx            # delete (merged into sign-in.page.tsx)
  src/features/auth/__tests__/patient-sign-in.test.tsx # delete
  src/features/auth/__tests__/staff-sign-in.test.tsx   # delete
  src/App.tsx                                         # modify: routes + landing-page identity labels
```

---

### Task 1: Backend — rename roles, remove Dental assistant, clean up orphaned rows

**Files:**
- Modify: `apps/api/prisma/seed.ts`
- Modify: `apps/api/test/seed.spec.ts`

**Interfaces:**
- Produces: seeded `Role` rows named exactly `"Records"`, `"Doctors"`, `"Admin"` — no `"Front desk"`, `"Doctor"`, `"Clinic admin"`, or `"Dental assistant"` rows remain after `main()` runs, even when re-run against a database that still has the old-named rows from a prior seed.
- The default `RolePermission` matrix carries over with renamed keys: `Admin` → all of `PERMISSION_KEYS` allowed; `Doctors` → `['clinical_notes.read', 'doctors.hours.manage']`; `Records` → `['bookings.manage', 'patients.contact_details.read']`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/seed.spec.ts — replace the existing role-name assertions
it('seeds exactly 3 roles named Records, Doctors, and Admin', async () => {
  const roles = await prisma.role.findMany();
  expect(roles.map((r) => r.name).sort()).toEqual(['Admin', 'Doctors', 'Records']);
});

it('leaves no old-named role rows after reseeding', async () => {
  const oldNames = ['Front desk', 'Doctor', 'Clinic admin', 'Dental assistant'];
  const stale = await prisma.role.findMany({ where: { name: { in: oldNames } } });
  expect(stale).toHaveLength(0);
});

it('gives Records the bookings.manage and patients.contact_details.read permissions, not clinical_notes.read', async () => {
  const role = await prisma.role.findFirstOrThrow({
    where: { name: 'Records' },
    include: { rolePermissions: { include: { permission: true } } },
  });
  const allowedKeys = role.rolePermissions.filter((rp) => rp.allowed).map((rp) => rp.permission.key);
  expect(allowedKeys.sort()).toEqual(['bookings.manage', 'patients.contact_details.read']);
});
```

- [ ] **Step 2: Run tests to verify they fail** (current seed still produces the old 4 role names).

- [ ] **Step 3: Implement the rename and cleanup in `seed.ts`.**

Change `ROLE_NAMES` to `['Records', 'Doctors', 'Admin'] as const` and update `DEFAULT_ALLOWED_PERMISSIONS`'s keys to `Admin`/`Doctors`/`Records` matching the Interfaces block above. Before `seedRoles()` upserts the new names, clean up the old-named rows in two steps (old roles have `RolePermission` rows pointing at them — `"Front desk"`, `"Doctor"`, and `"Clinic admin"` each got one row per `PERMISSION_KEYS` from the previous seed, so deleting the `Role` row first would hit a foreign-key constraint):
1. Find the stale roles safe to remove: `const staleRoles = await prisma.role.findMany({ where: { name: { in: ['Front desk', 'Doctor', 'Clinic admin', 'Dental assistant'] }, staffUsers: { none: {} } } })` (Prisma relation filter on `Role.staffUsers`, the existing back-relation in `schema.prisma`).
2. Delete their `RolePermission` rows first — `prisma.rolePermission.deleteMany({ where: { roleId: { in: staleRoles.map((r) => r.id) } } })` — then delete the `Role` rows themselves — `prisma.role.deleteMany({ where: { id: { in: staleRoles.map((r) => r.id) } } })`.

Do not delete a stale-named role that still has `StaffUser` rows pointing at it (excluded by the `staffUsers: { none: {} }` filter above); leave it and let a human resolve the conflict rather than silently failing or corrupting data.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/api/prisma/seed.ts apps/api/test/seed.spec.ts
git commit -m "feat: rename staff roles to Records/Doctors/Admin, remove Dental assistant"
```

---

### Task 2: Backend — add `roleName` to the staff access token

**Files:**
- Modify: `apps/api/src/auth/token.service.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/test/auth.role-location.spec.ts`

**Interfaces:**
- Consumes: `computeStaffPermissions`, the existing `AccessTokenClaims` interface (both in `token.service.ts`), `staffUser.role.name` (already loaded wherever `buildStaffClaims`/`resolveStaffRoleLocation` run — no new Prisma query needed).
- Produces: `AccessTokenClaims` gains `roleName?: string` (optional — absent for `subjectType: 'ACCOUNT'` patient tokens, present for `subjectType: 'STAFF'` tokens). `TokenService.buildStaffClaims` (private, used by `rotateRefreshToken`) sets `roleName: staffUser.role.name` alongside the existing `permissions`/`staffUserLocationId` fields. `AuthService.resolveStaffRoleLocation`'s call to `this.tokenService.issueAccessToken(...)` (the final-tokens branch) likewise adds `roleName: staffUser.role.name`.

- [ ] **Step 1: Write the failing tests**

Note on test placement: this file's `decode()` helper (`tokenService['jwt'].decode(...)`) is currently defined locally inside the nested `describe('POST /auth/refresh for a STAFF subject', ...)` block, so it isn't in scope for a test placed in the outer describe block. Move `decode()` up to the outer `describe('Staff role/location resolution (e2e)', ...)` scope (alongside `createStaffUser`/`loginAndGetSessionToken`) so both new tests below can use it; delete the now-redundant inner copy.

```ts
// apps/api/test/auth.role-location.spec.ts — place the first test alongside
// the other final-tokens assertions in the outer describe block; place the
// second inside the existing "POST /auth/refresh for a STAFF subject" block
// (it can reuse that block's existing `signInFully` helper).
it('includes the staff user\'s role name in the final access token', async () => {
  const staffUser = await createStaffUser(); // existing helper in this file
  await prisma.staffUserLocation.create({
    data: { staffUserId: staffUser.id, locationId: locations[0].id },
  });
  const sessionToken = await loginAndGetSessionToken(staffUser);

  const response = await request(app.getHttpServer())
    .post('/auth/staff/role-location')
    .send({ sessionToken });

  expect(response.status).toBe(200);
  const decoded = decode(response.body.accessToken);
  const role = await prisma.role.findUniqueOrThrow({ where: { id: staffUser.roleId } });
  expect(decoded.roleName).toBe(role.name);
});

it('keeps the role name after a refresh-token rotation', async () => {
  const staffUser = await createStaffUser();
  await prisma.staffUserLocation.create({
    data: { staffUserId: staffUser.id, locationId: locations[0].id },
  });
  const { refreshToken } = await signInFully(staffUser); // existing helper in this block

  const refreshResponse = await request(app.getHttpServer())
    .post('/auth/refresh')
    .send({ refreshToken });

  expect(refreshResponse.status).toBe(200);
  const decoded = decode(refreshResponse.body.accessToken);
  const role = await prisma.role.findUniqueOrThrow({ where: { id: staffUser.roleId } });
  expect(decoded.roleName).toBe(role.name);
});
```

- [ ] **Step 2: Run tests to verify they fail** (`decoded.roleName` is `undefined` today).

- [ ] **Step 3: Implement the claim addition.** Add `roleName?: string` to the `AccessTokenClaims` interface in `token.service.ts`. In `buildStaffClaims`, add `roleName: staffUser.role.name` to the returned object. In `auth.service.ts`'s `resolveStaffRoleLocation`, add `roleName: staffUser.role.name` to the `issueAccessToken` call's argument.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Run the full `apps/api` suite once** (this touches shared claim-building code used by Tasks 3/4/5 of the prior plan).

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/auth/token.service.ts apps/api/src/auth/auth.service.ts apps/api/test/auth.role-location.spec.ts
git commit -m "feat: include staff role name in the access token claims"
```

---

### Task 3: Frontend — extract the JWT decoder and add an identity hook

**Files:**
- Create: `apps/web/src/lib/jwt.ts`
- Create: `apps/web/src/lib/__tests__/jwt.test.ts`
- Modify: `apps/web/src/lib/use-permission.ts`
- Create: `apps/web/src/lib/use-account-identity.ts`
- Create: `apps/web/src/lib/__tests__/use-account-identity.test.ts`

**Interfaces:**
- Consumes: `authStorage.getAccessToken()` (existing, `apps/web/src/lib/auth-storage.ts`).
- Produces:
  - `apps/web/src/lib/jwt.ts` exports `decodeJwtPayload<T>(token: string): T | null` — the exact base64url-decode implementation currently private inside `use-permission.ts` (move it verbatim, generalize its return type from the hardcoded `{ permissions?: unknown }` shape to a generic `T`).
  - `use-permission.ts`'s `usePermission` is otherwise unchanged, just imports `decodeJwtPayload` from `./jwt` instead of defining it locally, and calls it as `decodeJwtPayload<{ permissions?: unknown }>(token)`.
  - `apps/web/src/lib/use-account-identity.ts` exports:
    ```ts
    export interface AccountIdentity {
      subjectType: 'ACCOUNT' | 'STAFF';
      roleName: string | null; // null for ACCOUNT (patient); the role name string for STAFF
    }
    export function useAccountIdentity(): AccountIdentity | null; // null when there's no stored access token, or it's malformed
    ```
    Decodes `{ subjectType: unknown; roleName?: unknown }` from the stored access token via `decodeJwtPayload`; returns `null` if there's no token, the token is malformed, or `subjectType` isn't exactly `'ACCOUNT'` or `'STAFF'`. For `subjectType === 'STAFF'`, `roleName` is the decoded string if present, else `null` (don't throw on a missing claim — treat it the same as not having one yet). Same UI-convenience-only framing as `usePermission` — add the same one-line doc comment.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/__tests__/jwt.test.ts
it('decodes a well-formed JWT payload', () => { /* build a token with 3 base64url segments, decode, assert the payload object */ });
it('returns null for a token that is not 3 dot-separated segments', () => { expect(decodeJwtPayload('not-a-jwt')).toBeNull(); });
it('returns null for a payload segment that is not valid JSON', () => { /* malformed base64/JSON middle segment -> null, no throw */ });

// apps/web/src/lib/__tests__/use-account-identity.test.ts
it('returns null when there is no stored access token', () => { /* authStorage cleared */ });
it('returns {subjectType: "ACCOUNT", roleName: null} for a patient access token', () => { /* stub a token with subjectType ACCOUNT, no roleName */ });
it('returns {subjectType: "STAFF", roleName: "Doctors"} for a staff access token carrying that claim', () => { /* stub a token with subjectType STAFF, roleName "Doctors" */ });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `jwt.ts` (moving the existing decode logic out of `use-permission.ts`), update `use-permission.ts`'s import, and implement `use-account-identity.ts`.**

- [ ] **Step 4: Run tests to verify they pass, plus the existing `use-permission.test.ts` (unchanged behavior, just a refactor) to confirm no regression.**

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/lib/jwt.ts apps/web/src/lib/__tests__/jwt.test.ts apps/web/src/lib/use-permission.ts apps/web/src/lib/use-account-identity.ts apps/web/src/lib/__tests__/use-account-identity.test.ts
git commit -m "feat: extract shared JWT decoder, add useAccountIdentity hook"
```

---

### Task 4: Frontend — unified sign-in page, replacing the two separate ones

**Files:**
- Create: `apps/web/src/features/auth/sign-in.page.tsx`
- Create: `apps/web/src/features/auth/__tests__/sign-in.test.tsx`
- Delete: `apps/web/src/features/auth/patient-sign-in.page.tsx`
- Delete: `apps/web/src/features/auth/staff-sign-in.page.tsx`
- Delete: `apps/web/src/features/auth/__tests__/patient-sign-in.test.tsx`
- Delete: `apps/web/src/features/auth/__tests__/staff-sign-in.test.tsx`

**Interfaces:**
- Consumes: `requestOtp`, `staffLogin`, `resolveRoleLocation`, `StaffRoleLocationOptions` (all existing, `./auth.api`), `authStorage.setTokens` (existing, `../../lib/auth-storage`), `ApiError` (existing, `../../lib/api-client`).
- Produces: `<SignInPage />`. Internal state: `mode: 'identify' | 'password'` (starts `'identify'`), `identifier: string` (the single text input's value), `password: string`, `error: string | null`, `submitting: boolean`.
  - **`mode === 'identify'`**: renders one labeled text input ("Phone or email") and a submit button. On submit: if `identifier.includes('@')`, set `mode` to `'password'` and return (no API call — just reveals the password field; this is the one-interface staff branch). Otherwise (phone path): call `requestOtp(identifier)` exactly as the old `PatientSignInPage` did, and on success `navigate('/enter-code', { state: { requestId, phone: identifier } })` — identical behavior/shape to the deleted page.
  - **`mode === 'password'`**: renders the identifier (read-only or re-editable, implementer's choice) plus a password input, submit button labeled e.g. "Sign in". On submit: call `staffLogin(identifier, password)` and reproduce the exact branching the deleted `StaffSignInPage` had — `requiresTwoStep` → `navigate('/staff/two-step', { state: { sessionToken, email: identifier } })`; otherwise call `resolveRoleLocation(sessionToken)`, and if the result has an `options` key → `navigate('/staff/choose-role-location', { state: { sessionToken, options } })`, else `authStorage.setTokens(result); navigate('/staff/dashboard', { replace: true })`.
  - Both branches show `error` via the same `role="alert"` pattern the deleted pages used, and disable the submit button while `submitting`.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/features/auth/__tests__/sign-in.test.tsx
it('treats a phone-shaped identifier as the patient path: calls requestOtp and navigates to enter-code with the requestId', async () => { /* type "+15551234567", submit once, assert requestOtp called, assert navigation state carries the mocked requestId (same pattern as the deleted patient-sign-in test) */ });

it('treats an email-shaped identifier as the staff path: reveals a password field without calling any API', async () => { /* type "nurse@example.com", submit, assert staffLoginMock was NOT called, assert a password input is now present */ });

it('after entering password, single-role/no-2FA staff login goes straight to the dashboard', async () => { /* email -> reveal password -> type password -> submit; mock staffLogin returning requiresTwoStep:false, mock resolveRoleLocation returning final tokens; assert authStorage.setTokens called and navigation to /staff/dashboard */ });

it('after entering password, requiresTwoStep navigates to /staff/two-step with the session token', async () => { /* mock staffLogin returning requiresTwoStep:true; assert navigation state carries sessionToken and the typed email */ });

it('shows an inline error and does not navigate when staffLogin rejects (wrong password)', async () => { /* mock staffLogin rejecting with ApiError(401, ...); assert alert shown, no navigation */ });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `sign-in.page.tsx`**, porting the exact logic from the two deleted pages as described in Interfaces above. Delete `patient-sign-in.page.tsx`, `staff-sign-in.page.tsx`, and their two test files.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit.**

```bash
git add -A apps/web/src/features/auth
git commit -m "feat: unify patient and staff sign-in into one entry page"
```

---

### Task 5: Frontend — wire the new route, show the detected identity on landing

**Files:**
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `<SignInPage />` (Task 4), `useAccountIdentity` (Task 3).
- Produces: `App.tsx`'s route table replaces the two old routes (`/sign-in` → `PatientSignInPage`, `/staff/sign-in` → `StaffSignInPage`) with a single `/sign-in` → `<SignInPage />` route; all other existing routes (`/enter-code`, `/staff/two-step`, `/staff/choose-role-location`, `/staff/dashboard`, `/`) are unchanged in path. The inline `BookingHomePage` and `StaffDashboardPage` placeholder components both call `useAccountIdentity()` and render a line stating the detected identity: for `BookingHomePage`, "You're signed in as: Patient" when identity is non-null with `subjectType === 'ACCOUNT'` (and the existing placeholder content otherwise, e.g. when there's no session yet); for `StaffDashboardPage`, "You're signed in as: {roleName}" when `subjectType === 'STAFF'` and `roleName` is non-null.

- [ ] **Step 1: Update `App.tsx`**: change the import from `PatientSignInPage`/`StaffSignInPage` to `SignInPage`, collapse the two routes into one `/sign-in` route, and add the `useAccountIdentity()`-driven label to both placeholder components as described above.

- [ ] **Step 2: Run the full `apps/web` test suite** to confirm nothing else referenced the deleted routes/components (none of the existing test files should import `PatientSignInPage`/`StaffSignInPage` directly after Task 4's deletions — this step is the cross-check that nothing was missed).

- [ ] **Step 3: Commit.**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: route to the unified sign-in page, label landing pages with detected identity"
```
