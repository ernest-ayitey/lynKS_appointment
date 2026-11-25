# Frontend Foundation & Auth UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a fresh Vite + React + TypeScript SPA (`apps/web`, replacing
the old OTP-based frontend entirely) with routing, a cookie-aware typed API
client, and the auth screens (Login, Register, Forgot/Reset password, forced
Change password) wired against the already-built, merged Sinatra auth API.

**Architecture:** React Router for routing; a single `AuthContext` holding
the access token in memory and the current user in state, backed by an
`apiRequest` primitive that always sends `credentials: 'include'` so the
`HttpOnly` refresh cookie travels automatically; a `refresh-once-on-401`
retry wrapper (`authedFetch`) living in the context, mirroring the backend's
own one-shot-rotation design. React Hook Form for every form. TanStack Query
only where it earns its keep: the register page's live username-availability
check. Tailwind for styling. Vitest + Testing Library, matching this repo's
existing frontend test convention.

Pages are built standalone, each driven by a mocked `useAuth()` in its own
tests, and wired into real routes only in the final task — so no page task
depends on the routing shell existing yet, only the reverse.

**Tech Stack:** TypeScript, Vite, React 19, React Router, @tanstack/react-query,
react-hook-form, Tailwind CSS, Vitest, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-11-23-clinic-appointment-rewrite-design.md`
(API surface, screens→routes) and
`docs/superpowers/specs/2026-11-23-clinic-appointment-screen-specs.md`
(section "1 · Login & Registration" for exact field lists/copy).

**Builds on:** the merged `apps/api` from
`docs/superpowers/plans/2026-11-23-backend-foundation-and-auth.md` — every
endpoint this plan calls already exists, is tested, and its exact response
shapes are reproduced below rather than re-derived.

## Backend contract this plan calls (verified against the merged `apps/api/app/routes/auth.rb`)

All responses share one error envelope: `{"error": "<message>"}` or
`{"error": "<message>", "errors": {"<field>": "<message>"}}` (the `errors`
key only appears for field-level validation failures). All success/field
names are snake_case, exactly as shown — no camelCasing when mapping to
TypeScript types.

- `POST /api/v1/auth/login` `{username, password, remember_me?}` → 200
  `{access_token, must_change_password, user: {id, username, role,
  first_name, last_name}}`. 401 (wrong credentials), 423 (locked — same
  message, whether this attempt trips the lock or a later one), 403
  (deactivated).
- `POST /api/v1/auth/refresh` — no body, relies on the `refresh_token`
  cookie → 200 `{access_token}` (no `user`/`must_change_password` — see
  Task 3's handling of this). 401 if missing/invalid/expired/revoked.
- `POST /api/v1/auth/logout` — requires `Authorization: Bearer <token>` →
  204 no body. 401 if unauthenticated.
- `GET /api/v1/auth/username-availability?username=` → 200
  `{available: boolean}`. 422 `{error, errors: {username}}` for a
  malformed username.
- `POST /api/v1/auth/register`
  `{first_name, last_name, date_of_birth, gender, email, phone, username,
  password, password_confirmation, accept_terms}` → 201 (same session
  shape as login). 422 with per-field `errors` (username/password/
  password_confirmation/email/first_name/last_name/phone/gender/
  date_of_birth/accept_terms — any subset, whichever failed).
- `POST /api/v1/auth/password/forgot` `{username}` → always 200
  `{message}` (identical whether or not the username exists — never
  branch the UI on this).
- `POST /api/v1/auth/password/reset` `{token, password,
  password_confirmation}` → 200 (same session shape as login). 422
  (invalid/expired link, or `errors` for password/confirmation), 403
  (deactivated account).
- `POST /api/v1/auth/password/change` — requires `Authorization: Bearer
  <token>` → `{current_password, password, password_confirmation}` → 200
  (same session shape as login — a fresh access token + rotated cookie,
  so the caller's own session survives). 422 (`errors` for
  current_password/password/password_confirmation). 401 if
  unauthenticated.

## Global Constraints

- The access token lives in memory only (`AuthContext` state) — never in
  `localStorage`/`sessionStorage`/anywhere persisted. Only a non-sensitive
  display profile (`id, username, role, first_name, last_name,
  must_change_password`) is cached in `sessionStorage` under one key, purely
  so the UI can render instantly across a reload while `/auth/refresh`
  confirms the session — the access token from that refresh call, not the
  cached JSON, is what every subsequent API call actually trusts.
- Every API call sends `credentials: 'include'`; the frontend never reads,
  stores, or forwards the refresh token itself — it only exists as the
  browser's own cookie jar entry.
- A 401 on any authenticated request triggers exactly one refresh-retry
  before surfacing the error; `/auth/refresh` itself is never retried.
- Dev target: the Sinatra API runs via `bundle exec rackup -p 3000` from
  `apps/api`; `vite.config.ts` proxies `/api` there, matching
  `FRONTEND_URL=http://localhost:5173` already set in `apps/api/.env`.
- `/auth/refresh`'s response has no `user`/`must_change_password` (a
  known, already-flagged gap in the merged backend — no `/me` endpoint
  exists yet), **and the backend's `authenticate!` never checks
  `must_change_password` on any route either** — it is enforced nowhere
  server-side. That makes the frontend's forced-change gate the *only*
  thing enforcing it, so it must fail closed: if `/auth/refresh` succeeds
  but there is no cached `user` (a fresh tab, a different browser, or a
  cleared `sessionStorage` with a still-valid "remember me" cookie), the
  frontend cannot tell whether that account owes a password change —
  silently rendering the authenticated app in that state (the earlier
  draft of this plan did exactly this) is a real bypass, not a cosmetic
  gap. This plan's call: on that specific case (refresh succeeds, no
  cached user), treat the session as `unauthenticated` and require a
  fresh login rather than guess. A normal same-tab session always has a
  cached `user` (set at login/register/reset/change time), so this only
  costs an extra login in the cross-tab/cold-restart case — acceptable
  until a future plan adds `/me` and this gate can check the real flag
  every time.

## Review Focus

- **Access token leaking into persisted storage** — `localStorage`,
  `sessionStorage`, or anywhere else the token itself (not the display
  profile) could end up, which would survive an XSS payload long after a
  page reload. Covered in Task 2/3.
- **Infinite refresh loop** — a 401 on `/auth/refresh` itself, or two
  back-to-back 401s on the same retried request, must fail cleanly rather
  than retry forever. Covered in Task 3.
- **`must_change_password` redirect bypassed** — either by typing `/` or
  any other protected path directly rather than clicking a nav link
  (covered in Task 8's `ProtectedRoute`), or by a cross-tab/cold-restart
  session that refreshes successfully but has no cached user profile to
  check the flag against — since the backend never enforces this flag
  itself, the frontend must fail closed to `unauthenticated` in that
  case rather than silently render the app with an unknown
  `must_change_password` state (covered in Task 3).
- **Stale "username available" result at submit time** — the live
  availability check and the register endpoint's own 422 on a
  since-taken username are two different checks; the second must still
  surface correctly even if the first said "available". Covered in
  Task 5.
- **Logout not clearing local state on a failed server call** — a
  network error on `POST /auth/logout` must not leave the UI showing an
  authenticated session the user explicitly asked to end. Covered in
  Task 3.

---

## File Structure

```
apps/web/
  package.json
  tsconfig.json
  tsconfig.app.json
  tsconfig.node.json
  vite.config.ts
  index.html
  .env.example
  src/
    main.tsx
    App.tsx
    index.css
    vite-env.d.ts
    lib/
      api-client.ts
      auth-context.tsx
      protected-route.tsx
    features/
      auth/
        auth.api.ts
        login.page.tsx
        register.page.tsx
        forgot-password.page.tsx
        reset-password.page.tsx
        change-password.page.tsx
        __tests__/
          login.page.test.tsx
          register.page.test.tsx
          forgot-password.page.test.tsx
          reset-password.page.test.tsx
          change-password.page.test.tsx
      dashboard/
        role-landing.page.tsx
    test/
      setup.ts
```

---

### Task 1: Fresh Vite + React + TS + Tailwind + Vitest scaffold

**Files:**
- Delete: everything currently under `apps/web/` (old OTP-based frontend —
  `src/App.tsx`, `src/features/auth/*`, `src/lib/*`, `src/test/*`,
  `src/main.tsx`, `src/vite-env.d.ts`, `package.json`, `tsconfig*.json`,
  `vite.config.ts`, `index.html`, `.env.example`)
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`,
  `apps/web/tsconfig.json`, `apps/web/tsconfig.app.json`,
  `apps/web/tsconfig.node.json`, `apps/web/index.html`,
  `apps/web/.env.example`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`,
  `apps/web/src/index.css`, `apps/web/src/vite-env.d.ts`,
  `apps/web/src/test/setup.ts`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Produces: a runnable `npm run dev` (Vite dev server on port 5173, API
  calls under `/api` proxied to `http://localhost:3000`) and `npm test`
  (Vitest).

- [ ] **Step 1: Delete the old frontend**

Run: `cd apps/web && rm -rf src package.json tsconfig*.json vite.config.ts index.html .env.example node_modules`

- [ ] **Step 2: Write `package.json`**

`"name": "@lynks/web"`, `"type": "module"`, scripts: `dev` (`vite`),
`build` (`tsc -b && vite build`), `preview`, `test` (`vitest run`).
Dependencies: `react`, `react-dom`, `react-router-dom`,
`@tanstack/react-query`, `react-hook-form`. Dev dependencies: `vite`,
`@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/react`,
`@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`,
`tailwindcss`, `@tailwindcss/vite`, `@types/react`, `@types/react-dom`.
The installed Tailwind major version is 4+ (confirmed in this
environment), which replaced the v3 `tailwind.config.js` +
`postcss.config.js` + `autoprefixer` model with a CSS-first one — no
config file, no separate PostCSS setup, no `autoprefixer` (built in).
Use the current model, not the v3 one: `@tailwindcss/vite`'s Vite plugin
and a single `@import "tailwindcss";` line in `index.css`, as Step 3/4
below specify.

- [ ] **Step 2: `npm install`**

Run: `cd apps/web && npm install`
Expected: no errors, `node_modules` populated.

- [ ] **Step 3: Write `vite.config.ts`**

Port `5173`; plugins: `react()` and `tailwindcss()` (from
`@tailwindcss/vite`); `server.proxy['/api'] = { target:
'http://localhost:3000', changeOrigin: true }`;
`test.environment = 'jsdom'`, `test.setupFiles = ['./src/test/setup.ts']`.

- [ ] **Step 4: Write `src/index.css`**

One line: `@import "tailwindcss";` — no `tailwind.config.*`, no
`postcss.config.*`, no `autoprefixer`; the Vite plugin from Step 3
handles all of it.

- [ ] **Step 5: Write `tsconfig.json`/`tsconfig.app.json`/`tsconfig.node.json`**

Standard Vite React-TS split config (app config targets `src/`, strict
mode on).

- [ ] **Step 6: Write `index.html`, `src/main.tsx`, `src/vite-env.d.ts`**

`index.html` mounts `#root` and loads `/src/main.tsx` as a module.
`main.tsx` renders `<App />` into `#root` via `createRoot`, imports
`./index.css`.

- [ ] **Step 7: Write `src/App.tsx`**

A placeholder: renders `<h1>lynKS Appointment Book</h1>` — replaced with
real routing in Task 8.

- [ ] **Step 8: Write `src/test/setup.ts`**

`import '@testing-library/jest-dom/vitest'`, `afterEach(cleanup)` —
matches the convention already used in this repo's other Vitest setups.

- [ ] **Step 9: Write `.env.example`**

`VITE_API_BASE_URL=` (empty — same-origin via the dev proxy; a deployed
build sets this to the real API origin).

- [ ] **Step 10: Write the failing test**

```tsx
// src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders', () => {
    render(<App />);
    expect(screen.getByText('lynKS Appointment Book')).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Run the test to verify it fails, then passes**

Run: `cd apps/web && npm test`
Expected before Step 7: fails (no `App.tsx`). After: `1 passed`.

- [ ] **Step 12: Commit**

```bash
git add apps/web
git commit -m "feat: scaffold fresh Vite+React+TS+Tailwind frontend"
```

---

### Task 2: `apiRequest` — typed, cookie-aware fetch primitive

**Files:**
- Create: `apps/web/src/lib/api-client.ts`
- Test: `apps/web/src/lib/api-client.test.ts`

**Interfaces:**
- Produces: `export class ApiError extends Error { status: number;
  errors?: Record<string, string>; }`, `export async function
  apiRequest<T>(path: string, options?: { method?: string; body?:
  unknown; accessToken?: string | null }): Promise<T>` — always sets
  `credentials: 'include'`; on a non-2xx response, parses the body as
  `{error, errors?}` and throws `ApiError` carrying both; on 204 (no
  body), resolves `undefined as T`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/api-client.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './api-client';

afterEach(() => { vi.unstubAllGlobals(); });

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('apiRequest', () => {
  it('sends credentials: include and parses a 2xx JSON body', async () => {
    const fetchMock = mockFetch(200, { access_token: 'abc' });
    const result = await apiRequest<{ access_token: string }>('/auth/login', { method: 'POST', body: { username: 'a' } });
    expect(result.access_token).toBe('abc');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', method: 'POST' });
  });

  it('attaches a Bearer header when accessToken is given', async () => {
    const fetchMock = mockFetch(200, {});
    await apiRequest('/auth/logout', { method: 'POST', accessToken: 'tok123' });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok123');
  });

  it('throws ApiError with status, message, and field errors on 422', async () => {
    mockFetch(422, { error: 'Please correct the highlighted fields', errors: { username: 'Invalid username format' } });
    await expect(apiRequest('/auth/register', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 422,
      message: 'Please correct the highlighted fields',
      errors: { username: 'Invalid username format' },
    });
  });

  it('is an instance of ApiError', async () => {
    mockFetch(401, { error: 'Incorrect username or password' });
    await expect(apiRequest('/auth/login', { method: 'POST' })).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/lib/api-client.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `apiRequest` and `ApiError` in `src/lib/api-client.ts`**

Build the URL as `` `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1${path}` ``.
Set `Content-Type: application/json` only when `body` is present;
`Authorization: Bearer ${accessToken}` only when `accessToken` is given.
`fetch(url, { method, credentials: 'include', headers, body: body ?
JSON.stringify(body) : undefined })`. On `response.ok`, return `response
.status === 204 ? undefined : await response.json()`. Otherwise parse the
JSON body (fall back to `{}` if parsing fails) and `throw new
ApiError(data.error ?? response.statusText, response.status,
data.errors)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/lib/api-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/lib/api-client.test.ts
git commit -m "feat: add cookie-aware typed apiRequest primitive"
```

---

### Task 3: `AuthContext` — session state, refresh-retry, logout

**Files:**
- Create: `apps/web/src/lib/auth-context.tsx`
- Test: `apps/web/src/lib/auth-context.test.tsx`

**Interfaces:**
- Consumes: `apiRequest`, `ApiError` (Task 2).
- Produces: `export interface AuthUser { id: number; username: string;
  role: string; first_name: string; last_name: string; must_change_password: boolean; }`,
  `export function AuthProvider({ children }: { children: ReactNode })`,
  `export function useAuth(): { user: AuthUser | null; status: 'loading' |
  'authenticated' | 'unauthenticated'; login(username, password,
  rememberMe?): Promise<void>; register(payload): Promise<void>;
  logout(): Promise<void>; forgotPassword(username): Promise<{message:
  string}>; resetPassword(token, payload): Promise<void>;
  changePassword(payload): Promise<void>; authedFetch<T>(path, options?):
  Promise<T>; }` — every page task (4-7) and the routing shell (Task 8)
  consume this exactly as named.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/lib/auth-context.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth-context';

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  const fetchMock = vi.fn().mockImplementation(async () => {
    const { status, body } = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('AuthProvider', () => {
  it('starts loading, then becomes unauthenticated if refresh fails on boot', async () => {
    mockFetchSequence([{ status: 401, body: { error: 'Session expired, please sign in again' } }]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
  });

  it('fails closed to unauthenticated when refresh succeeds but no user is cached (cross-tab/cold-restart case)', async () => {
    // sessionStorage is empty (no prior login in this tab), yet the
    // refresh cookie is still valid server-side.
    mockFetchSequence([{ status: 200, body: { access_token: 'tok' } }]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
    expect(result.current.user).toBeNull();
  });

  it('login stores the user and marks authenticated', async () => {
    mockFetchSequence([
      { status: 401, body: { error: 'x' } }, // boot refresh fails
      { status: 200, body: { access_token: 'tok', must_change_password: false, user: { id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B' } } },
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
    await act(async () => { await result.current.login('a', 'pw'); });
    expect(result.current.status).toBe('authenticated');
    expect(result.current.user?.username).toBe('a');
  });

  it('logout clears state even if the server call fails', async () => {
    // Realistic same-tab case: a prior login already cached the user;
    // /auth/refresh on boot only ever returns {access_token}, never user.
    sessionStorage.setItem('auth:user', JSON.stringify({ id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B', must_change_password: false }));
    mockFetchSequence([
      { status: 200, body: { access_token: 'tok' } }, // boot refresh succeeds
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).not.toBe('loading'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));
    await act(async () => { await result.current.logout(); });
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
  });

  it('authedFetch retries once on 401 via refresh, then succeeds', async () => {
    sessionStorage.setItem('auth:user', JSON.stringify({ id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B', must_change_password: false }));
    mockFetchSequence([
      { status: 200, body: { access_token: 'tok' } }, // boot refresh
      { status: 401, body: { error: 'expired' } }, // the authedFetch call, first attempt
      { status: 200, body: { access_token: 'new-tok' } }, // the refresh it triggers
      { status: 200, body: { ok: true } }, // the retried call
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    const data = await act(async () => result.current.authedFetch<{ ok: boolean }>('/some/protected/path'));
    expect(data.ok).toBe(true);
  });

  it('authedFetch does not loop forever when refresh itself 401s', async () => {
    sessionStorage.setItem('auth:user', JSON.stringify({ id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B', must_change_password: false }));
    mockFetchSequence([
      { status: 200, body: { access_token: 'tok' } },
      { status: 401, body: { error: 'expired' } },
      { status: 401, body: { error: 'refresh also expired' } },
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    await expect(act(async () => result.current.authedFetch('/some/path'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/lib/auth-context.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `AuthProvider`/`useAuth` in `src/lib/auth-context.tsx`**

State: `accessToken: string | null` (never persisted), `user: AuthUser |
null` (hydrated from `sessionStorage.getItem('auth:user')` as the
`useState` initializer, parsed JSON or `null`), `status`. On mount
(`useEffect`, once): call `apiRequest('/auth/refresh', { method: 'POST'
})`; on success, **only if a cached `user` was hydrated from
`sessionStorage`**, set `accessToken` from the response and
`status = 'authenticated'` — **never read `user` or
`must_change_password` off the refresh response body itself, even if
some future backend change started including them**; the whole point of
this gate is that the cached profile (set only by login/register/reset/
change, each of which really does return a full session) is the sole
source of truth for who's authenticated on boot, so there's nothing to
destructure from the refresh response but `access_token`. If the call
succeeds but there is no cached `user` (the fail-closed case this plan's
Global Constraints section requires), treat it the same as a failed
refresh — do not set `accessToken`, leave `user` null,
`status = 'unauthenticated'` (do not bother calling `/auth/logout` here,
there is no access token to send and nothing local to clear). On
failure (`ApiError`), clear `accessToken`, `user`,
`sessionStorage.removeItem('auth:user')`, set
`status = 'unauthenticated'`. `login`/`register`/`resetPassword`/
`changePassword` all follow the same pattern: call the matching
endpoint, on success `setAccessToken(response.access_token)`,
`setUser({...response.user, must_change_password:
response.must_change_password})`, `sessionStorage.setItem('auth:user',
JSON.stringify(thatUser))`, `status = 'authenticated'`; propagate
thrown `ApiError`s to the caller (the page components handle displaying
them). `forgotPassword` just calls the endpoint and returns its
`{message}` — no state change. `logout`: call `apiRequest('/auth/logout',
{method:'POST', accessToken})` wrapped in `try/catch` that swallows any
error, then unconditionally clear `accessToken`, `user`,
`sessionStorage.removeItem('auth:user')`, `status = 'unauthenticated'`
in a `finally` (or just after the try/catch — the point is it always
runs). `authedFetch`: call `apiRequest(path, {...options, accessToken})`;
on an `ApiError` with `status === 401` AND `path !== '/auth/refresh'`,
call the refresh endpoint once, on success update `accessToken` and
retry the original call once with the new token; on a second failure (or
if the refresh call itself 401s), clear session state (same as logout's
local-clear) and re-throw.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/lib/auth-context.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/auth-context.tsx apps/web/src/lib/auth-context.test.tsx
git commit -m "feat: add AuthContext with refresh-retry and session persistence"
```

---

### Task 4: Login page

**Files:**
- Create: `apps/web/src/features/auth/login.page.tsx`
- Test: `apps/web/src/features/auth/__tests__/login.page.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3).
- Produces: `export default function LoginPage()` — mounted at `/login`
  by Task 8.

- [ ] **Step 1: Write the failing tests**

Render `<LoginPage>` wrapped in a `MemoryRouter`, with `useAuth` mocked
(`vi.mock('../../lib/auth-context', ...)`) to control `login`'s
resolution:
- Fills username/password, submits, asserts `login` was called with
  `('ernesta', 'Sup3r!word', false)` (checkbox unchecked by default).
- Checking "Keep me signed in" and submitting calls `login` with
  `remember_me: true` as the third argument.
- When `login` rejects with an `ApiError('Incorrect username or
  password', 401)`, the error message renders in the form.
- When `login` rejects with an `ApiError("This account can't sign in
  right now", 423)`, that exact message renders (the backend's own
  copy, not a hardcoded frontend string).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/features/auth/__tests__/login.page.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `LoginPage`**

React Hook Form with `username`, `password`, `rememberMe` (checkbox,
default `false`) fields. Links: "Forgot password?" → `/forgot-password`,
"Create an account" → `/register`. On submit: `await login(data.username,
data.password, data.rememberMe)`, catch `ApiError` and render
`error.message` in a banner, on success `navigate('/')`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/features/auth/__tests__/login.page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/login.page.tsx apps/web/src/features/auth/__tests__/login.page.test.tsx
git commit -m "feat: add Login page"
```

---

### Task 5: Register page

**Files:**
- Create: `apps/web/src/features/auth/register.page.tsx`,
  `apps/web/src/features/auth/auth.api.ts`
- Test: `apps/web/src/features/auth/__tests__/register.page.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3), `apiRequest` (Task 2).
- Produces: `export async function checkUsernameAvailability(username:
  string): Promise<boolean>` in `auth.api.ts` (a thin wrapper over `GET
  /auth/username-availability`), used here via a debounced
  `@tanstack/react-query` `useQuery`, and reusable by nothing else in
  this plan but kept separate from the page component for testability.

- [ ] **Step 1: Write the failing tests**

Render `<RegisterPage>` (wrapped in `MemoryRouter` + a
`QueryClientProvider`), `useAuth` mocked:
- Fills all required fields, submits, asserts `register` was called
  with the exact payload shape the backend expects (snake_case keys:
  `first_name`, `last_name`, `date_of_birth`, `gender`, `email`, `phone`,
  `username`, `password`, `password_confirmation`, `accept_terms`).
- Typing a username triggers `checkUsernameAvailability` (mock
  `auth.api`) after the debounce; renders "available"/"taken" based on
  its resolved value.
- When `register` rejects with an `ApiError('Please correct the
  highlighted fields', 422, {username: 'Username is already taken'})`,
  that field-level message renders next to the username field (via
  `setError` from React Hook Form) — even though the live-availability
  check said "available" moments earlier (Review Focus item 4: the
  submit-time error always wins over the stale live-check result).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/features/auth/__tests__/register.page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `auth.api.ts`'s `checkUsernameAvailability`**

`const data = await apiRequest<{available: boolean}>(`/auth/username-availability?username=${encodeURIComponent(username)}`);
return data.available;` — let a 422 (malformed format) propagate as a
thrown `ApiError`; the page treats that as "not checkable yet", not
"taken".

- [ ] **Step 4: Implement `RegisterPage`**

React Hook Form with all required fields matching the screen spec
(first/last name, gender select, email, phone, username, password +
confirm with a simple strength indicator — reuse the same three
conditions the backend checks: length≥8, has a digit, has a symbol — and
accept-terms checkbox). Date of birth: use a native `<input
type="date">`, not a free-text field — the screen spec's "DD/MM/YYYY
text" describes the display, but a native date input already emits
`YYYY-MM-DD` in its value regardless of the user's locale, which is
exactly the ISO-8601 string the backend's `Date.iso8601` parser requires
(`apps/api/app/routes/auth.rb`'s `parse_date`) — so the payload's
`date_of_birth` field needs no conversion at all, just pass the input's
value straight through. This plan's call: correctness and zero parsing
code beat matching the mockup's exact text-field appearance. Username field drives a debounced (e.g. 400ms)
`useQuery(['username-availability', username], () =>
checkUsernameAvailability(username), { enabled: username.length >= 4 })`
showing an inline "available"/"taken" hint — purely informational, never
blocks submission. On submit: build the payload with the exact field
names from the backend contract above, `await register(payload)`, on an
`ApiError` with `status === 422` call `setError(field, {message})` for
each key in `error.errors`, plus render `error.message` as a general
banner; on success `navigate('/')`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/features/auth/__tests__/register.page.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/auth/register.page.tsx apps/web/src/features/auth/auth.api.ts apps/web/src/features/auth/__tests__/register.page.test.tsx
git commit -m "feat: add Register page with live username availability check"
```

---

### Task 6: Forgot password & Reset password pages

**Files:**
- Create: `apps/web/src/features/auth/forgot-password.page.tsx`,
  `apps/web/src/features/auth/reset-password.page.tsx`
- Test: `apps/web/src/features/auth/__tests__/forgot-password.page.test.tsx`,
  `apps/web/src/features/auth/__tests__/reset-password.page.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3).

- [ ] **Step 1: Write the failing tests**

ForgotPasswordPage: submitting a username calls `forgotPassword
(username)` and always renders the generic success message (the
backend's own `{message}` text, shown verbatim) regardless of whether
the mock resolves "found" or "not found" — there is no such distinction
to render, by design. ResetPasswordPage (rendered at
`/reset-password/:token` via `MemoryRouter initialEntries`): reads the
token from the URL, submitting password+confirmation calls
`resetPassword(token, {password, password_confirmation})`; on success
navigates to `/`; on a 422 `ApiError` with `errors`, field messages
render; on a 422 with no `errors` (just `error.message`, the
invalid/expired-link case), that message renders as a banner with a
"Request a new link" link back to `/forgot-password`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/features/auth/__tests__/forgot-password.page.test.tsx src/features/auth/__tests__/reset-password.page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement both pages**

ForgotPasswordPage: single `username` field, submit calls
`forgotPassword`, replaces the form with the returned `message` on
success (no error branch needed — the endpoint never meaningfully
fails). ResetPasswordPage: `useParams<{token: string}>()` for the token,
`password`/`password_confirmation` fields, submit calls `resetPassword`,
error handling as described in Step 1.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/features/auth/__tests__/forgot-password.page.test.tsx src/features/auth/__tests__/reset-password.page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/forgot-password.page.tsx apps/web/src/features/auth/reset-password.page.tsx apps/web/src/features/auth/__tests__/forgot-password.page.test.tsx apps/web/src/features/auth/__tests__/reset-password.page.test.tsx
git commit -m "feat: add Forgot password and Reset password pages"
```

---

### Task 7: Change password page

**Files:**
- Create: `apps/web/src/features/auth/change-password.page.tsx`
- Test: `apps/web/src/features/auth/__tests__/change-password.page.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3).
- Produces: `export default function ChangePasswordPage()` — mounted at
  `/change-password` by Task 8.

- [ ] **Step 1: Write the failing tests**

Render `<ChangePasswordPage>`, `useAuth` mocked with
`user.must_change_password: true` in one case and `false` in another:
- When `must_change_password` is `true`, a banner reading something
  like "You must change your password before continuing" is shown.
- When `false` (a voluntary change from a future Profile page), no such
  banner.
- Submitting `current_password`/`password`/`password_confirmation`
  calls `changePassword({current_password, password,
  password_confirmation})`; on success navigates to `/`.
- On a 422 `ApiError` with `errors: {current_password: 'Incorrect
  current password'}`, that message renders next to the current-password
  field.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/features/auth/__tests__/change-password.page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ChangePasswordPage`**

Reads `user` from `useAuth()` to decide whether to show the forced
banner. React Hook Form with the three fields. On submit: `await
changePassword(data)`, `ApiError` → `setError` per field + banner, on
success `navigate('/')`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/features/auth/__tests__/change-password.page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/change-password.page.tsx apps/web/src/features/auth/__tests__/change-password.page.test.tsx
git commit -m "feat: add Change password page"
```

---

### Task 8: Routing shell — `App.tsx`, `ProtectedRoute`, role landing stub

**Files:**
- Modify: `apps/web/src/App.tsx`, `apps/web/src/App.test.tsx`
- Create: `apps/web/src/lib/protected-route.tsx`,
  `apps/web/src/features/dashboard/role-landing.page.tsx`
- Test: `apps/web/src/lib/protected-route.test.tsx`

**Interfaces:**
- Consumes: `AuthProvider`, `useAuth` (Task 3), `LoginPage` (Task 4),
  `RegisterPage` (Task 5), `ForgotPasswordPage`/`ResetPasswordPage`
  (Task 6), `ChangePasswordPage` (Task 7) — every page this task wires
  into real routes already exists and is already individually tested.
- Produces: `export function ProtectedRoute({ children }: { children:
  ReactNode })` — the gate every future plan's protected pages wrap in.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/lib/protected-route.test.tsx
// Three cases, each rendering <MemoryRouter initialEntries={[...]}> around
// a <Routes> tree with `useAuth` mocked (vi.mock('./auth-context', ...))
// to a fixed value per case:
// 1. status 'unauthenticated' -> rendering a protected route redirects to /login.
// 2. status 'authenticated', user.must_change_password: true, current path '/'
//    -> redirects to /change-password.
// 3. status 'authenticated', user.must_change_password: true, current path
//    '/change-password' -> renders children (no redirect loop).
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/protected-route.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `ProtectedRoute` in `src/lib/protected-route.tsx`**

Uses `useAuth()` and `useLocation()`. If `status === 'loading'` render
`null`. If `status === 'unauthenticated'` render `<Navigate to="/login"
replace />`. If `user?.must_change_password && location.pathname !==
'/change-password'` render `<Navigate to="/change-password" replace />`.
Otherwise render `children`.

- [ ] **Step 4: Write `src/features/dashboard/role-landing.page.tsx`**

Reads `user` from `useAuth()`, renders "Signed in as {role}: {first_name}
{last_name}" and a "Log out" button calling `logout()` then
`navigate('/login')`.

- [ ] **Step 5: Rewrite `src/App.tsx`**

Wraps `<AuthProvider>` around a `<BrowserRouter>` with `<Routes>`:
`/login` → `LoginPage`, `/register` → `RegisterPage`, `/forgot-password`
→ `ForgotPasswordPage`, `/reset-password/:token` → `ResetPasswordPage`,
`/change-password` → `<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>`,
`/` → `<ProtectedRoute><RoleLandingPage /></ProtectedRoute>`. This plan
deliberately does not add a redirect-away-from-`/login`-when-already-
authenticated case — out of scope here, a later polish.

- [ ] **Step 6: Update `src/App.test.tsx`**

Replace the old placeholder-text assertion. Mock `../lib/auth-context`'s
`useAuth` to report `status: 'unauthenticated'`, render `<App />` (it
owns its own router internally), and assert the login page's heading
appears at the default route.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/web && npm test`
Expected: PASS, no regressions in Tasks 1-7's tests.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/lib/protected-route.tsx apps/web/src/lib/protected-route.test.tsx apps/web/src/features/dashboard/role-landing.page.tsx
git commit -m "feat: add routing shell, ProtectedRoute, and role landing stub"
```

---

## Self-Review

**Spec coverage:** every screen in the design spec's "1 · Login &
Registration" section (Main/Login, Register, ForgotPassword, plus the
reset-password step and the forced-change-on-first-login flow that reuses
the same screen) has an owning task. The role-routed landing after sign-in
is a deliberate stub (Task 8) — the real per-role dashboards are later
plans' work, matching the original multi-plan roadmap.

**Type consistency:** `AuthUser`, `ApiError`, and `useAuth()`'s returned
shape are defined once (Tasks 2-3) and consumed with the same names and
signatures by every later task (4-8) — no renamed fields across tasks.

**Dependency ordering:** Tasks 4-7 (the five pages) each depend only on
`useAuth`/`apiRequest` (Tasks 2-3), driven by a mocked `useAuth` in their
own tests — none depends on `App.tsx`'s routing. Task 8 (routing) depends
on all five pages existing. This was a real sequencing defect in an
earlier draft of this plan (routing was drafted before the pages it
wires together) — fixed before dispatch by reordering, not left as an
executor-time workaround.

**Review Focus:** all five items above have an owning task and an explicit
test.

**Proportion:** 8 tasks for 5 screens plus the auth plumbing they share is
proportionate — the plumbing (Tasks 2-3) is the part worth the most care
since every later plan's authenticated screens will build on `authedFetch`
and `ProtectedRoute` exactly as Task 13 of the backend plan became the
chokepoint for `authenticate!`.
