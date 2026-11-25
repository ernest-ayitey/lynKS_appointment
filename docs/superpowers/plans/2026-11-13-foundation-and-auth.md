# Foundation & Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, core database schema, and authentication/RBAC
system that every other part of the clinic scheduling app depends on: patient
passwordless login, staff password + optional 2-step + role/location login,
and permission enforcement.

**Architecture:** A NestJS API (`apps/api`) backed by MySQL via Prisma, and a
React + Vite SPA (`apps/web`). Auth issues short-lived JWT access tokens
carrying a flattened permission list plus rotating refresh tokens. Staff
login is a 3-stage state machine (password → optional 2-step → role/location
resolution) driven by a single short-lived "session token" that accumulates
claims as the staff member clears each stage, matching screens `1.4`–`1.6`.
Patient login is phone + OTP, matching `1.1`–`1.2`.

**Tech Stack:** NestJS, Prisma, MySQL, Redis (for OTP/session token storage
only in this plan), React, Vite, TypeScript, Vitest + React Testing Library,
Jest + Supertest.

**Spec:** `docs/superpowers/specs/2026-11-13-clinic-scheduling-design.md`

## Global Constraints

- Single clinic deployment — no multi-tenant fields or isolation logic.
- MySQL via Prisma ORM (per spec's "Decided" section).
- JWT access + refresh tokens for auth (per spec).
- No hard deletion anywhere — deactivation is soft-delete that anonymizes
  personal fields but keeps audit trail and history (per spec's "Data
  retention / deletion").
- Staff 2-step check uses SMS OTP, reusing the same OTP infrastructure as
  patient login (per spec) — not a TOTP app.
- Per-role permissions are admin-configurable toggles (e.g. "see patient
  contact details," "read clinical notes"), not hardcoded per-role logic
  (per mockup `6.1`).
- A staff member with exactly one role and one location skips the
  role/location picker entirely (explicit mockup footnote on `1.6`).

## Review Focus

- **Reused/replayed OTP code** — a code already consumed must not verify a
  second time, even if resubmitted before it expires. Covered in Task 2.
- **OTP brute-forcing** — repeated wrong-code submissions against one
  request must lock out after a fixed number of attempts rather than allow
  unlimited guessing. Covered in Task 2.
- **Deactivated staff account logging in** — a soft-deleted staff user must
  be rejected at the password-login step, not merely hidden from the Users
  list. Covered in Task 3.
- **A permission toggle set to "No" must block the API, not just hide a
  button** — e.g. a role without `clinical_notes.read` must get a 403 from
  a protected endpoint directly, independent of any frontend hiding.
  Covered in Task 5.
- **Single role/location staff must never see the picker** — a staff user
  with exactly one `StaffUserLocation` row must receive final tokens
  directly from role/location resolution, never an "options" response.
  Covered in Task 4.

---

## File Structure

```
docker-compose.yml                         # MySQL + Redis for local dev
apps/api/
  prisma/schema.prisma
  prisma/seed.ts
  src/main.ts
  src/app.module.ts
  src/health/health.controller.ts
  src/prisma/prisma.service.ts
  src/prisma/prisma.module.ts
  src/auth/auth.module.ts
  src/auth/auth.service.ts
  src/auth/auth.controller.ts
  src/auth/otp.service.ts
  src/auth/token.service.ts
  src/auth/dto/*.dto.ts
  src/auth/strategies/jwt.strategy.ts
  src/auth/guards/jwt-auth.guard.ts
  src/auth/guards/permissions.guard.ts
  src/auth/decorators/require-permission.decorator.ts
  src/auth/decorators/current-user.decorator.ts
  src/audit/audit.module.ts
  src/audit/audit.service.ts
  test/**/*.spec.ts
apps/web/
  src/main.tsx
  src/App.tsx
  src/lib/api-client.ts
  src/lib/auth-storage.ts
  src/lib/use-permission.ts
  src/features/auth/patient-sign-in.page.tsx
  src/features/auth/enter-code.page.tsx
  src/features/auth/staff-sign-in.page.tsx
  src/features/auth/staff-two-step.page.tsx
  src/features/auth/choose-role-location.page.tsx
  src/features/auth/auth.api.ts
  src/features/auth/__tests__/*.test.tsx
```

---

### Task 1: Monorepo scaffolding, database schema, and seed data

**Files:**
- Create: `docker-compose.yml`
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/seed.ts`
- Create: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/prisma/prisma.module.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Test: `apps/api/test/health.spec.ts`, `apps/api/test/seed.spec.ts`

**Interfaces:**
- Produces: `PrismaService` (injectable, extends `PrismaClient`) used by every
  later task to access the DB.
- Produces Prisma models (exact fields other tasks rely on):
  - `Clinic { id, name, timezone }`
  - `Location { id, clinicId, name }`
  - `Role { id, name, isSystemDefault }`
  - `Permission { id, key }` — `key` is a stable string like
    `"clinical_notes.read"`, `"patients.contact_details.read"`,
    `"doctors.hours.manage"`, `"cancellation_fees.override"`,
    `"bookings.manage"`.
  - `RolePermission { id, roleId, permissionId, allowed: Boolean }`
  - `StaffUser { id, name, email, passwordHash, roleId, twoStepEnabled: Boolean, deactivatedAt: DateTime? }`
  - `StaffUserLocation { id, staffUserId, locationId }`
  - `Account { id, phone, email: String?, deactivatedAt: DateTime? }`
  - `PatientProfile { id, accountId, firstName, lastName, dateOfBirth, relationship: "SELF" | "CHILD" | "DEPENDENT" }`
  - `OtpCode { id, destination, purpose: "PATIENT_LOGIN" | "STAFF_TWO_STEP", codeHash, expiresAt, consumedAt: DateTime?, attempts: Int }`
  - `RefreshToken { id, subjectType: "ACCOUNT" | "STAFF", subjectId, tokenHash, expiresAt, revokedAt: DateTime? }`
  - `AuditLog { id, actorType, actorId: String?, action, entityType, entityId, metadata: Json?, createdAt }`
- Seed produces: one `Clinic`, two `Location` rows named `"Airport branch"`
  and `"Osu clinic"` (matching the mockups), four `Role` rows
  (`"Doctor"`, `"Front desk"`, `"Dental assistant"`, `"Clinic admin"`), and
  the `Permission` rows listed above with a default `RolePermission` matrix
  (Clinic admin: all allowed; Doctor: clinical_notes.read +
  doctors.hours.manage allowed, others not; Front desk: bookings.manage +
  patients.contact_details.read allowed, clinical_notes.read not, matching
  `6.1`'s example).

- [ ] **Step 1: Scaffold `apps/api` (NestJS) and `apps/web` (Vite + React + TS) with their package.json/tsconfig, and a root `docker-compose.yml` with `mysql:8` and `redis:7` services.**

- [ ] **Step 2: Write `apps/api/prisma/schema.prisma` with the models listed in Interfaces above, using MySQL as the datasource.**

- [ ] **Step 3: Run `npx prisma migrate dev --name init` and verify it succeeds against the dockerized MySQL.**

Run: `docker compose up -d mysql && npx prisma migrate dev --name init`
Expected: migration applies with no errors, `prisma/migrations/` contains the new migration.

- [ ] **Step 4: Write `apps/api/prisma/seed.ts` implementing the seed data above, and a `PrismaService`/`PrismaModule` wrapping `PrismaClient` with `onModuleInit`/`onModuleDestroy` lifecycle hooks.**

- [ ] **Step 5: Write the failing tests**

```ts
// apps/api/test/health.spec.ts
it('GET /health returns 200 and { status: "ok" }', async () => { ... });

// apps/api/test/seed.spec.ts
it('seeds exactly 2 locations and 4 roles', async () => {
  const locations = await prisma.location.findMany();
  const roles = await prisma.role.findMany();
  expect(locations).toHaveLength(2);
  expect(roles.map(r => r.name).sort()).toEqual(
    ['Clinic admin', 'Dental assistant', 'Doctor', 'Front desk']
  );
});
```

- [ ] **Step 6: Run tests to verify they fail** (health controller and seed don't exist yet).

- [ ] **Step 7: Implement `HealthController` (`GET /health` → `{ status: 'ok' }`) and run the seed script.**

Run: `npx ts-node apps/api/prisma/seed.ts`

- [ ] **Step 8: Run tests to verify they pass.**

- [ ] **Step 9: Commit.**

```bash
git add docker-compose.yml apps/api apps/web
git commit -m "feat: scaffold monorepo, db schema, and seed data"
```

---

### Task 2: Patient OTP login, refresh, and logout

**Files:**
- Create: `apps/api/src/auth/otp.service.ts`
- Create: `apps/api/src/auth/token.service.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/dto/request-otp.dto.ts`, `verify-otp.dto.ts`, `refresh.dto.ts`
- Modify: `apps/api/src/app.module.ts` (register `AuthModule`)
- Test: `apps/api/test/auth.patient.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 1).
- Produces:
  - `OtpService.generate(destination: string, purpose: 'PATIENT_LOGIN' | 'STAFF_TWO_STEP'): Promise<{ requestId: string, expiresAt: Date }>`
  - `OtpService.verify(requestId: string, code: string): Promise<boolean>` —
    enforces single-use (`consumedAt` set after success) and a max of 5
    attempts per `requestId` before further calls always return `false`.
  - `TokenService.issueAccessToken(claims: { sub: string, subjectType: 'ACCOUNT' | 'STAFF', permissions: string[], staffUserLocationId?: string }): string`
  - `TokenService.issueRefreshToken(subjectType, subjectId): Promise<string>` (persists hashed token in `RefreshToken`)
  - `TokenService.rotateRefreshToken(rawToken: string): Promise<{ accessToken: string, refreshToken: string } | null>` (null if invalid/expired/revoked)
  - `POST /auth/patient/request-otp` body `{ phone: string }` → `{ requestId: string, expiresInSeconds: number }`
  - `POST /auth/patient/verify-otp` body `{ requestId: string, code: string }` → `{ accessToken: string, refreshToken: string, accountId: string }` (creates the `Account` if `phone` is new)
  - `POST /auth/refresh` body `{ refreshToken: string }` → `{ accessToken: string, refreshToken: string }` or 401
  - `POST /auth/logout` body `{ refreshToken: string }` → 204, revokes the token

- [ ] **Step 1: Write the failing tests**

```ts
it('creates a new Account on first-ever verify-otp for a phone number', async () => { ... });
it('rejects verify-otp with the wrong code', async () => { ... });
it('rejects verify-otp reusing an already-consumed code', async () => {
  // consume once successfully, then try the same requestId+code again -> 401
});
it('rejects verify-otp after 5 wrong attempts even with the correct code', async () => { ... });
it('rotates refresh tokens and rejects a reused (already-rotated) refresh token', async () => { ... });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `OtpService`, `TokenService`, `AuthService`, `AuthController`.** Store OTP codes hashed (e.g. bcrypt or HMAC with a server secret), never plaintext. 6-digit numeric code, 10-minute expiry.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/auth apps/api/test/auth.patient.spec.ts
git commit -m "feat: patient OTP login, refresh, and logout"
```

---

### Task 3: Staff password login + 2-step verification

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/token.service.ts`
- Create: `apps/api/src/auth/dto/staff-login.dto.ts`, `staff-two-step-verify.dto.ts`
- Test: `apps/api/test/auth.staff-login.spec.ts`

**Interfaces:**
- Consumes: `OtpService`, `TokenService` (Task 2).
- Produces:
  - A "session token" JWT (short-lived, 10 min) with payload
    `{ staffUserId: string, twoStepVerified: boolean }`, issued by
    `TokenService.issueSessionToken(payload)` and read by
    `TokenService.verifySessionToken(token): payload | null`.
  - `POST /auth/staff/login` body `{ email: string, password: string }` →
    `{ sessionToken: string, requiresTwoStep: boolean }`, or 401 for a
    wrong password, or 403 for a deactivated (`deactivatedAt` set) staff
    user. `requiresTwoStep` reflects that staff user's `twoStepEnabled`
    flag.
  - `POST /auth/staff/two-step/request` body `{ sessionToken: string }` →
    triggers `OtpService.generate` against the staff user's phone, returns
    `{ requestId: string }`.
  - `POST /auth/staff/two-step/verify` body `{ sessionToken: string, requestId: string, code: string }` →
    `{ sessionToken: string }` with `twoStepVerified: true`, or 401.

- [ ] **Step 1: Write the failing tests**

```ts
it('rejects login for a deactivated staff user with 403', async () => { ... });
it('returns requiresTwoStep: true for a staff user with twoStepEnabled', async () => { ... });
it('returns requiresTwoStep: false for a staff user without it', async () => { ... });
it('two-step/verify rejects a session token that was not produced by a matching login', async () => { ... });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement the login, two-step/request, and two-step/verify handlers.**

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/auth apps/api/test/auth.staff-login.spec.ts
git commit -m "feat: staff password login and 2-step verification"
```

---

### Task 4: Staff role/location resolution

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/dto/select-role-location.dto.ts`
- Test: `apps/api/test/auth.role-location.spec.ts`

**Interfaces:**
- Consumes: session token from Task 3, `TokenService.issueAccessToken`/`issueRefreshToken` from Task 2.
- Produces:
  - `POST /auth/staff/role-location` body `{ sessionToken: string, staffUserLocationId?: string }`.
    - Rejects with 401 if the staff user has `twoStepEnabled: true` and the
      session token's `twoStepVerified` is not `true`.
    - Loads that staff user's `StaffUserLocation[]` joined with `Role`/`Location`.
    - If exactly one row exists: ignores `staffUserLocationId` and returns
      final tokens directly: `{ accessToken: string, refreshToken: string }`.
    - If more than one row exists and `staffUserLocationId` is omitted:
      returns `{ options: { staffUserLocationId: string, roleName: string, locationName: string }[] }`.
    - If more than one row exists and `staffUserLocationId` is provided and
      belongs to that staff user: returns final tokens, with the access
      token's `staffUserLocationId` claim set accordingly.
    - Returns 400 if `staffUserLocationId` doesn't belong to the staff user.

- [ ] **Step 1: Write the failing tests**

```ts
it('returns final tokens directly when the staff user has exactly one role/location', async () => { ... });
it('returns an options list when the staff user has more than one role/location and none was chosen', async () => { ... });
it('returns final tokens scoped to the chosen staffUserLocationId when provided', async () => { ... });
it('rejects role-location resolution if two-step is required but not verified on the session token', async () => { ... });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement the handler.**

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/auth apps/api/test/auth.role-location.spec.ts
git commit -m "feat: staff role/location resolution, auto-skip for single-role staff"
```

---

### Task 5: Permission guard and decorator

**Files:**
- Create: `apps/api/src/auth/strategies/jwt.strategy.ts`
- Create: `apps/api/src/auth/guards/jwt-auth.guard.ts`
- Create: `apps/api/src/auth/guards/permissions.guard.ts`
- Create: `apps/api/src/auth/decorators/require-permission.decorator.ts`
- Create: `apps/api/src/auth/decorators/current-user.decorator.ts`
- Modify: `apps/api/src/auth/auth.module.ts` (register `JwtStrategy`, export guards)
- Test: `apps/api/test/auth.permissions-guard.spec.ts`

**Interfaces:**
- Consumes: access token shape from Task 2 (`permissions: string[]` claim).
- Produces:
  - `@RequirePermission(key: string)` method decorator storing metadata.
  - `PermissionsGuard` (Nest `CanActivate`) reading that metadata and
    `request.user.permissions`, returning `true` only if the key is present;
    throws `ForbiddenException` otherwise.
  - `@CurrentUser()` param decorator returning the decoded JWT payload.
  - Access token's `permissions` claim is computed at issuance by flattening
    that staff user's `RolePermission` rows where `allowed = true` into
    `permission.key` strings (patients get an empty `permissions: []`).

- [ ] **Step 1: Write the failing tests** (using a throwaway test controller with one `@RequirePermission('clinical_notes.read')` endpoint)

```ts
it('allows a request whose JWT permissions include the required key', async () => { ... });
it('returns 403 for a request whose JWT permissions do not include the required key, even for an authenticated staff user', async () => { ... });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `JwtStrategy`, `JwtAuthGuard`, `PermissionsGuard`, `RequirePermission`, `CurrentUser`.**

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/auth
git commit -m "feat: JWT auth guard and per-permission RBAC enforcement"
```

---

### Task 6: Audit log service

**Files:**
- Create: `apps/api/src/audit/audit.module.ts`
- Create: `apps/api/src/audit/audit.service.ts`
- Modify: `apps/api/src/app.module.ts` (register `AuditModule`)
- Test: `apps/api/test/audit.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 1), `AuditLog` model.
- Produces: `AuditService.record(entry: { actorType: 'ACCOUNT' | 'STAFF' | 'SYSTEM', actorId: string | null, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown> }): Promise<void>` — later plans (deactivation, cancellations, refunds) call this directly; it does not derive entries automatically from requests in this plan.

- [ ] **Step 1: Write the failing test**

```ts
it('persists an AuditLog row with the given actor, action, entity, and metadata', async () => { ... });
```

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement `AuditService.record`.**

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/audit
git commit -m "feat: audit log service"
```

---

### Task 7: Frontend — patient sign-in and enter-code

**Files:**
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/auth-storage.ts`
- Create: `apps/web/src/features/auth/auth.api.ts`
- Create: `apps/web/src/features/auth/patient-sign-in.page.tsx`
- Create: `apps/web/src/features/auth/enter-code.page.tsx`
- Test: `apps/web/src/features/auth/__tests__/patient-sign-in.test.tsx`, `enter-code.test.tsx`

**Interfaces:**
- Consumes: `POST /auth/patient/request-otp`, `POST /auth/patient/verify-otp` (Task 2).
- Produces:
  - `apiClient.post<T>(path: string, body: unknown): Promise<T>` throwing
    `ApiError { status: number, message: string }` on non-2xx responses.
  - `authStorage.setTokens({ accessToken, refreshToken }): void`,
    `authStorage.getAccessToken(): string | null`.
  - `requestOtp(phone: string): Promise<{ requestId: string, expiresInSeconds: number }>`
  - `verifyOtp(requestId: string, code: string): Promise<{ accessToken: string, refreshToken: string, accountId: string }>`
  - `<PatientSignInPage />` matching `ui/1.1 Patient · Sign in.png`: a phone
    input and submit button that calls `requestOtp` and navigates to the
    enter-code screen with the returned `requestId`.
  - `<EnterCodePage />` matching `ui/1.2 Patient · Enter code.png`: a code
    input that calls `verifyOtp`, stores tokens via `authStorage`, and shows
    an inline error on 401.

- [ ] **Step 1: Write the failing tests**

```tsx
it('submits the phone number and navigates to enter-code with the returned requestId', async () => { ... });
it('shows an inline error and does not navigate when verifyOtp rejects with 401', async () => { ... });
it('stores tokens and navigates to the booking home on successful verifyOtp', async () => { ... });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `api-client.ts`, `auth-storage.ts`, `auth.api.ts`, and both page components**, styled per the referenced mockups.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src
git commit -m "feat: patient OTP sign-in UI"
```

---

### Task 8: Frontend — staff sign-in, 2-step, and role/location picker

**Files:**
- Create: `apps/web/src/features/auth/staff-sign-in.page.tsx`
- Create: `apps/web/src/features/auth/staff-two-step.page.tsx`
- Create: `apps/web/src/features/auth/choose-role-location.page.tsx`
- Modify: `apps/web/src/features/auth/auth.api.ts`
- Test: `apps/web/src/features/auth/__tests__/staff-sign-in.test.tsx`, `staff-two-step.test.tsx`, `choose-role-location.test.tsx`

**Interfaces:**
- Consumes: `POST /auth/staff/login`, `/two-step/request`, `/two-step/verify`, `/role-location` (Tasks 3–4).
- Produces: `staffLogin`, `requestStaffTwoStep`, `verifyStaffTwoStep`, `resolveRoleLocation` functions in `auth.api.ts` with signatures mirroring those endpoints.
  - `<StaffSignInPage />` matching `ui/1.4 Staff · Sign in (web).png`: on
    success with `requiresTwoStep: false` and final tokens already present
    (single role/location, no 2-step), stores tokens and navigates directly
    to the dashboard — otherwise navigates to the 2-step or role/location
    step as appropriate.
  - `<StaffTwoStepPage />` matching `ui/1.5 Staff · 2-step check.png`.
  - `<ChooseRoleLocationPage />` matching `ui/1.6 Staff · Choose role and location.png`,
    rendering the `options` list and calling `resolveRoleLocation` with the
    chosen `staffUserLocationId`; this page must never render for a staff
    user whose login response already contained final tokens.

- [ ] **Step 1: Write the failing tests**

```tsx
it('navigates straight to the dashboard when login returns final tokens (single role/location, no 2-step)', async () => { ... });
it('navigates to the 2-step screen when requiresTwoStep is true', async () => { ... });
it('navigates to the role/location picker when two-step verify returns an options list', async () => { ... });
it('submits the chosen staffUserLocationId and stores the resulting tokens', async () => { ... });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement the three pages and the `auth.api.ts` additions.**

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src
git commit -m "feat: staff sign-in, 2-step check, and role/location picker UI"
```

---

### Task 9: Frontend session plumbing — token refresh and permission-aware routing

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/use-permission.ts`
- Create: `apps/web/src/lib/require-auth.tsx`
- Test: `apps/web/src/lib/__tests__/api-client.test.ts`, `use-permission.test.ts`

**Interfaces:**
- Consumes: `POST /auth/refresh` (Task 2), the JWT `permissions` claim shape (Task 5), `authStorage` (Task 7).
- Produces:
  - `apiClient` transparently retries a single request once after a 401 by
    calling `/auth/refresh` and updating stored tokens; if refresh also
    fails, it clears tokens and rejects with `ApiError { status: 401 }`.
  - `usePermission(key: string): boolean` — decodes the stored access
    token's `permissions` claim and checks membership. This is a UI
    convenience only (hide/disable an action); it is never the security
    boundary, which is `PermissionsGuard` on the server (Task 5).
  - `<RequireAuth>{children}</RequireAuth>` route wrapper redirecting to the
    appropriate sign-in page when there is no valid access token.

- [ ] **Step 1: Write the failing tests**

```ts
it('retries once via /auth/refresh after a 401 and succeeds with the new access token', async () => { ... });
it('clears stored tokens and surfaces the 401 if /auth/refresh also fails', async () => { ... });
it('usePermission returns false for a key not present in the decoded token claims', () => { ... });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement the refresh-retry logic, `usePermission`, and `RequireAuth`.**

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/lib
git commit -m "feat: token refresh retry and permission-aware route guard"
```
