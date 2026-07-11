# Staff Web App — Foundation (Sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new staff-facing web app (`staff-web/`) with login (including forced first-login password change), and a patient search screen — the foundation later sub-projects (clinical workflow, sample review, reports, admin/supervision) will build on.

**Architecture:** Vite + React + TypeScript SPA, using Mantine for UI components and React Router for navigation. Auth uses the backend's existing bearer-token session model, with the token stored in `localStorage`. One small backend addition is required: `GET /api/v1/auth/me`, since no existing endpoint returns the currently-authenticated user's own `fullName`/`role`/`mustChangePassword` (the login response only returns `{ token, expiresAt, mustChangePassword }` — no name or role — and the session token is an opaque, database-backed string, not a decodable JWT).

**Tech Stack:** NestJS 11/TypeScript backend (unchanged, one endpoint added), Vite + React 19 + TypeScript + Mantine 7 + React Router + Vitest + React Testing Library for the new `staff-web/` app.

## Global Constraints

- No Prisma schema changes — the `User` model already has `fullName`, `mobile`, `role`, `mustChangePassword`.
- One unified app for all three staff roles (Clinician, Supervisor, Admin) — navigation and screens are conditional on the backend's existing `Permission`/`ROLE_PERMISSIONS` system, not separate apps.
- Force password-change on first login when `mustChangePassword` is true — no other screen is reachable until it's completed.
- Arabic is the only language; all user-facing strings live in a centralized copy module (`staff-web/src/copy/ar.ts`), matching the mobile app's convention — no inline strings in components.
- RTL throughout — Mantine's provider configured with `dir="rtl"`, document `dir` attribute set accordingly.
- Patient search is read-only in this sub-project — no click-through to a detail page (that's sub-project 2's scope).
- Backend CORS is already wide open (`app.enableCors()` in `backend/src/main.ts`, no origin restriction) — no backend CORS changes needed for the new app's dev server.
- Testing: Vitest + React Testing Library, mirroring the mobile app's TDD conventions (mocked API modules, real-string assertions, not snapshot tests).

---

### Task 1: Backend — `GET /api/v1/auth/me`

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Test: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: nothing new — uses the existing `PrismaService`, `SessionGuard`, `AuthenticatedUser`.
- Produces: `AuthService.me(userId: string): Promise<{ id: string; fullName: string; mobile: string; role: Role; mustChangePassword: boolean }>` and route `GET /api/v1/auth/me` (gated by `SessionGuard` only — any authenticated user, no specific `Permission` needed, matching the existing `logout`/`change-password` routes' pattern) — later mobile-app-adjacent tasks in this plan call this via a new `getMe()` function in `staff-web/src/api/auth.ts`.

- [ ] **Step 1: Write the failing e2e test**

Read `backend/test/auth.e2e-spec.ts` first to see its existing `createUserToken`-style helper conventions, then add this new `describe` block at the end of the file:

```typescript
describe('Auth: GET /me', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('returns the current user\'s own basic profile', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Me Endpoint Patient',
      mobile: '+966500000930',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000930', code: registerResponse.body.devOtpCode });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000930', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: registerResponse.body.userId,
      fullName: 'Me Endpoint Patient',
      mobile: '+966500000930',
      role: 'PATIENT',
      mustChangePassword: false,
    });
  });

  it('reflects mustChangePassword: true for a staff account created with that flag set', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Me Endpoint Clinician',
      mobile: '+966500000931',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000931', code: registerResponse.body.devOtpCode });
    await prisma.user.update({
      where: { mobile: '+966500000931' },
      data: { role: 'CLINICIAN', mustChangePassword: true },
    });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000931', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('CLINICIAN');
    expect(response.body.mustChangePassword).toBe(true);
  });

  it('rejects a request with no bearer token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest --config test/jest-e2e.json auth.e2e-spec -t "GET /me"`
Expected: FAIL — `GET /api/v1/auth/me` doesn't exist yet (404 on the first two tests; the third test may already pass by coincidence since a missing route also 404s, not 401 — check its assertion resolves correctly once the route exists in Step 5, not before).

- [ ] **Step 3: Add the `Role` import**

Read `backend/src/modules/auth/auth.service.ts` first. Change:

```typescript
import { OtpPurpose, UserStatus } from '@prisma/client';
```

to:

```typescript
import { OtpPurpose, Role, UserStatus } from '@prisma/client';
```

- [ ] **Step 4: Add the service method**

Still in `backend/src/modules/auth/auth.service.ts`, add this method (placed right after `login()`):

```typescript
  async me(userId: string): Promise<{ id: string; fullName: string; mobile: string; role: Role; mustChangePassword: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      id: user.id,
      fullName: user.fullName,
      mobile: user.mobile,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  }
```

- [ ] **Step 5: Add the controller route**

Read `backend/src/modules/auth/auth.controller.ts` first. Add this route (placed right after the `login` route, before `forgot-password`):

```typescript
  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx jest --config test/jest-e2e.json auth.e2e-spec -t "GET /me"`
Expected: PASS, all 3 new tests.

- [ ] **Step 7: Run the full backend e2e suite to confirm no regressions**

Run: `cd backend && npm run test:e2e`
Expected: every existing suite still passes, plus the 3 new tests (all in the existing `auth.e2e-spec.ts` file, so suite count stays the same, test count increases by 3).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/auth.controller.ts backend/test/auth.e2e-spec.ts
git commit -m "feat: add GET /api/v1/auth/me for the current user's own profile

No existing endpoint returns the authenticated user's own
fullName/role/mustChangePassword — the login response only has
token/expiresAt/mustChangePassword (no name or role), and the session
token is an opaque DB-backed string, not a decodable JWT. Needed by
the new staff web app to know who's logged in and to re-check
mustChangePassword on page reload (not just at the moment of login)."
```

---

### Task 2: Staff web — Vite/React/Mantine/Vitest scaffold + RTL + boot smoke test

**Files:**
- Create: `staff-web/` (via `npm create vite@latest`, then modified as below)
- Create: `staff-web/src/App.tsx`
- Create: `staff-web/src/main.tsx`
- Create: `staff-web/src/theme.ts`
- Create: `staff-web/src/setupTests.ts`
- Modify: `staff-web/vite.config.ts`
- Modify: `staff-web/package.json`
- Test: `staff-web/src/App.test.tsx`

**Interfaces:**
- Produces: a running `staff-web/` app reachable at `http://localhost:5173` via `npm run dev`; `src/App.tsx` as the root component every later screen renders under (wrapped in `MantineProvider` + `BrowserRouter`).

- [ ] **Step 1: Scaffold the Vite app**

From the repo root (`C:\Users\Well\Desktop\kalamy`):
```bash
npm create vite@latest staff-web -- --template react-ts
```
Expected: creates `staff-web/` with `package.json`, `src/App.tsx`, `src/main.tsx`, `vite.config.ts`, `tsconfig.json`, `index.html`.

- [ ] **Step 2: Install dependencies**

```bash
cd staff-web
npm install
npm install @mantine/core @mantine/hooks @mantine/notifications @mantine/form react-router-dom
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```
Expected: all installs succeed, `package.json` dependencies updated.

- [ ] **Step 3: Configure Vitest in `vite.config.ts`**

Read the scaffolded `staff-web/vite.config.ts` first, then replace it with:

```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
});
```

- [ ] **Step 4: Create the test setup file**

Create `staff-web/src/setupTests.ts`:

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Add the `test` script**

Read `staff-web/package.json` first. In its `"scripts"` block, add (alongside the existing `dev`/`build`/`preview` scripts):

```json
    "test": "vitest run",
```

- [ ] **Step 6: Create the theme module**

Create `staff-web/src/theme.ts`:

```typescript
import { createTheme, MantineProvider } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: 'system-ui, sans-serif',
});

export { MantineProvider };
```

- [ ] **Step 7: Write the root `App.tsx`**

Replace `staff-web/src/App.tsx` with:

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<div>تسجيل الدخول</div>} />
      </Routes>
    </BrowserRouter>
  );
}
```

This is a placeholder route table — Task 5 replaces the `/login` element with the real screen, and later tasks add the rest of the routes.

- [ ] **Step 8: Wire up RTL and Mantine in `main.tsx`**

Replace `staff-web/src/main.tsx` with:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { Notifications } from '@mantine/notifications';
import { theme, MantineProvider } from './theme';
import App from './App';

document.documentElement.dir = 'rtl';
document.documentElement.lang = 'ar';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light" dir="rtl">
      <Notifications position="top-left" />
      <App />
    </MantineProvider>
  </StrictMode>,
);
```

- [ ] **Step 9: Write the boot smoke test**

Create `staff-web/src/App.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('redirects to the login route and renders it', () => {
    render(<App />);
    expect(screen.getByText('تسجيل الدخول')).toBeTruthy();
  });
});
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `cd staff-web && npm test`
Expected: PASS, 1 test.

- [ ] **Step 11: Confirm the dev server boots**

Run: `cd staff-web && npm run dev`
Expected: starts on `http://localhost:5173` (or the next free port), no console errors. Stop the server after confirming (Ctrl+C) — this is a manual check, not part of the automated test.

- [ ] **Step 12: Commit**

```bash
git add staff-web
git commit -m "feat: scaffold the staff web app (Vite + React + Mantine + Vitest, RTL)"
```

---

### Task 3: Staff web — session storage + API client

**Files:**
- Create: `staff-web/src/storage/session.ts`
- Create: `staff-web/src/api/client.ts`
- Test: `staff-web/src/storage/session.test.ts`
- Test: `staff-web/src/api/client.test.ts`

**Interfaces:**
- Produces: `getToken(): string | null`, `saveToken(token: string): void`, `clearToken(): void`; `ApiError` class (status, code, message, details); `apiRequest<T>(path: string, options?: ApiRequestOptions): Promise<T>` — consumed by Task 4's auth API functions and Task 7's patients API function.

- [ ] **Step 1: Write the failing test for session storage**

Create `staff-web/src/storage/session.test.ts`:

```typescript
import { getToken, saveToken, clearToken } from './session';

beforeEach(() => {
  localStorage.clear();
});

describe('session storage', () => {
  it('returns null when no token has been saved', () => {
    expect(getToken()).toBeNull();
  });

  it('saves and retrieves a token', () => {
    saveToken('abc123');
    expect(getToken()).toBe('abc123');
  });

  it('clears a saved token', () => {
    saveToken('abc123');
    clearToken();
    expect(getToken()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd staff-web && npm test -- session.test.ts`
Expected: FAIL — `staff-web/src/storage/session.ts` doesn't exist yet.

- [ ] **Step 3: Write the session storage module**

Create `staff-web/src/storage/session.ts`:

```typescript
const TOKEN_KEY = 'kalamy_staff_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
```

This app only ever runs in a browser (unlike the mobile app, which needed a `Platform.OS === 'web'` branch around `expo-secure-store`), so a plain synchronous `localStorage` wrapper is all that's needed — no native-storage abstraction to maintain.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd staff-web && npm test -- session.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Write the failing test for the API client**

Create `staff-web/src/api/client.test.ts`:

```typescript
import { apiRequest, ApiError } from './client';
import { saveToken, clearToken } from '../storage/session';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  clearToken();
});

describe('apiRequest', () => {
  it('sends a GET with no auth header when auth is not requested', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hello: 'world' }),
    }) as unknown as typeof fetch;

    const result = await apiRequest<{ hello: string }>('/api/v1/ping');

    expect(result).toEqual({ hello: 'world' });
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('attaches a bearer token when auth is requested and a token exists', async () => {
    saveToken('token-xyz');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await apiRequest('/api/v1/protected', { auth: true });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer token-xyz');
  });

  it('sends a POST with a JSON body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ created: true }),
    }) as unknown as typeof fetch;

    await apiRequest('/api/v1/things', { method: 'POST', body: { name: 'a thing' } });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'a thing' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('throws a typed ApiError on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'UNAUTHORIZED', message: 'Invalid credentials' }),
    }) as unknown as typeof fetch;

    await expect(apiRequest('/api/v1/login')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid credentials',
    });
    await expect(apiRequest('/api/v1/login')).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd staff-web && npm test -- client.test.ts`
Expected: FAIL — `staff-web/src/api/client.ts` doesn't exist yet.

- [ ] **Step 7: Write the API client**

Create `staff-web/src/api/client.ts`:

```typescript
import { getToken } from '../storage/session';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (options.auth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let data: any;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiError(response.status, 'PARSE_ERROR', `Request failed with status ${response.status}`);
    }
    data = undefined;
  }

  if (!response.ok) {
    throw new ApiError(response.status, data?.code ?? 'UNKNOWN_ERROR', data?.message ?? 'Request failed', data?.details);
  }

  return data as T;
}
```

This mirrors `mobile/src/api/client.ts`'s pattern exactly (same `ApiError` shape, same `apiRequest<T>` signature), adapted for a browser-only environment (`import.meta.env.VITE_API_BASE_URL` instead of `process.env.EXPO_PUBLIC_API_BASE_URL`, no `formData` branch since this sub-project has no file uploads).

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd staff-web && npm test -- client.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 9: Run the full staff-web suite to confirm no regressions**

Run: `cd staff-web && npm test`
Expected: every test passes (1 from Task 2 + 3 + 4 from this task = 8 total).

- [ ] **Step 10: Commit**

```bash
git add staff-web/src/storage/session.ts staff-web/src/storage/session.test.ts staff-web/src/api/client.ts staff-web/src/api/client.test.ts
git commit -m "feat: add session storage and API client for the staff web app"
```

---

### Task 4: Staff web — Auth API functions + AuthProvider

**Files:**
- Create: `staff-web/src/api/auth.ts`
- Create: `staff-web/src/auth/AuthProvider.tsx`
- Test: `staff-web/src/auth/AuthProvider.test.tsx`

**Interfaces:**
- Consumes: `apiRequest`, `ApiError` (Task 3); `saveToken`, `clearToken` (Task 3).
- Produces: `StaffUser` type (`{ id, fullName, mobile, role, mustChangePassword }`); `login(mobile, password): Promise<void>`, `forgotPassword({mobile}): Promise<{devOtpCode?: string}>`, `resetPassword({mobile, code, newPassword}): Promise<void>`, `changePassword({currentPassword, newPassword}): Promise<void>`, `getMe(): Promise<StaffUser>` (all in `api/auth.ts`); `AuthProvider`, `useAuth()` returning `{ user: StaffUser | null, loading: boolean, login, logout, refreshUser }` — consumed by Tasks 5, 6, and 7's screens.

- [ ] **Step 1: Write `api/auth.ts`**

Create `staff-web/src/api/auth.ts`:

```typescript
import { apiRequest } from './client';

export type StaffRole = 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN';

export interface StaffUser {
  id: string;
  fullName: string;
  mobile: string;
  role: StaffRole;
  mustChangePassword: boolean;
}

export function login(mobile: string, password: string): Promise<{ token: string; expiresAt: string; mustChangePassword: boolean }> {
  return apiRequest('/api/v1/auth/login', { method: 'POST', body: { mobile, password } });
}

export function forgotPassword(input: { mobile: string }): Promise<{ devOtpCode?: string }> {
  return apiRequest('/api/v1/auth/forgot-password', { method: 'POST', body: input });
}

export function resetPassword(input: { mobile: string; code: string; newPassword: string }): Promise<{ reset: true }> {
  return apiRequest('/api/v1/auth/reset-password', { method: 'POST', body: input });
}

export function changePassword(input: { currentPassword: string; newPassword: string }): Promise<{ changed: true }> {
  return apiRequest('/api/v1/auth/change-password', { method: 'POST', body: input, auth: true });
}

export function getMe(): Promise<StaffUser> {
  return apiRequest('/api/v1/auth/me', { auth: true });
}
```

This module has no dedicated unit test file, following the mobile app's established convention (`api/reports.ts`, `api/patients.ts`, `api/complaints.ts` have none either) — its behavior is verified through the `AuthProvider` test below and the screen tests in later tasks, which mock it.

- [ ] **Step 2: Write the failing test for `AuthProvider`**

Create `staff-web/src/auth/AuthProvider.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';
import { login, getMe } from '../api/auth';
import { getToken, clearToken } from '../storage/session';

vi.mock('../api/auth');

function Probe() {
  const { user, loading, login: doLogin, logout } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <div>{user ? `logged in: ${user.fullName}` : 'logged out'}</div>
      <button onClick={() => doLogin('+966500000001', 'password123')}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearToken();
});

describe('AuthProvider', () => {
  it('starts logged out when there is no saved token', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByText('logged out')).toBeTruthy();
    });
  });

  it('logs in, saves the token, and populates the user from getMe', async () => {
    (login as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'new-token', expiresAt: '2026-08-01T00:00:00.000Z', mustChangePassword: false });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      fullName: 'Dr. Sara',
      mobile: '+966500000001',
      role: 'CLINICIAN',
      mustChangePassword: false,
    });

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => {
      expect(screen.getByText('logged out')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => {
      expect(screen.getByText('logged in: Dr. Sara')).toBeTruthy();
    });
    expect(getToken()).toBe('new-token');
  });

  it('logs out and clears the token', async () => {
    (login as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'new-token', expiresAt: '2026-08-01T00:00:00.000Z', mustChangePassword: false });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      fullName: 'Dr. Sara',
      mobile: '+966500000001',
      role: 'CLINICIAN',
      mustChangePassword: false,
    });

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => screen.getByText('login'));
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => {
      expect(screen.getByText('logged in: Dr. Sara')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('logout'));

    await waitFor(() => {
      expect(screen.getByText('logged out')).toBeTruthy();
    });
    expect(getToken()).toBeNull();
  });

  it('restores the logged-in user from an existing saved token on mount', async () => {
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      fullName: 'Dr. Sara',
      mobile: '+966500000001',
      role: 'CLINICIAN',
      mustChangePassword: false,
    });
    localStorage.setItem('kalamy_staff_token', 'existing-token');

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByText('logged in: Dr. Sara')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd staff-web && npm test -- AuthProvider.test.tsx`
Expected: FAIL — `staff-web/src/auth/AuthProvider.tsx` doesn't exist yet.

- [ ] **Step 4: Write `AuthProvider.tsx`**

Create `staff-web/src/auth/AuthProvider.tsx`:

```typescript
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { login as loginRequest, getMe, StaffUser } from '../api/auth';
import { getToken, saveToken, clearToken } from '../storage/session';

interface AuthContextValue {
  user: StaffUser | null;
  loading: boolean;
  login: (mobile: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const me = await getMe();
    setUser(me);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const token = getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const me = await getMe();
        if (!cancelled) {
          setUser(me);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(mobile: string, password: string) {
    const result = await loginRequest(mobile, password);
    saveToken(result.token);
    await refreshUser();
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
```

Note: `getMe()`'s response already includes `mustChangePassword`, refreshed on every mount and after every login — this is the single source of truth Task 6's route guard reads from, so a page reload mid-flow (before the forced password change is completed) doesn't lose track of the requirement.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd staff-web && npm test -- AuthProvider.test.tsx`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Run the full staff-web suite to confirm no regressions**

Run: `cd staff-web && npm test`
Expected: every test passes (8 from Tasks 2-3 + 4 new = 12 total).

- [ ] **Step 7: Commit**

```bash
git add staff-web/src/api/auth.ts staff-web/src/auth/AuthProvider.tsx staff-web/src/auth/AuthProvider.test.tsx
git commit -m "feat: add auth API functions and AuthProvider for the staff web app"
```

---

### Task 5: Staff web — Login, Forgot Password, Reset Password screens

**Files:**
- Create: `staff-web/src/copy/ar.ts`
- Create: `staff-web/src/pages/LoginPage.tsx`
- Create: `staff-web/src/pages/ForgotPasswordPage.tsx`
- Create: `staff-web/src/pages/ResetPasswordPage.tsx`
- Modify: `staff-web/src/App.tsx`
- Test: `staff-web/src/pages/LoginPage.test.tsx`
- Test: `staff-web/src/pages/ForgotPasswordPage.test.tsx`
- Test: `staff-web/src/pages/ResetPasswordPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 4, for `LoginPage`); `forgotPassword`, `resetPassword` (Task 4's `api/auth.ts`, for the other two pages); `ApiError` (Task 3).
- Produces: routes `/login`, `/forgot-password`, `/reset-password` — consumed by Task 6's route guards and Task 7's app shell (nothing else in this task is consumed by later tasks directly, since navigation is by route path).

- [ ] **Step 1: Create the copy module**

Create `staff-web/src/copy/ar.ts`:

```typescript
export const ar = {
  login: {
    title: 'تسجيل دخول الطاقم الطبي',
    mobileLabel: 'رقم الجوال',
    passwordLabel: 'كلمة المرور',
    submitButton: 'دخول',
    forgotPasswordLink: 'نسيت كلمة المرور؟',
  },
  forgotPassword: {
    title: 'استعادة كلمة المرور',
    mobileLabel: 'رقم الجوال',
    submitButton: 'إرسال رمز التحقق',
  },
  resetPassword: {
    title: 'إعادة تعيين كلمة المرور',
    codeLabel: 'رمز التحقق',
    newPasswordLabel: 'كلمة المرور الجديدة',
    submitButton: 'تعيين كلمة المرور',
  },
  changePassword: {
    title: 'يجب تغيير كلمة المرور',
    description: 'لأسباب أمنية، يجب عليك تعيين كلمة مرور جديدة قبل المتابعة',
    currentPasswordLabel: 'كلمة المرور الحالية',
    newPasswordLabel: 'كلمة المرور الجديدة',
    submitButton: 'تحديث كلمة المرور',
  },
  shell: {
    patientsLink: 'المرضى',
    logoutButton: 'تسجيل الخروج',
    roles: {
      CLINICIAN: 'أخصائي',
      SUPERVISOR: 'مشرف',
      ADMIN: 'مدير النظام',
    },
  },
  patients: {
    title: 'بحث عن المرضى',
    searchPlaceholder: 'ابحث بالاسم أو رقم الهوية',
    tableName: 'الاسم',
    tableNationalId: 'رقم الهوية',
    tableGender: 'الجنس',
    tableDateOfBirth: 'تاريخ الميلاد',
    tableStatus: 'الحالة',
    genders: { MALE: 'ذكر', FEMALE: 'أنثى' } as Record<string, string>,
    statuses: { ACTIVE: 'نشط', DISABLED: 'معطل' } as Record<string, string>,
    noResults: 'لا توجد نتائج',
    emptyState: 'ابحث عن مريض بالاسم أو رقم الهوية',
  },
  errors: {
    unexpected: 'حدث خطأ غير متوقع',
  },
};
```

- [ ] **Step 2: Write the failing test for `LoginPage`**

Create `staff-web/src/pages/LoginPage.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { AuthProvider } from '../auth/AuthProvider';
import { login as loginApi, getMe } from '../api/auth';
import { ApiError } from '../api/client';

vi.mock('../api/auth');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('LoginPage', () => {
  it('submits mobile and password and calls the login API', async () => {
    (loginApi as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 't', expiresAt: '2026-08-01T00:00:00.000Z', mustChangePassword: false });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: false });

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('تسجيل دخول الطاقم الطبي')).toBeTruthy();
    }, { timeout: 3000 });

    fireEvent.change(screen.getByLabelText('رقم الجوال'), { target: { value: '+966500000001' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('دخول'));

    await waitFor(() => {
      expect(loginApi).toHaveBeenCalledWith('+966500000001', 'password123');
    });
  });

  it('shows an error message when login fails', async () => {
    (loginApi as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Invalid credentials'));

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('رقم الجوال'), { target: { value: '+966500000001' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('دخول'));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd staff-web && npm test -- LoginPage.test.tsx`
Expected: FAIL — `staff-web/src/pages/LoginPage.tsx` doesn't exist yet.

- [ ] **Step 4: Write `LoginPage.tsx`**

Create `staff-web/src/pages/LoginPage.tsx`:

```typescript
import { useState } from 'react';
import { Container, Title, TextInput, PasswordInput, Button, Alert, Anchor, Stack } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../api/client';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(mobile, password);
      navigate('/patients');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={420} my={80}>
      <Title order={2} ta="center" mb="lg">{ar.login.title}</Title>
      <form onSubmit={handleSubmit}>
        <Stack>
          {error ? <Alert color="red">{error}</Alert> : null}
          <TextInput label={ar.login.mobileLabel} value={mobile} onChange={(e) => setMobile(e.currentTarget.value)} />
          <PasswordInput label={ar.login.passwordLabel} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <Button type="submit" loading={submitting} fullWidth>{ar.login.submitButton}</Button>
          <Anchor component={Link} to="/forgot-password" ta="center" size="sm">
            {ar.login.forgotPasswordLink}
          </Anchor>
        </Stack>
      </form>
    </Container>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd staff-web && npm test -- LoginPage.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 6: Write the failing test for `ForgotPasswordPage`**

Create `staff-web/src/pages/ForgotPasswordPage.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { forgotPassword } from '../api/auth';

vi.mock('../api/auth');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForgotPasswordPage', () => {
  it('submits the mobile number and calls forgotPassword', async () => {
    (forgotPassword as ReturnType<typeof vi.fn>).mockResolvedValue({});

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('استعادة كلمة المرور')).toBeTruthy();
    }, { timeout: 3000 });

    fireEvent.change(screen.getByLabelText('رقم الجوال'), { target: { value: '+966500000001' } });
    fireEvent.click(screen.getByText('إرسال رمز التحقق'));

    await waitFor(() => {
      expect(forgotPassword).toHaveBeenCalledWith({ mobile: '+966500000001' });
    });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd staff-web && npm test -- ForgotPasswordPage.test.tsx`
Expected: FAIL — `staff-web/src/pages/ForgotPasswordPage.tsx` doesn't exist yet.

- [ ] **Step 8: Write `ForgotPasswordPage.tsx`**

Create `staff-web/src/pages/ForgotPasswordPage.tsx`:

```typescript
import { useState } from 'react';
import { Container, Title, TextInput, Button, Alert, Stack } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { ar } from '../copy/ar';
import { forgotPassword } from '../api/auth';
import { ApiError } from '../api/client';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword({ mobile });
      navigate('/reset-password', { state: { mobile } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={420} my={80}>
      <Title order={2} ta="center" mb="lg">{ar.forgotPassword.title}</Title>
      <form onSubmit={handleSubmit}>
        <Stack>
          {error ? <Alert color="red">{error}</Alert> : null}
          <TextInput label={ar.forgotPassword.mobileLabel} value={mobile} onChange={(e) => setMobile(e.currentTarget.value)} />
          <Button type="submit" loading={submitting} fullWidth>{ar.forgotPassword.submitButton}</Button>
        </Stack>
      </form>
    </Container>
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd staff-web && npm test -- ForgotPasswordPage.test.tsx`
Expected: PASS.

- [ ] **Step 10: Write the failing test for `ResetPasswordPage`**

Create `staff-web/src/pages/ResetPasswordPage.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResetPasswordPage } from './ResetPasswordPage';
import { resetPassword } from '../api/auth';

vi.mock('../api/auth');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResetPasswordPage', () => {
  it('submits code and new password, using the mobile number passed via navigation state', async () => {
    (resetPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ reset: true });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/reset-password', state: { mobile: '+966500000001' } }]}>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('إعادة تعيين كلمة المرور')).toBeTruthy();
    }, { timeout: 3000 });

    fireEvent.change(screen.getByLabelText('رمز التحقق'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByText('تعيين كلمة المرور'));

    await waitFor(() => {
      expect(resetPassword).toHaveBeenCalledWith({ mobile: '+966500000001', code: '123456', newPassword: 'newpassword123' });
    });
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `cd staff-web && npm test -- ResetPasswordPage.test.tsx`
Expected: FAIL — `staff-web/src/pages/ResetPasswordPage.tsx` doesn't exist yet.

- [ ] **Step 12: Write `ResetPasswordPage.tsx`**

Create `staff-web/src/pages/ResetPasswordPage.tsx`:

```typescript
import { useState } from 'react';
import { Container, Title, TextInput, PasswordInput, Button, Alert, Stack } from '@mantine/core';
import { useNavigate, useLocation } from 'react-router-dom';
import { ar } from '../copy/ar';
import { resetPassword } from '../api/auth';
import { ApiError } from '../api/client';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = (location.state as { mobile?: string } | null)?.mobile ?? '';
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword({ mobile, code, newPassword });
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={420} my={80}>
      <Title order={2} ta="center" mb="lg">{ar.resetPassword.title}</Title>
      <form onSubmit={handleSubmit}>
        <Stack>
          {error ? <Alert color="red">{error}</Alert> : null}
          <TextInput label={ar.resetPassword.codeLabel} value={code} onChange={(e) => setCode(e.currentTarget.value)} />
          <PasswordInput label={ar.resetPassword.newPasswordLabel} value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
          <Button type="submit" loading={submitting} fullWidth>{ar.resetPassword.submitButton}</Button>
        </Stack>
      </form>
    </Container>
  );
}
```

- [ ] **Step 13: Run the test to verify it passes**

Run: `cd staff-web && npm test -- ResetPasswordPage.test.tsx`
Expected: PASS.

- [ ] **Step 14: Wire the three routes into `App.tsx`**

Replace `staff-web/src/App.tsx` with:

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 15: Update `App.test.tsx` for the new `AuthProvider` wrapping**

Read `staff-web/src/App.test.tsx` first (from Task 2). Replace its assertion, since the redirected `/login` page now renders the real `LoginPage` (with the Arabic title text), not the Task 2 placeholder `<div>تسجيل الدخول</div>` — the assertion text is unchanged, but confirm it still targets a real heading, not a stray leftover placeholder div:

```typescript
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('redirects to the login route and renders it', async () => {
    render(<App />);
    expect(await screen.findByText('تسجيل دخول الطاقم الطبي')).toBeTruthy();
  });
});
```

- [ ] **Step 16: Run the full staff-web suite to confirm everything passes together**

Run: `cd staff-web && npm test`
Expected: every test passes (12 from Tasks 2-4 + 2 from LoginPage + 1 from ForgotPasswordPage + 1 from ResetPasswordPage = 16 total; the updated App.test.tsx assertion is still 1 test, just checking the real login title now instead of the Task 2 placeholder).

- [ ] **Step 17: Commit**

```bash
git add staff-web/src/copy/ar.ts staff-web/src/pages/LoginPage.tsx staff-web/src/pages/LoginPage.test.tsx staff-web/src/pages/ForgotPasswordPage.tsx staff-web/src/pages/ForgotPasswordPage.test.tsx staff-web/src/pages/ResetPasswordPage.tsx staff-web/src/pages/ResetPasswordPage.test.tsx staff-web/src/App.tsx staff-web/src/App.test.tsx
git commit -m "feat: add Login, Forgot Password, and Reset Password screens"
```

---

### Task 6: Staff web — Forced Change Password screen + route guards

**Files:**
- Create: `staff-web/src/pages/ChangePasswordPage.tsx`
- Create: `staff-web/src/auth/RequireAuth.tsx`
- Modify: `staff-web/src/App.tsx`
- Test: `staff-web/src/pages/ChangePasswordPage.test.tsx`
- Test: `staff-web/src/auth/RequireAuth.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 4); `changePassword` (Task 4's `api/auth.ts`).
- Produces: `RequireAuth` component (wraps protected routes, redirects to `/login` if logged out, redirects to `/change-password` if `mustChangePassword` is true and the current route isn't already `/change-password`) — consumed by Task 7's `/patients` route.

- [ ] **Step 1: Write the failing test for `ChangePasswordPage`**

Create `staff-web/src/pages/ChangePasswordPage.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChangePasswordPage } from './ChangePasswordPage';
import { AuthProvider } from '../auth/AuthProvider';
import { changePassword, getMe } from '../api/auth';

vi.mock('../api/auth');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('kalamy_staff_token', 'existing-token');
});

describe('ChangePasswordPage', () => {
  it('submits current and new password, then refreshes the user', async () => {
    (getMe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: true })
      .mockResolvedValueOnce({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: false });
    (changePassword as ReturnType<typeof vi.fn>).mockResolvedValue({ changed: true });

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChangePasswordPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('يجب تغيير كلمة المرور')).toBeTruthy();
    }, { timeout: 3000 });

    fireEvent.change(screen.getByLabelText('كلمة المرور الحالية'), { target: { value: 'temp123' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByText('تحديث كلمة المرور'));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({ currentPassword: 'temp123', newPassword: 'newpassword123' });
      expect(getMe).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd staff-web && npm test -- ChangePasswordPage.test.tsx`
Expected: FAIL — `staff-web/src/pages/ChangePasswordPage.tsx` doesn't exist yet.

- [ ] **Step 3: Write `ChangePasswordPage.tsx`**

Create `staff-web/src/pages/ChangePasswordPage.tsx`:

```typescript
import { useState } from 'react';
import { Container, Title, Text, PasswordInput, Button, Alert, Stack } from '@mantine/core';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { changePassword } from '../api/auth';
import { ApiError } from '../api/client';

export function ChangePasswordPage() {
  const { refreshUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={420} my={80}>
      <Title order={2} ta="center" mb="xs">{ar.changePassword.title}</Title>
      <Text ta="center" c="dimmed" mb="lg">{ar.changePassword.description}</Text>
      <form onSubmit={handleSubmit}>
        <Stack>
          {error ? <Alert color="red">{error}</Alert> : null}
          <PasswordInput label={ar.changePassword.currentPasswordLabel} value={currentPassword} onChange={(e) => setCurrentPassword(e.currentTarget.value)} />
          <PasswordInput label={ar.changePassword.newPasswordLabel} value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
          <Button type="submit" loading={submitting} fullWidth>{ar.changePassword.submitButton}</Button>
        </Stack>
      </form>
    </Container>
  );
}
```

After a successful `changePassword` + `refreshUser()`, `user.mustChangePassword` becomes `false` in the `AuthProvider`'s state — Step 6's `RequireAuth` component reacts to that automatically (it re-renders and stops forcing this page), so this page doesn't need to navigate anywhere itself.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd staff-web && npm test -- ChangePasswordPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `RequireAuth`**

Create `staff-web/src/auth/RequireAuth.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import { AuthProvider } from './AuthProvider';
import { getMe } from '../api/auth';

vi.mock('../api/auth');

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/change-password" element={<div>change password page</div>} />
          <Route
            path="/patients"
            element={
              <RequireAuth>
                <div>patients page</div>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('RequireAuth', () => {
  it('redirects to /login when there is no logged-in user', async () => {
    renderAt('/patients');

    await waitFor(() => {
      expect(screen.getByText('login page')).toBeTruthy();
    });
  });

  it('redirects to /change-password when the user must change their password', async () => {
    localStorage.setItem('kalamy_staff_token', 'existing-token');
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: true });

    renderAt('/patients');

    await waitFor(() => {
      expect(screen.getByText('change password page')).toBeTruthy();
    });
  });

  it('renders the protected content when logged in and mustChangePassword is false', async () => {
    localStorage.setItem('kalamy_staff_token', 'existing-token');
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: false });

    renderAt('/patients');

    await waitFor(() => {
      expect(screen.getByText('patients page')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd staff-web && npm test -- RequireAuth.test.tsx`
Expected: FAIL — `staff-web/src/auth/RequireAuth.tsx` doesn't exist yet.

- [ ] **Step 7: Write `RequireAuth.tsx`**

Create `staff-web/src/auth/RequireAuth.tsx`:

```typescript
import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd staff-web && npm test -- RequireAuth.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 9: Wire `/change-password` into `App.tsx`, guarded by `RequireAuth`**

Read `staff-web/src/App.tsx` first (from Task 5). Replace it with:

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordPage />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

Note `/change-password` is itself wrapped in `RequireAuth` — this is intentional: it still requires being logged in (so an anonymous visitor can't reach it), but `RequireAuth`'s own `location.pathname !== '/change-password'` check means it won't redirect-loop on itself.

- [ ] **Step 10: Run the full staff-web suite to confirm everything passes together**

Run: `cd staff-web && npm test`
Expected: every test passes (16 from Tasks 2-5 + 1 ChangePasswordPage + 3 RequireAuth = 20 total).

- [ ] **Step 11: Commit**

```bash
git add staff-web/src/pages/ChangePasswordPage.tsx staff-web/src/pages/ChangePasswordPage.test.tsx staff-web/src/auth/RequireAuth.tsx staff-web/src/auth/RequireAuth.test.tsx staff-web/src/App.tsx
git commit -m "feat: add forced Change Password screen and RequireAuth route guard"
```

---

### Task 7: Staff web — App shell + Patient search screen

**Files:**
- Create: `staff-web/src/api/patients.ts`
- Create: `staff-web/src/components/AppShell.tsx`
- Create: `staff-web/src/pages/PatientsPage.tsx`
- Modify: `staff-web/src/App.tsx`
- Test: `staff-web/src/pages/PatientsPage.test.tsx`
- Test: `staff-web/src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: `apiRequest` (Task 3); `useAuth()` (Task 4); `RequireAuth` (Task 6).
- Produces: nothing consumed by later tasks in this sub-project — this is the last task before verification. Sub-project 2 will import `PatientSearchResult`'s shape conventions when it builds the patient detail view, but does not import this file directly (it fetches by ID via a different endpoint).

- [ ] **Step 1: Write `api/patients.ts`**

Create `staff-web/src/api/patients.ts`:

```typescript
import { apiRequest } from './client';

export type Gender = 'MALE' | 'FEMALE';
export type PatientProfileStatus = 'ACTIVE' | 'DISABLED';

export interface PatientSearchResult {
  id: string;
  fullName: string;
  nationalId: string;
  gender: Gender;
  dateOfBirth: string;
  status: PatientProfileStatus;
}

export function searchPatients(query: string): Promise<PatientSearchResult[]> {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  return apiRequest(`/api/v1/patients${params}`, { auth: true });
}
```

No dedicated test file for this module, matching the established convention for thin API-client wrappers (`api/auth.ts` above, and the mobile app's `api/reports.ts`/`api/complaints.ts`) — verified through `PatientsPage`'s test, which mocks it.

- [ ] **Step 2: Write the failing test for `AppShell`**

Create `staff-web/src/components/AppShell.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { AuthProvider } from '../auth/AuthProvider';
import { getMe } from '../api/auth';

vi.mock('../api/auth');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('kalamy_staff_token', 'existing-token');
});

describe('AppShell', () => {
  it("shows the logged-in user's name and Arabic role label, and a Patients link", async () => {
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: false });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AppShell>
            <div>page content</div>
          </AppShell>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Dr. Sara')).toBeTruthy();
      expect(screen.getByText('أخصائي')).toBeTruthy();
      expect(screen.getByText('المرضى')).toBeTruthy();
      expect(screen.getByText('page content')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('logs out when the logout button is pressed', async () => {
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: false });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AppShell>
            <div>page content</div>
          </AppShell>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('تسجيل الخروج')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('تسجيل الخروج'));

    await waitFor(() => {
      expect(localStorage.getItem('kalamy_staff_token')).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd staff-web && npm test -- AppShell.test.tsx`
Expected: FAIL — `staff-web/src/components/AppShell.tsx` doesn't exist yet.

- [ ] **Step 4: Write `AppShell.tsx`**

Create `staff-web/src/components/AppShell.tsx`:

```typescript
import { ReactNode } from 'react';
import { AppShell as MantineAppShell, Group, Text, Button, NavLink } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <MantineAppShell header={{ height: 60 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="md">
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text fw={600}>كلامي</Text>
          <Group>
            {user ? (
              <Text size="sm">
                {user.fullName} — {ar.shell.roles[user.role]}
              </Text>
            ) : null}
            <Button variant="subtle" onClick={handleLogout}>{ar.shell.logoutButton}</Button>
          </Group>
        </Group>
      </MantineAppShell.Header>
      <MantineAppShell.Navbar p="md">
        <NavLink component={Link} to="/patients" label={ar.shell.patientsLink} />
      </MantineAppShell.Navbar>
      <MantineAppShell.Main>{children}</MantineAppShell.Main>
    </MantineAppShell>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd staff-web && npm test -- AppShell.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 6: Write the failing test for `PatientsPage`**

Create `staff-web/src/pages/PatientsPage.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PatientsPage } from './PatientsPage';
import { searchPatients } from '../api/patients';
import { ApiError } from '../api/client';

vi.mock('../api/patients');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PatientsPage', () => {
  it('shows the empty-state prompt before any search is run', () => {
    render(<PatientsPage />);
    expect(screen.getByText('ابحث عن مريض بالاسم أو رقم الهوية')).toBeTruthy();
    expect(searchPatients).not.toHaveBeenCalled();
  });

  it('searches and renders a results table', async () => {
    (searchPatients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'patient-1',
        fullName: 'محمد العتيبي',
        nationalId: '1234567890',
        gender: 'MALE',
        dateOfBirth: '1995-05-05T00:00:00.000Z',
        status: 'ACTIVE',
      },
    ]);

    render(<PatientsPage />);
    fireEvent.change(screen.getByPlaceholderText('ابحث بالاسم أو رقم الهوية'), { target: { value: 'محمد' } });
    fireEvent.submit(screen.getByTestId('patient-search-form'));

    await waitFor(
      () => {
        expect(searchPatients).toHaveBeenCalledWith('محمد');
        expect(screen.getByText('محمد العتيبي')).toBeTruthy();
        expect(screen.getByText('1234567890')).toBeTruthy();
        expect(screen.getByText('ذكر')).toBeTruthy();
        expect(screen.getByText('نشط')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it('shows the no-results message when a search returns nothing', async () => {
    (searchPatients as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<PatientsPage />);
    fireEvent.change(screen.getByPlaceholderText('ابحث بالاسم أو رقم الهوية'), { target: { value: 'zzz' } });
    fireEvent.submit(screen.getByTestId('patient-search-form'));

    await waitFor(() => {
      expect(screen.getByText('لا توجد نتائج')).toBeTruthy();
    });
  });

  it('shows an error alert when the search fails', async () => {
    (searchPatients as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Something broke'));

    render(<PatientsPage />);
    fireEvent.change(screen.getByPlaceholderText('ابحث بالاسم أو رقم الهوية'), { target: { value: 'a' } });
    fireEvent.submit(screen.getByTestId('patient-search-form'));

    await waitFor(() => {
      expect(screen.getByText('Something broke')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd staff-web && npm test -- PatientsPage.test.tsx`
Expected: FAIL — `staff-web/src/pages/PatientsPage.tsx` doesn't exist yet.

- [ ] **Step 8: Write `PatientsPage.tsx`**

Create `staff-web/src/pages/PatientsPage.tsx`:

```typescript
import { useState } from 'react';
import { Container, Title, TextInput, Button, Table, Alert, Group, Text } from '@mantine/core';
import { ar } from '../copy/ar';
import { searchPatients, PatientSearchResult } from '../api/patients';
import { ApiError } from '../api/client';

export function PatientsPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSearching(true);
    try {
      const found = await searchPatients(query);
      setResults(found);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSearching(false);
    }
  }

  return (
    <Container size="lg">
      <Title order={2} mb="md">{ar.patients.title}</Title>
      <form data-testid="patient-search-form" onSubmit={handleSubmit}>
        <Group mb="md">
          <TextInput
            placeholder={ar.patients.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button type="submit" loading={searching}>{ar.patients.searchPlaceholder}</Button>
        </Group>
      </form>

      {error ? <Alert color="red" mb="md">{error}</Alert> : null}

      {results === null ? (
        <Text c="dimmed">{ar.patients.emptyState}</Text>
      ) : results.length === 0 ? (
        <Text c="dimmed">{ar.patients.noResults}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.patients.tableName}</Table.Th>
              <Table.Th>{ar.patients.tableNationalId}</Table.Th>
              <Table.Th>{ar.patients.tableGender}</Table.Th>
              <Table.Th>{ar.patients.tableDateOfBirth}</Table.Th>
              <Table.Th>{ar.patients.tableStatus}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {results.map((patient) => (
              <Table.Tr key={patient.id}>
                <Table.Td>{patient.fullName}</Table.Td>
                <Table.Td>{patient.nationalId}</Table.Td>
                <Table.Td>{ar.patients.genders[patient.gender]}</Table.Td>
                <Table.Td>{patient.dateOfBirth}</Table.Td>
                <Table.Td>{ar.patients.statuses[patient.status]}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd staff-web && npm test -- PatientsPage.test.tsx`
Expected: PASS, all 4 tests.

- [ ] **Step 10: Wire `/patients` into `App.tsx`, guarded by `RequireAuth` and wrapped in `AppShell`**

Read `staff-web/src/App.tsx` first (from Task 6). Replace it with:

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { PatientsPage } from './pages/PatientsPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordPage />
              </RequireAuth>
            }
          />
          <Route
            path="/patients"
            element={
              <RequireAuth>
                <AppShell>
                  <PatientsPage />
                </AppShell>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 11: Run the full staff-web suite to confirm everything passes together**

Run: `cd staff-web && npm test`
Expected: every test passes (20 from Tasks 2-6 + 2 AppShell + 4 PatientsPage = 26 total, across 11 test files).

- [ ] **Step 12: Commit**

```bash
git add staff-web/src/api/patients.ts staff-web/src/components/AppShell.tsx staff-web/src/components/AppShell.test.tsx staff-web/src/pages/PatientsPage.tsx staff-web/src/pages/PatientsPage.test.tsx staff-web/src/App.tsx
git commit -m "feat: add App shell and Patient search screen"
```

---

### Task 8: Full suite verification + manual walkthrough

**Files:**
- None created or modified — this task only runs and confirms.

**Interfaces:**
- None produced — verification only.

- [ ] **Step 1: Run the full backend e2e suite**

```bash
cd backend
npm run test:e2e
```
Expected: every suite passes, with 3 more tests than the pre-plan baseline (Task 1's new tests), same suite count.

- [ ] **Step 2: Run `tsc --noEmit` on the backend**

```bash
cd backend
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Run the full staff-web test suite**

```bash
cd staff-web
npm test
```
Expected: all 26 tests pass across 11 test files.

- [ ] **Step 4: Run `tsc --noEmit` on staff-web**

```bash
cd staff-web
npx tsc --noEmit
```
Expected: zero errors (this is a fresh TypeScript project with no pre-existing type-error debt to account for, unlike the mobile app's jest-namespace situation).

- [ ] **Step 5: Manual walkthrough against the running dev servers**

Start both dev servers directly via `npm run start:dev` (backend) / `npm run dev` (staff-web) from this worktree's own directories — confirm via their startup logs that they compiled from the correct worktree path. If the browser tool is available, use it for an actual click-through; if not, drive the same flow directly against the real running backend via a Node/`fetch` script (not `curl -d` with inline Arabic strings — that has previously mangled UTF-8 bytes via Git-Bash/Windows encoding).

1. Register a clinician-role test account directly via the backend (register as PATIENT then promote the role to CLINICIAN via a direct DB update, matching the pattern used in prior e2e tests and manual walkthroughs — e.g. `docker exec backend-postgres-1 psql -U kalamy -d kalamy -c "UPDATE \"User\" SET role='CLINICIAN', \"mustChangePassword\"=true WHERE mobile='<mobile>';"`), with `mustChangePassword` set to `true`.
2. In the staff-web app, log in with that account — confirm it's immediately redirected to the forced Change Password screen and no other page is reachable (try manually navigating to `/patients` in the address bar — confirm it redirects back to `/change-password`).
3. Complete the password change — confirm it now allows navigation to `/patients` and shows the app shell with the correct name and Arabic role label ("أخصائي").
4. In the Patients page, create a real patient profile directly via the backend API (matching the pattern from prior walkthroughs), then search for them by name and separately by national ID — confirm both return the expected row with correctly-labeled gender and status.
5. Log out — confirm it redirects to `/login` and that navigating back to `/patients` afterward redirects to `/login` (not silently showing stale content).
6. Repeat steps 1-3 with a SUPERVISOR-role and an ADMIN-role account (promoted the same way) — confirm both can also reach `/patients` and see their own correct Arabic role label ("مشرف" / "مدير النظام"), confirming the "one unified app for all three roles" decision actually works end-to-end, not just for CLINICIAN.

This step has no automated pass/fail — its purpose is to catch anything the component-test mocks might have papered over (a real route-guard bug, a real Arabic-label mismatch, a genuine cross-role permission issue). Report what you saw; if anything looks wrong, fix it in the relevant earlier task's files and re-run that task's own test file before continuing.

- [ ] **Step 6: Commit (only if Step 5 required fixes)**

If Step 5 surfaced no issues, there is nothing to commit for this task. If it did, commit the fix with a message describing what the manual walkthrough caught that the automated tests didn't.

---

## Self-Review Notes

**Spec coverage**: every in-scope item from `docs/superpowers/specs/2026-07-11-staff-web-foundation-design.md` has a task — the backend gap (Task 1), the Vite/Mantine/RTL scaffold (Task 2), session/API infrastructure (Task 3), auth logic (Task 4), login/forgot/reset screens (Task 5), the forced change-password flow (Task 6), and the app shell + patient search (Task 7). The spec's key decisions — one unified app for all three roles, forced password-change, read-only patient search with no click-through, Mantine over hand-rolling, Vite over Next.js — are all directly reflected in the code (role-conditional label lookup rather than separate apps; `RequireAuth`'s `mustChangePassword` check; no detail-view route exists anywhere in `App.tsx`).

**Placeholder scan**: no task contains "TBD"/"TODO"/"add error handling"/"similar to Task N" — every step has complete, copy-pasteable code, and every test asserts real behavior (specific Arabic strings, specific function-call arguments), not `expect(true).toBe(true)`-style stand-ins.

**Type consistency, checked across tasks**: `StaffUser` (with `mustChangePassword`) is defined once in Task 4's `api/auth.ts` and consumed identically by `AuthProvider`, `RequireAuth`, and `AppShell`. `PatientSearchResult` is defined once in Task 7's `api/patients.ts` and consumed only by `PatientsPage` in this sub-project. The backend's `GET /api/v1/auth/me` response fields (`id`, `fullName`, `mobile`, `role`, `mustChangePassword`) match `StaffUser`'s fields exactly — verified directly against the Task 1 backend code, not assumed. `PatientSearchResult`'s fields (`id`, `fullName`, `nationalId`, `gender`, `dateOfBirth`, `status`) match the real `PatientProfile` Prisma model's field names exactly — verified directly against `backend/prisma/schema.prisma`.

**Route-guard interaction checked**: `RequireAuth`'s `location.pathname !== '/change-password'` guard was specifically designed to avoid a redirect loop when `/change-password` is itself wrapped in `RequireAuth` (Task 6, Step 9) — confirmed this reasoning holds by tracing through all three states (`mustChangePassword: true` while on `/change-password` → renders the page; `mustChangePassword: true` while on `/patients` → redirects; `mustChangePassword: false` anywhere → no redirect).
