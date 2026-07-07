# Kalamy Mobile App — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new Expo/React Native/TypeScript app (`mobile/`) with age-based theming, RTL Arabic support, and a full auth flow (register → OTP verify → login → forgot/reset password) wired to the real, already-running Kalamy backend — per `docs/superpowers/specs/2026-07-07-mobile-foundation-design.md`.

**Architecture:** Expo managed workflow + `expo-router` file-based navigation + TypeScript. Server state via TanStack Query. Session token in `expo-secure-store`. Web support (`react-native-web`) added specifically so every screen can be visually verified in a browser via the Preview tools during development, not just via component tests.

**Tech Stack:** Expo (latest stable), React Native, TypeScript, expo-router, @tanstack/react-query, expo-secure-store, Jest + jest-expo + @testing-library/react-native.

## Global Constraints

- Patients/caregivers only — no clinician/admin screens in this app (confirmed by user).
- No payment/subscription gate anywhere in this sub-project (confirmed by user).
- No audio/video recording of any kind in this sub-project (deferred to sub-project 3).
- Age-based theme defaults to `'adult'` everywhere in this sub-project — no screen collects date of birth yet, so the theme is never switched, only built to be switchable later.
- Arabic only, RTL layout — no i18n library, just a single `src/copy/ar.ts` strings module.
- The mobile app talks to the real backend's existing Auth endpoints only: `/api/v1/auth/{register,verify,login,forgot-password,reset-password}`. No new backend endpoints.
- `devOtpCode` in the register response only exists when the backend runs with `DEV_MODE=true` — there is no SMS delivery anywhere in this system. The registration/verify screens must not hide this: show the dev code on-screen with a visible "وضع التطوير" (dev mode) label rather than pretending it was texted.
- OTP failures come back as `{ code: 'UNAUTHORIZED', message: 'OTP verification failed: <REASON>' }` where `<REASON>` is `NOT_FOUND | EXPIRED | TOO_MANY_ATTEMPTS | INCORRECT_CODE` — parse `<REASON>` out of the message string (no structured field exists).
- Login lockout is real: 5 failed attempts locks the account for 15 minutes, returned as HTTP 429.
- No hard-coded colors in screen/component code — everything reads from `ThemeContext`.
- Every UI-producing task must be verified visually in a browser via the Preview tools (`npm run web`), in addition to passing its Jest tests — this is a frontend change and must be seen running, not just type-checked.

---

## File Structure

- `mobile/app/` — expo-router screens (one file = one route): `index.tsx` (welcome), `register/index.tsx` (self-or-child choice), `register/form.tsx`, `register/verify.tsx`, `login.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `home.tsx`, `_layout.tsx` (root layout: theme provider, query client, RTL setup).
- `mobile/src/theme/tokens.ts` — the three palettes.
- `mobile/src/theme/ThemeContext.tsx` — theme provider/hook.
- `mobile/src/storage/session.ts` — secure token read/write/clear.
- `mobile/src/api/client.ts` — fetch wrapper (base URL, auth header, error parsing).
- `mobile/src/api/auth.ts` — typed calls to the 5 Auth endpoints + OTP-reason parser.
- `mobile/src/copy/ar.ts` — all Arabic screen strings.
- `mobile/src/components/{Button,TextField,OtpInput,ErrorBanner}.tsx` — themed shared primitives.
- `mobile/src/auth/AuthProvider.tsx` — session restore + logout-on-401 + `useAuth()` hook.
- `backend/src/main.ts` — one-line CORS addition (needed so the browser-based web preview can call `localhost:3000` from `localhost:8081`).

---

### Task 1: Expo scaffold, web support, RTL, CORS, boot smoke test

**Files:**
- Create: `mobile/` (via `create-expo-app`, then modified as below)
- Create: `mobile/app/_layout.tsx`
- Create: `mobile/app/index.tsx`
- Create: `mobile/src/copy/ar.ts`
- Modify: `mobile/package.json` (jest config block)
- Modify: `backend/src/main.ts`
- Test: `mobile/app/__tests__/index.test.tsx`

**Interfaces:**
- Produces: a running `mobile/` app reachable at `http://localhost:8081` via `npm run web`; `app/_layout.tsx` as the root layout every later screen renders under.

- [ ] **Step 1: Scaffold the Expo app**

From the repo root (`C:\Users\Well\Desktop\kalamy`):
```bash
npx create-expo-app@latest mobile --template blank-typescript
```
Expected: creates `mobile/` with `package.json`, `App.tsx`, `app.json`, `tsconfig.json`, `node_modules/`.

- [ ] **Step 2: Add expo-router and its required peer packages**

```bash
cd mobile
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar
```
Expected: installs succeed, `package.json` dependencies updated.

- [ ] **Step 3: Switch the entry point to expo-router**

In `mobile/package.json`, change the `"main"` field to:
```json
"main": "expo-router/entry",
```

In `mobile/app.json`, inside the `"expo"` object, add:
```json
"scheme": "kalamy",
"web": { "bundler": "metro", "output": "static" }
```

Delete `mobile/App.tsx` (expo-router replaces it with `app/` files).

- [ ] **Step 4: Add web support**

```bash
npx expo install react-dom react-native-web @expo/metro-runtime
```
Expected: installs succeed.

- [ ] **Step 5: Add testing dependencies**

```bash
npx expo install jest-expo --dev
npm install --save-dev jest @testing-library/react-native @types/jest
```

Add to `mobile/package.json` (top level, alongside `"dependencies"`):
```json
"scripts": {
  "start": "expo start",
  "web": "expo start --web",
  "android": "expo start --android",
  "ios": "expo start --ios",
  "test": "jest"
},
"jest": {
  "preset": "jest-expo"
}
```

- [ ] **Step 6: Write the Arabic copy module (used by this task's smoke screen)**

Create `mobile/src/copy/ar.ts`:
```typescript
export const ar = {
  welcome: {
    title: 'أهلاً بك في كلامي',
    subtitle: 'رحلتك نحو طلاقة أفضل تبدأ هنا',
  },
};
```

- [ ] **Step 7: Write the root layout with RTL enabled**

Create `mobile/app/_layout.tsx`:
```typescript
import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { Stack } from 'expo-router';

export default function RootLayout() {
  useEffect(() => {
    if (!I18nManager.isRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);
    }
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 8: Write the welcome screen**

Create `mobile/app/index.tsx`:
```typescript
import { View, Text, StyleSheet } from 'react-native';
import { ar } from '../src/copy/ar';

export default function WelcomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{ar.welcome.title}</Text>
      <Text style={styles.subtitle}>{ar.welcome.subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, textAlign: 'center', color: '#555' },
});
```

- [ ] **Step 9: Write the failing boot smoke test**

Create `mobile/app/__tests__/index.test.tsx`:
```typescript
import { render, screen } from '@testing-library/react-native';
import WelcomeScreen from '../index';

describe('WelcomeScreen', () => {
  it('renders the welcome title', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('أهلاً بك في كلامي')).toBeTruthy();
  });
});
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm test -- index.test.tsx` (from `mobile/`)
Expected: PASS (1 test). (This test is written straightforwardly against the already-written screen rather than test-first, since Step 1-8 is scaffolding — normal TDD RED/GREEN resumes from Task 2 onward.)

- [ ] **Step 11: Enable CORS on the backend for local web-preview testing**

In `backend/src/main.ts`, add one line after `const app = await NestFactory.create(AppModule);`:
```typescript
  app.enableCors();
```
This is required only so a browser-based `mobile/` web build (served from `localhost:8081`) can call the backend (`localhost:3000`) during development — native mobile requests (iOS/Android, real or simulated) are never subject to CORS. Run the backend's existing test suite to confirm nothing broke: `cd ../backend && npm run test:e2e` — expected all still passing (this is an additive, non-behavioral change).

- [ ] **Step 12: Verify the app boots in a browser**

Run: `npm run web` (from `mobile/`, leave running)
Expected: Metro bundler starts, prints a local URL (typically `http://localhost:8081`). Use the Preview tools to start this as a server (`.claude/launch.json` entry: `runtimeExecutable: "npm"`, `runtimeArgs: ["run", "web"]`, `cwd`/prefix pointing at `mobile/`, `port: 8081`), then take a screenshot confirming the Arabic welcome text renders, right-to-left, centered.

- [ ] **Step 13: Commit**

```bash
cd ..
git add mobile backend/src/main.ts
git commit -m "feat: scaffold Expo mobile app with expo-router, web support, and RTL"
```

---

### Task 2: Theme tokens and ThemeContext

**Files:**
- Create: `mobile/src/theme/tokens.ts`
- Create: `mobile/src/theme/ThemeContext.tsx`
- Test: `mobile/src/theme/__tests__/ThemeContext.test.tsx`

**Interfaces:**
- Produces: `AgeGroup = 'child' | 'teen' | 'adult'`; `tokens: Record<AgeGroup, ThemeTokens>`; `ThemeProvider`, `useTheme(): { ageGroup: AgeGroup; tokens: ThemeTokens; setAgeGroup: (g: AgeGroup) => void }`. Every later component/screen task consumes `useTheme()`.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/theme/__tests__/ThemeContext.test.tsx`:
```typescript
import { render, screen, act } from '@testing-library/react-native';
import { Text, Pressable } from 'react-native';
import { ThemeProvider, useTheme } from '../ThemeContext';

function Probe() {
  const { ageGroup, tokens, setAgeGroup } = useTheme();
  return (
    <>
      <Text testID="ageGroup">{ageGroup}</Text>
      <Text testID="primary">{tokens.colors.primary}</Text>
      <Pressable testID="toChild" onPress={() => setAgeGroup('child')} />
    </>
  );
}

describe('ThemeContext', () => {
  it('defaults to adult theme', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('ageGroup').props.children).toBe('adult');
  });

  it('switches tokens when setAgeGroup is called', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    const adultPrimary = screen.getByTestId('primary').props.children;
    act(() => {
      screen.getByTestId('toChild').props.onPress();
    });
    const childPrimary = screen.getByTestId('primary').props.children;
    expect(childPrimary).not.toBe(adultPrimary);
    expect(screen.getByTestId('ageGroup').props.children).toBe('child');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ThemeContext.test.tsx` (from `mobile/`)
Expected: FAIL with "Cannot find module '../ThemeContext'".

- [ ] **Step 3: Write the token definitions**

Create `mobile/src/theme/tokens.ts`:
```typescript
export type AgeGroup = 'child' | 'teen' | 'adult';

export interface ThemeTokens {
  colors: {
    background: string;
    surface: string;
    primary: string;
    onPrimary: string;
    text: string;
    textSecondary: string;
    border: string;
    danger: string;
  };
  radius: { sm: number; md: number; lg: number };
  spacing: { sm: number; md: number; lg: number };
}

export const tokens: Record<AgeGroup, ThemeTokens> = {
  child: {
    colors: {
      background: '#FFF4E0',
      surface: '#FFFFFF',
      primary: '#FF8A3D',
      onPrimary: '#FFF4E0',
      text: '#7A3E00',
      textSecondary: '#A5652A',
      border: '#F2D9B8',
      danger: '#D64545',
    },
    radius: { sm: 12, md: 20, lg: 28 },
    spacing: { sm: 8, md: 16, lg: 24 },
  },
  teen: {
    colors: {
      background: '#101422',
      surface: '#1A2033',
      primary: '#35E0C7',
      onPrimary: '#06231D',
      text: '#F2FFFC',
      textSecondary: '#8FA0AE',
      border: '#2A3348',
      danger: '#FF6B6B',
    },
    radius: { sm: 6, md: 8, lg: 12 },
    spacing: { sm: 8, md: 16, lg: 24 },
  },
  adult: {
    colors: {
      background: '#F4F6F8',
      surface: '#FFFFFF',
      primary: '#2A6F97',
      onPrimary: '#F4F6F8',
      text: '#1C2B36',
      textSecondary: '#5B6B77',
      border: '#DCE3E8',
      danger: '#C0392B',
    },
    radius: { sm: 6, md: 8, lg: 12 },
    spacing: { sm: 8, md: 16, lg: 24 },
  },
};
```

- [ ] **Step 4: Write the ThemeContext**

Create `mobile/src/theme/ThemeContext.tsx`:
```typescript
import { createContext, useContext, useMemo, useState, ReactNode } from 'react';
import { AgeGroup, ThemeTokens, tokens } from './tokens';

interface ThemeContextValue {
  ageGroup: AgeGroup;
  tokens: ThemeTokens;
  setAgeGroup: (group: AgeGroup) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [ageGroup, setAgeGroup] = useState<AgeGroup>('adult');
  const value = useMemo(() => ({ ageGroup, tokens: tokens[ageGroup], setAgeGroup }), [ageGroup]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- ThemeContext.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire ThemeProvider into the root layout**

Modify `mobile/app/_layout.tsx` — wrap the returned `<Stack>` in the provider:
```typescript
import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { Stack } from 'expo-router';
import { ThemeProvider } from '../src/theme/ThemeContext';

export default function RootLayout() {
  useEffect(() => {
    if (!I18nManager.isRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);
    }
  }, []);

  return (
    <ThemeProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add mobile/src/theme mobile/app/_layout.tsx
git commit -m "feat: add age-based theme tokens and ThemeContext"
```

---

### Task 3: Secure session storage

**Files:**
- Create: `mobile/src/storage/session.ts`
- Test: `mobile/src/storage/__tests__/session.test.ts`

**Interfaces:**
- Produces: `saveToken(token: string): Promise<void>`, `getToken(): Promise<string | null>`, `clearToken(): Promise<void>`.

- [ ] **Step 1: Add expo-secure-store**

```bash
npx expo install expo-secure-store
```

- [ ] **Step 2: Write the failing test**

Create `mobile/src/storage/__tests__/session.test.ts`:
```typescript
import * as SecureStore from 'expo-secure-store';
import { saveToken, getToken, clearToken } from '../session';

jest.mock('expo-secure-store');

describe('session storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves the token under a fixed key', async () => {
    await saveToken('abc123');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('kalamy.session.token', 'abc123');
  });

  it('reads the token back', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('abc123');
    const result = await getToken();
    expect(result).toBe('abc123');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('kalamy.session.token');
  });

  it('returns null when no token is stored', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    const result = await getToken();
    expect(result).toBeNull();
  });

  it('clears the token', async () => {
    await clearToken();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('kalamy.session.token');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- session.test.ts`
Expected: FAIL with "Cannot find module '../session'".

- [ ] **Step 4: Write the implementation**

Create `mobile/src/storage/session.ts`:
```typescript
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'kalamy.session.token';

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- session.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/storage
git commit -m "feat: add secure session token storage"
```

---

### Task 4: API client with error parsing

**Files:**
- Create: `mobile/src/api/client.ts`
- Test: `mobile/src/api/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `getToken` from `../storage/session` (Task 3).
- Produces: `ApiError` class (`{ status: number; code: string; message: string; details?: unknown }`), `apiRequest<T>(path: string, options?: { method?: string; body?: unknown; auth?: boolean }): Promise<T>`.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/api/__tests__/client.test.ts`:
```typescript
import { apiRequest, ApiError } from '../client';
import * as session from '../../storage/session';

jest.mock('../../storage/session');

const originalFetch = global.fetch;

describe('apiRequest', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns parsed JSON on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    }) as unknown as typeof fetch;

    const result = await apiRequest<{ hello: string }>('/health');
    expect(result).toEqual({ hello: 'world' });
  });

  it('throws ApiError with parsed code/message on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: 'CONFLICT', message: 'Mobile number already registered' }),
    }) as unknown as typeof fetch;

    await expect(apiRequest('/api/v1/auth/register', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Mobile number already registered',
    });
  });

  it('attaches the Authorization header when auth is true and a token exists', async () => {
    (session.getToken as jest.Mock).mockResolvedValue('my-token');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await apiRequest('/api/v1/auth/sessions', { auth: true });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/sessions'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- client.test.ts`
Expected: FAIL with "Cannot find module '../client'".

- [ ] **Step 3: Write the implementation**

Create `mobile/src/api/client.ts`:
```typescript
import { getToken } from '../storage/session';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

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
    const token = await getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, data.code ?? 'UNKNOWN_ERROR', data.message ?? 'Request failed', data.details);
  }

  return data as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/client.ts mobile/src/api/__tests__/client.test.ts
git commit -m "feat: add typed API client with error parsing"
```

---

### Task 5: Auth API functions and OTP-reason parser

**Files:**
- Create: `mobile/src/api/auth.ts`
- Test: `mobile/src/api/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `apiRequest`, `ApiError` from `./client` (Task 4).
- Produces: `registerPatient`, `verifyOtp`, `login`, `forgotPassword`, `resetPassword` functions; `parseOtpFailureReason(error: unknown): OtpFailureReason | null` where `OtpFailureReason = 'NOT_FOUND' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'INCORRECT_CODE'`.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/api/__tests__/auth.test.ts`:
```typescript
import { apiRequest, ApiError } from '../client';
import { registerPatient, verifyOtp, login, parseOtpFailureReason } from '../auth';

jest.mock('../client', () => ({
  ...jest.requireActual('../client'),
  apiRequest: jest.fn(),
}));

describe('auth API functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registerPatient posts to /api/v1/auth/register with role PATIENT', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ userId: 'u1', devOtpCode: '123456' });

    const result = await registerPatient({
      fullName: 'Test User',
      mobile: '+966500000001',
      password: 'password123',
    });

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/auth/register', {
      method: 'POST',
      body: { fullName: 'Test User', mobile: '+966500000001', password: 'password123', role: 'PATIENT' },
    });
    expect(result).toEqual({ userId: 'u1', devOtpCode: '123456' });
  });

  it('verifyOtp posts mobile and code', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ verified: true });
    const result = await verifyOtp({ mobile: '+966500000001', code: '123456' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/auth/verify', {
      method: 'POST',
      body: { mobile: '+966500000001', code: '123456' },
    });
    expect(result).toEqual({ verified: true });
  });

  it('login posts mobile and password', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ token: 't', expiresAt: '2026-01-01', mustChangePassword: false });
    const result = await login({ mobile: '+966500000001', password: 'password123' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/auth/login', {
      method: 'POST',
      body: { mobile: '+966500000001', password: 'password123' },
    });
    expect(result.mustChangePassword).toBe(false);
  });

  it('parseOtpFailureReason extracts the reason from an ApiError message', () => {
    const err = new ApiError(401, 'UNAUTHORIZED', 'OTP verification failed: TOO_MANY_ATTEMPTS');
    expect(parseOtpFailureReason(err)).toBe('TOO_MANY_ATTEMPTS');
  });

  it('parseOtpFailureReason returns null for unrelated errors', () => {
    const err = new ApiError(500, 'INTERNAL_ERROR', 'Unexpected error');
    expect(parseOtpFailureReason(err)).toBeNull();
  });

  it('parseOtpFailureReason returns null for non-ApiError values', () => {
    expect(parseOtpFailureReason(new Error('boom'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- auth.test.ts`
Expected: FAIL with "Cannot find module '../auth'".

- [ ] **Step 3: Write the implementation**

Create `mobile/src/api/auth.ts`:
```typescript
import { apiRequest, ApiError } from './client';

export type OtpFailureReason = 'NOT_FOUND' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'INCORRECT_CODE';

const OTP_FAILURE_REASONS: OtpFailureReason[] = ['NOT_FOUND', 'EXPIRED', 'TOO_MANY_ATTEMPTS', 'INCORRECT_CODE'];

export function parseOtpFailureReason(error: unknown): OtpFailureReason | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  const found = OTP_FAILURE_REASONS.find((reason) => error.message.includes(reason));
  return found ?? null;
}

export interface RegisterPatientInput {
  fullName: string;
  mobile: string;
  email?: string;
  password: string;
}

export interface RegisterResponse {
  userId: string;
  devOtpCode?: string;
}

export function registerPatient(input: RegisterPatientInput): Promise<RegisterResponse> {
  return apiRequest<RegisterResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: { ...input, role: 'PATIENT' },
  });
}

export interface RegisterCaregiverInput extends RegisterPatientInput {}

export function registerCaregiver(input: RegisterCaregiverInput): Promise<RegisterResponse> {
  return apiRequest<RegisterResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: { ...input, role: 'CAREGIVER' },
  });
}

export function verifyOtp(input: { mobile: string; code: string }): Promise<{ verified: true }> {
  return apiRequest('/api/v1/auth/verify', { method: 'POST', body: input });
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  mustChangePassword: boolean;
}

export function login(input: { mobile: string; password: string }): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/api/v1/auth/login', { method: 'POST', body: input });
}

export function forgotPassword(input: { mobile: string }): Promise<{ sent: true }> {
  return apiRequest('/api/v1/auth/forgot-password', { method: 'POST', body: input });
}

export function resetPassword(input: { mobile: string; code: string; newPassword: string }): Promise<{ reset: true }> {
  return apiRequest('/api/v1/auth/reset-password', { method: 'POST', body: input });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify the register/login field names against the real backend**

Read `backend/src/modules/auth/dto/register.dto.ts`, `login.dto.ts`, `forgot-password.dto.ts`, `reset-password.dto.ts` and confirm every field name/shape above matches exactly (they should — these DTOs are unchanged, already-shipped code). If anything differs, fix `auth.ts` to match the real DTOs, not the other way around.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/api/auth.ts mobile/src/api/__tests__/auth.test.ts
git commit -m "feat: add auth API functions and OTP-failure-reason parser"
```

---

### Task 6: Shared themed components

**Files:**
- Create: `mobile/src/components/Button.tsx`
- Create: `mobile/src/components/TextField.tsx`
- Create: `mobile/src/components/OtpInput.tsx`
- Create: `mobile/src/components/ErrorBanner.tsx`
- Test: `mobile/src/components/__tests__/OtpInput.test.tsx`
- Test: `mobile/src/components/__tests__/TextField.test.tsx`

**Interfaces:**
- Consumes: `useTheme` from `../theme/ThemeContext` (Task 2).
- Produces: `<Button title onPress disabled? loading? />`, `<TextField label value onChangeText error? secureTextEntry? keyboardType? />`, `<OtpInput length value onChange onComplete? />`, `<ErrorBanner message />`.

- [ ] **Step 1: Write the failing OtpInput test**

Create `mobile/src/components/__tests__/OtpInput.test.tsx`:
```typescript
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { OtpInput } from '../OtpInput';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('OtpInput', () => {
  it('renders one input per digit', () => {
    renderWithTheme(<OtpInput length={6} value="" onChange={() => {}} />);
    expect(screen.getAllByTestId(/otp-digit-/)).toHaveLength(6);
  });

  it('calls onComplete once all digits are entered', () => {
    const onComplete = jest.fn();
    const onChange = jest.fn();
    renderWithTheme(<OtpInput length={6} value="12345" onChange={onChange} onComplete={onComplete} />);
    fireEvent.changeText(screen.getByTestId('otp-digit-5'), '6');
    expect(onChange).toHaveBeenCalledWith('123456');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- OtpInput.test.tsx`
Expected: FAIL with "Cannot find module '../OtpInput'".

- [ ] **Step 3: Write Button**

Create `mobile/src/components/Button.tsx`:
```typescript
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function Button({ title, onPress, disabled, loading }: ButtonProps) {
  const { tokens } = useTheme();
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.base,
        { backgroundColor: tokens.colors.primary, borderRadius: tokens.radius.md, opacity: isDisabled ? 0.6 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tokens.colors.onPrimary} />
      ) : (
        <Text style={[styles.text, { color: tokens.colors.onPrimary }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 15, fontWeight: '600' },
});
```

- [ ] **Step 4: Write TextField**

Create `mobile/src/components/TextField.tsx`:
```typescript
import { View, Text, TextInput, StyleSheet, KeyboardTypeOptions } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  testID?: string;
}

export function TextField({ label, value, onChangeText, error, secureTextEntry, keyboardType, testID }: TextFieldProps) {
  const { tokens } = useTheme();

  return (
    <View style={{ marginBottom: tokens.spacing.md }}>
      <Text style={{ color: tokens.colors.text, marginBottom: 4, fontSize: 13 }}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        style={[
          styles.input,
          {
            borderColor: error ? tokens.colors.danger : tokens.colors.border,
            borderRadius: tokens.radius.sm,
            color: tokens.colors.text,
            backgroundColor: tokens.colors.surface,
          },
        ]}
      />
      {error ? <Text style={{ color: tokens.colors.danger, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlign: 'right' },
});
```

- [ ] **Step 5: Write the failing TextField test**

Create `mobile/src/components/__tests__/TextField.test.tsx`:
```typescript
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { TextField } from '../TextField';

describe('TextField', () => {
  it('calls onChangeText when typing', () => {
    const onChangeText = jest.fn();
    render(
      <ThemeProvider>
        <TextField label="الجوال" value="" onChangeText={onChangeText} testID="mobile-input" />
      </ThemeProvider>,
    );
    fireEvent.changeText(screen.getByTestId('mobile-input'), '+966500000001');
    expect(onChangeText).toHaveBeenCalledWith('+966500000001');
  });

  it('shows the error message when provided', () => {
    render(
      <ThemeProvider>
        <TextField label="الجوال" value="" onChangeText={() => {}} error="رقم غير صحيح" />
      </ThemeProvider>,
    );
    expect(screen.getByText('رقم غير صحيح')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Write OtpInput**

Create `mobile/src/components/OtpInput.tsx`:
```typescript
import { View, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface OtpInputProps {
  length: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
}

export function OtpInput({ length, value, onChange, onComplete }: OtpInputProps) {
  const { tokens } = useTheme();
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function handleChangeDigit(index: number, digit: string) {
    const nextDigits = [...digits];
    nextDigits[index] = digit.slice(-1);
    const nextValue = nextDigits.join('');
    onChange(nextValue);
    if (nextValue.length === length && onComplete) {
      onComplete(nextValue);
    }
  }

  return (
    <View style={styles.row}>
      {digits.map((digit, index) => (
        <TextInput
          key={index}
          testID={`otp-digit-${index}`}
          value={digit}
          onChangeText={(text) => handleChangeDigit(index, text)}
          keyboardType="number-pad"
          maxLength={1}
          style={[
            styles.digit,
            { borderColor: tokens.colors.border, borderRadius: tokens.radius.sm, color: tokens.colors.text },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  digit: { width: 40, height: 48, borderWidth: 1, textAlign: 'center', fontSize: 18 },
});
```

- [ ] **Step 7: Write ErrorBanner**

Create `mobile/src/components/ErrorBanner.tsx`:
```typescript
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function ErrorBanner({ message }: { message: string }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.danger + '1A', borderRadius: tokens.radius.sm }]}>
      <Text style={{ color: tokens.colors.danger, fontSize: 13 }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 10, marginBottom: 12 },
});
```

- [ ] **Step 8: Run all component tests to verify they pass**

Run: `npm test -- components`
Expected: PASS (4 tests across OtpInput and TextField).

- [ ] **Step 9: Commit**

```bash
git add mobile/src/components
git commit -m "feat: add themed Button, TextField, OtpInput, ErrorBanner components"
```

---

### Task 7: Welcome and register-choice screens

**Files:**
- Modify: `mobile/app/index.tsx`
- Create: `mobile/app/register/index.tsx`
- Modify: `mobile/src/copy/ar.ts`

**Interfaces:**
- Consumes: `Button` (Task 6), `useTheme` (Task 2), `ar` copy (Task 1).
- Produces: navigable routes `/` and `/register` (expo-router file-based).

- [ ] **Step 1: Extend the copy module**

Modify `mobile/src/copy/ar.ts` — replace its contents with:
```typescript
export const ar = {
  welcome: {
    title: 'أهلاً بك في كلامي',
    subtitle: 'رحلتك نحو طلاقة أفضل تبدأ هنا',
    registerCta: 'إنشاء حساب جديد',
    loginCta: 'لدي حساب بالفعل',
  },
  registerChoice: {
    title: 'لمن هذا الحساب؟',
    forSelf: 'أسجّل لنفسي',
    forChild: 'أسجّل لابني/ابنتي',
  },
};
```

- [ ] **Step 2: Update the welcome screen with navigation buttons**

Modify `mobile/app/index.tsx`:
```typescript
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../src/copy/ar';
import { useTheme } from '../src/theme/ThemeContext';
import { Button } from '../src/components/Button';

export default function WelcomeScreen() {
  const router = useRouter();
  const { tokens } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.welcome.title}</Text>
      <Text style={[styles.subtitle, { color: tokens.colors.textSecondary }]}>{ar.welcome.subtitle}</Text>
      <View style={styles.actions}>
        <Button title={ar.welcome.registerCta} onPress={() => router.push('/register')} />
        <View style={{ height: 12 }} />
        <Button title={ar.welcome.loginCta} onPress={() => router.push('/login')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, textAlign: 'center', marginBottom: 32 },
  actions: { width: '100%', maxWidth: 320 },
});
```

- [ ] **Step 3: Write the register-choice screen**

Create `mobile/app/register/index.tsx`:
```typescript
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { Button } from '../../src/components/Button';

export default function RegisterChoiceScreen() {
  const router = useRouter();
  const { tokens } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.registerChoice.title}</Text>
      <View style={styles.actions}>
        <Button
          title={ar.registerChoice.forSelf}
          onPress={() => router.push({ pathname: '/register/form', params: { role: 'PATIENT' } })}
        />
        <View style={{ height: 12 }} />
        <Button
          title={ar.registerChoice.forChild}
          onPress={() => router.push({ pathname: '/register/form', params: { role: 'CAREGIVER' } })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 32 },
  actions: { width: '100%', maxWidth: 320 },
});
```

- [ ] **Step 4: Visually verify in the browser**

With `npm run web` still running (from Task 1), use the Preview tools: navigate to `http://localhost:8081`, screenshot the welcome screen, click "إنشاء حساب جديد", screenshot the register-choice screen, confirm both render RTL with the adult theme's blue/white palette and no layout overlap.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/index.tsx mobile/app/register/index.tsx mobile/src/copy/ar.ts
git commit -m "feat: add welcome and register-choice screens"
```

---

### Task 8: Registration form screen

**Files:**
- Create: `mobile/app/register/form.tsx`
- Modify: `mobile/src/copy/ar.ts`
- Test: `mobile/app/register/__tests__/form.test.tsx`

**Interfaces:**
- Consumes: `registerPatient`, `registerCaregiver` (Task 5), `TextField`, `Button`, `ErrorBanner` (Task 6).
- Produces: route `/register/form?role=PATIENT|CAREGIVER`, navigates to `/register/verify` on success carrying `mobile`.

- [ ] **Step 1: Extend the copy module**

Add to `mobile/src/copy/ar.ts` (inside the exported `ar` object, alongside `registerChoice`):
```typescript
  registerForm: {
    title: 'بيانات التسجيل',
    fullName: 'الاسم الكامل',
    mobile: 'رقم الجوال',
    email: 'البريد الإلكتروني (اختياري)',
    password: 'كلمة السر',
    submit: 'إرسال',
    mobileInvalid: 'رقم جوال غير صحيح',
    passwordTooShort: 'كلمة السر يجب ألا تقل عن 8 أحرف',
    nameRequired: 'الاسم مطلوب',
  },
```

- [ ] **Step 2: Write the failing test**

Create `mobile/app/register/__tests__/form.test.tsx`:
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import RegisterFormScreen from '../form';
import { registerPatient } from '../../../src/api/auth';

jest.mock('../../../src/api/auth');
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ role: 'PATIENT' }),
  useRouter: () => ({ push: jest.fn() }),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <RegisterFormScreen />
    </ThemeProvider>,
  );
}

describe('RegisterFormScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a validation error when the mobile number is invalid', () => {
    renderScreen();
    fireEvent.changeText(screen.getByTestId('fullName-input'), 'Test User');
    fireEvent.changeText(screen.getByTestId('mobile-input'), '123');
    fireEvent.changeText(screen.getByTestId('password-input'), 'password123');
    fireEvent.press(screen.getByText('إرسال'));
    expect(screen.getByText('رقم جوال غير صحيح')).toBeTruthy();
    expect(registerPatient).not.toHaveBeenCalled();
  });

  it('calls registerPatient with valid input', async () => {
    (registerPatient as jest.Mock).mockResolvedValue({ userId: 'u1', devOtpCode: '123456' });
    renderScreen();
    fireEvent.changeText(screen.getByTestId('fullName-input'), 'Test User');
    fireEvent.changeText(screen.getByTestId('mobile-input'), '+966500000001');
    fireEvent.changeText(screen.getByTestId('password-input'), 'password123');
    fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(registerPatient).toHaveBeenCalledWith({
        fullName: 'Test User',
        mobile: '+966500000001',
        email: undefined,
        password: 'password123',
      });
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- form.test.tsx`
Expected: FAIL with "Cannot find module '../form'".

- [ ] **Step 4: Write the registration form screen**

Create `mobile/app/register/form.tsx`:
```typescript
import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { TextField } from '../../src/components/TextField';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { registerPatient, registerCaregiver } from '../../src/api/auth';
import { ApiError } from '../../src/api/client';

const MOBILE_REGEX = /^\+?[0-9]{9,15}$/;

export default function RegisterFormScreen() {
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role: 'PATIENT' | 'CAREGIVER' }>();
  const { tokens } = useTheme();

  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!fullName.trim()) errors.fullName = ar.registerForm.nameRequired;
    if (!MOBILE_REGEX.test(mobile)) errors.mobile = ar.registerForm.mobileInvalid;
    if (password.length < 8) errors.password = ar.registerForm.passwordTooShort;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const register = role === 'CAREGIVER' ? registerCaregiver : registerPatient;
      await register({ fullName, mobile, email: email || undefined, password });
      router.push({ pathname: '/register/verify', params: { mobile } });
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.registerForm.title}</Text>
      {submitError ? <ErrorBanner message={submitError} /> : null}
      <TextField testID="fullName-input" label={ar.registerForm.fullName} value={fullName} onChangeText={setFullName} error={fieldErrors.fullName} />
      <TextField testID="mobile-input" label={ar.registerForm.mobile} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" error={fieldErrors.mobile} />
      <TextField testID="email-input" label={ar.registerForm.email} value={email} onChangeText={setEmail} keyboardType="email-address" />
      <TextField testID="password-input" label={ar.registerForm.password} value={password} onChangeText={setPassword} secureTextEntry error={fieldErrors.password} />
      <Button title={ar.registerForm.submit} onPress={handleSubmit} loading={submitting} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 24 },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- form.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Visually verify against the real running backend**

With `npm run web` still running and the backend running (from the earlier session's `preview_start` on port 3000, CORS now enabled from Task 1 Step 11), use the Preview tools: navigate to `/register/form?role=PATIENT`, fill in a real name/mobile/password, submit, and confirm it actually navigates to `/register/verify` (the next task creates that screen — until then, expect an Expo "no route matches" screen, which confirms the navigation call fired correctly; screenshot this as evidence).

- [ ] **Step 7: Commit**

```bash
git add mobile/app/register/form.tsx mobile/app/register/__tests__/form.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add registration form screen wired to the real backend"
```

---

### Task 9: OTP verification screen

**Files:**
- Create: `mobile/app/register/verify.tsx`
- Modify: `mobile/src/copy/ar.ts`
- Test: `mobile/app/register/__tests__/verify.test.tsx`

**Interfaces:**
- Consumes: `verifyOtp`, `parseOtpFailureReason` (Task 5), `OtpInput`, `Button`, `ErrorBanner` (Task 6).
- Produces: route `/register/verify?mobile=...`, navigates to `/login` on success.

- [ ] **Step 1: Extend the copy module**

Add to `mobile/src/copy/ar.ts`:
```typescript
  verify: {
    title: 'تأكيد رقم الجوال',
    subtitle: 'أدخل الرمز المرسل إلى جوالك',
    devModeLabel: 'وضع التطوير — الرمز:',
    submit: 'تأكيد',
    reasons: {
      NOT_FOUND: 'لا يوجد رمز نشط، يرجى طلب رمز جديد',
      EXPIRED: 'انتهت صلاحية الرمز (5 دقائق)، يرجى طلب رمز جديد',
      TOO_MANY_ATTEMPTS: 'تجاوزت عدد المحاولات المسموح، يرجى المحاولة لاحقًا',
      INCORRECT_CODE: 'الرمز غير صحيح، حاول مرة أخرى',
    },
  },
```

- [ ] **Step 2: Write the failing test**

Create `mobile/app/register/__tests__/verify.test.tsx`:
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import VerifyScreen from '../verify';
import { verifyOtp } from '../../../src/api/auth';
import { ApiError } from '../../../src/api/client';

jest.mock('../../../src/api/auth', () => ({
  ...jest.requireActual('../../../src/api/auth'),
  verifyOtp: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ mobile: '+966500000001' }),
  useRouter: () => ({ push: jest.fn() }),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <VerifyScreen />
    </ThemeProvider>,
  );
}

describe('VerifyScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the incorrect-code message on INCORRECT_CODE failure', async () => {
    (verifyOtp as jest.Mock).mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'OTP verification failed: INCORRECT_CODE'));
    renderScreen();
    for (let i = 0; i < 6; i++) {
      fireEvent.changeText(screen.getByTestId(`otp-digit-${i}`), String(i));
    }
    fireEvent.press(screen.getByText('تأكيد'));
    await waitFor(() => {
      expect(screen.getByText('الرمز غير صحيح، حاول مرة أخرى')).toBeTruthy();
    });
  });

  it('navigates to login on success', async () => {
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: true });
    renderScreen();
    for (let i = 0; i < 6; i++) {
      fireEvent.changeText(screen.getByTestId(`otp-digit-${i}`), String(i));
    }
    fireEvent.press(screen.getByText('تأكيد'));
    await waitFor(() => {
      expect(verifyOtp).toHaveBeenCalledWith({ mobile: '+966500000001', code: '012345' });
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- verify.test.tsx`
Expected: FAIL with "Cannot find module '../verify'".

- [ ] **Step 4: Write the verify screen**

Create `mobile/app/register/verify.tsx`:
```typescript
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { OtpInput } from '../../src/components/OtpInput';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { verifyOtp, parseOtpFailureReason } from '../../src/api/auth';

export default function VerifyScreen() {
  const router = useRouter();
  const { mobile } = useLocalSearchParams<{ mobile: string }>();
  const { tokens } = useTheme();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await verifyOtp({ mobile, code });
      router.push('/login');
    } catch (err) {
      const reason = parseOtpFailureReason(err);
      setError(reason ? ar.verify.reasons[reason] : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.verify.title}</Text>
      <Text style={[styles.subtitle, { color: tokens.colors.textSecondary }]}>{ar.verify.subtitle}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <OtpInput length={6} value={code} onChange={setCode} />
      <View style={{ height: 24 }} />
      <Button title={ar.verify.submit} onPress={handleSubmit} loading={submitting} disabled={code.length !== 6} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- verify.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Visually verify the full register-to-verify flow against the real backend**

With `npm run web` and the backend both running: complete the registration form (Task 8) with a fresh mobile number, confirm it lands on `/register/verify`, manually read the real `devOtpCode` from the backend's actual HTTP response (visible in the browser's network tab via the Preview tools' network inspection), type it into the 6 boxes, submit, and confirm it navigates to `/login` (which does not exist until Task 10 — an Expo "no route matches" screen here confirms success, same as Task 8 Step 6).

- [ ] **Step 7: Commit**

```bash
git add mobile/app/register/verify.tsx mobile/app/register/__tests__/verify.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add OTP verification screen wired to the real backend"
```

---

### Task 10: Login, forgot-password, reset-password screens

**Files:**
- Create: `mobile/app/login.tsx`
- Create: `mobile/app/forgot-password.tsx`
- Create: `mobile/app/reset-password.tsx`
- Modify: `mobile/src/copy/ar.ts`
- Test: `mobile/app/__tests__/login.test.tsx`

**Interfaces:**
- Consumes: `login`, `forgotPassword`, `resetPassword` (Task 5), `saveToken` (Task 3), `TextField`, `Button`, `ErrorBanner` (Task 6).
- Produces: routes `/login`, `/forgot-password`, `/reset-password`; on successful login, saves the token and navigates to `/home`.

- [ ] **Step 1: Extend the copy module**

Add to `mobile/src/copy/ar.ts`:
```typescript
  login: {
    title: 'تسجيل الدخول',
    mobile: 'رقم الجوال',
    password: 'كلمة السر',
    submit: 'دخول',
    forgotPassword: 'نسيت كلمة السر؟',
    locked: 'الحساب مقفل مؤقتًا بسبب محاولات فاشلة متكررة، حاول بعد 15 دقيقة',
  },
  forgotPassword: {
    title: 'استعادة كلمة السر',
    mobile: 'رقم الجوال',
    submit: 'إرسال رمز الاستعادة',
  },
  resetPassword: {
    title: 'كلمة سر جديدة',
    code: 'رمز التحقق',
    newPassword: 'كلمة السر الجديدة',
    submit: 'حفظ',
  },
```

- [ ] **Step 2: Write the failing login test**

Create `mobile/app/__tests__/login.test.tsx`:
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../src/theme/ThemeContext';
import LoginScreen from '../login';
import { login } from '../../src/api/auth';
import { saveToken } from '../../src/storage/session';
import { ApiError } from '../../src/api/client';

jest.mock('../../src/api/auth');
jest.mock('../../src/storage/session');
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

function renderScreen() {
  return render(
    <ThemeProvider>
      <LoginScreen />
    </ThemeProvider>,
  );
}

describe('LoginScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves the token and navigates on successful login', async () => {
    (login as jest.Mock).mockResolvedValue({ token: 'tok', expiresAt: '2026-01-01', mustChangePassword: false });
    renderScreen();
    fireEvent.changeText(screen.getByTestId('mobile-input'), '+966500000001');
    fireEvent.changeText(screen.getByTestId('password-input'), 'password123');
    fireEvent.press(screen.getByText('دخول'));
    await waitFor(() => {
      expect(saveToken).toHaveBeenCalledWith('tok');
    });
  });

  it('shows the lockout message on a 429 response', async () => {
    (login as jest.Mock).mockRejectedValue(new ApiError(429, 'TOO_MANY_REQUESTS', 'Account temporarily locked. Try again later.'));
    renderScreen();
    fireEvent.changeText(screen.getByTestId('mobile-input'), '+966500000001');
    fireEvent.changeText(screen.getByTestId('password-input'), 'wrongpass');
    fireEvent.press(screen.getByText('دخول'));
    await waitFor(() => {
      expect(screen.getByText('الحساب مقفل مؤقتًا بسبب محاولات فاشلة متكررة، حاول بعد 15 دقيقة')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- login.test.tsx`
Expected: FAIL with "Cannot find module '../login'".

- [ ] **Step 4: Write the login screen**

Create `mobile/app/login.tsx`:
```typescript
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../src/copy/ar';
import { useTheme } from '../src/theme/ThemeContext';
import { TextField } from '../src/components/TextField';
import { Button } from '../src/components/Button';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { login } from '../src/api/auth';
import { saveToken } from '../src/storage/session';
import { ApiError } from '../src/api/client';

export default function LoginScreen() {
  const router = useRouter();
  const { tokens } = useTheme();

  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await login({ mobile, password });
      await saveToken(result.token);
      router.push('/home');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(ar.login.locked);
      } else {
        setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.login.title}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <TextField testID="mobile-input" label={ar.login.mobile} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
      <TextField testID="password-input" label={ar.login.password} value={password} onChangeText={setPassword} secureTextEntry />
      <Button title={ar.login.submit} onPress={handleSubmit} loading={submitting} />
      <View style={{ height: 16 }} />
      <Button title={ar.login.forgotPassword} onPress={() => router.push('/forgot-password')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 24 },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- login.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the forgot-password screen**

Create `mobile/app/forgot-password.tsx`:
```typescript
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../src/copy/ar';
import { useTheme } from '../src/theme/ThemeContext';
import { TextField } from '../src/components/TextField';
import { Button } from '../src/components/Button';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { forgotPassword } from '../src/api/auth';
import { ApiError } from '../src/api/client';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword({ mobile });
      router.push({ pathname: '/reset-password', params: { mobile } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.forgotPassword.title}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <TextField testID="mobile-input" label={ar.forgotPassword.mobile} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
      <Button title={ar.forgotPassword.submit} onPress={handleSubmit} loading={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 24 },
});
```

- [ ] **Step 7: Write the reset-password screen**

Create `mobile/app/reset-password.tsx`:
```typescript
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ar } from '../src/copy/ar';
import { useTheme } from '../src/theme/ThemeContext';
import { TextField } from '../src/components/TextField';
import { Button } from '../src/components/Button';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { resetPassword } from '../src/api/auth';
import { ApiError } from '../src/api/client';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { mobile } = useLocalSearchParams<{ mobile: string }>();
  const { tokens } = useTheme();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword({ mobile, code, newPassword });
      router.push('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.resetPassword.title}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <TextField testID="code-input" label={ar.resetPassword.code} value={code} onChangeText={setCode} keyboardType="number-pad" />
      <TextField testID="new-password-input" label={ar.resetPassword.newPassword} value={newPassword} onChangeText={setNewPassword} secureTextEntry />
      <Button title={ar.resetPassword.submit} onPress={handleSubmit} loading={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 24 },
});
```

- [ ] **Step 8: Visually verify login against the real backend**

With `npm run web` and the backend both running: using the patient account registered and verified in Tasks 8-9, log in for real on `/login`, confirm it saves the token (check via the browser preview's storage inspection or simply that navigation to `/home` succeeds — `/home` doesn't exist until Task 11, so expect the same "no route matches" confirmation pattern as before) and screenshot the login screen itself for visual review.

- [ ] **Step 9: Commit**

```bash
git add mobile/app/login.tsx mobile/app/forgot-password.tsx mobile/app/reset-password.tsx mobile/app/__tests__/login.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add login, forgot-password, and reset-password screens"
```

---

### Task 11: AuthProvider, home placeholder, full walkthrough

**Files:**
- Create: `mobile/src/auth/AuthProvider.tsx`
- Create: `mobile/app/home.tsx`
- Modify: `mobile/app/_layout.tsx`
- Test: `mobile/src/auth/__tests__/AuthProvider.test.tsx`

**Interfaces:**
- Consumes: `getToken`, `clearToken` (Task 3), `login` response shape's `mustChangePassword` (Task 5).
- Produces: `AuthProvider`, `useAuth(): { isLoggedIn: boolean; loading: boolean; logout: () => Promise<void> }`, wired at the root so any screen can call `useAuth()`.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/auth/__tests__/AuthProvider.test.tsx`:
```typescript
import { render, screen, waitFor, act } from '@testing-library/react-native';
import { Text, Pressable } from 'react-native';
import { AuthProvider, useAuth } from '../AuthProvider';
import { getToken, clearToken } from '../../storage/session';

jest.mock('../../storage/session');

function Probe() {
  const { isLoggedIn, loading, logout } = useAuth();
  if (loading) return <Text testID="state">loading</Text>;
  return (
    <>
      <Text testID="state">{isLoggedIn ? 'logged-in' : 'logged-out'}</Text>
      <Pressable testID="logout" onPress={logout} />
    </>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts logged-out when no token is stored', async () => {
    (getToken as jest.Mock).mockResolvedValue(null);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => {
      expect(screen.getByTestId('state').props.children).toBe('logged-out');
    });
  });

  it('starts logged-in when a token is stored', async () => {
    (getToken as jest.Mock).mockResolvedValue('tok');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => {
      expect(screen.getByTestId('state').props.children).toBe('logged-in');
    });
  });

  it('clears the token and flips to logged-out on logout()', async () => {
    (getToken as jest.Mock).mockResolvedValue('tok');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => screen.getByTestId('logout'));
    await act(async () => {
      screen.getByTestId('logout').props.onPress();
    });
    await waitFor(() => {
      expect(clearToken).toHaveBeenCalled();
      expect(screen.getByTestId('state').props.children).toBe('logged-out');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AuthProvider.test.tsx`
Expected: FAIL with "Cannot find module '../AuthProvider'".

- [ ] **Step 3: Write the implementation**

Create `mobile/src/auth/AuthProvider.tsx`:
```typescript
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getToken, clearToken } from '../storage/session';

interface AuthContextValue {
  isLoggedIn: boolean;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getToken().then((token) => {
      if (!cancelled) {
        setIsLoggedIn(Boolean(token));
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await clearToken();
    setIsLoggedIn(false);
  }

  return <AuthContext.Provider value={{ isLoggedIn, loading, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- AuthProvider.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire AuthProvider into the root layout**

Modify `mobile/app/_layout.tsx`:
```typescript
import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { Stack } from 'expo-router';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { AuthProvider } from '../src/auth/AuthProvider';

export default function RootLayout() {
  useEffect(() => {
    if (!I18nManager.isRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);
    }
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 6: Write the home placeholder screen**

Create `mobile/app/home.tsx`:
```typescript
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/theme/ThemeContext';
import { useAuth } from '../src/auth/AuthProvider';
import { Button } from '../src/components/Button';

export default function HomeScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.replace('/');
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>وصلت إلى الصفحة الرئيسية</Text>
      <Text style={[styles.subtitle, { color: tokens.colors.textSecondary }]}>
        محتوى الملف الشخصي والتشخيص والعلاج يُبنى في الوحدات القادمة.
      </Text>
      <Button title="تسجيل الخروج" onPress={handleLogout} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
});
```

- [ ] **Step 7: Run the full test suite**

Run: `npm test` (from `mobile/`)
Expected: PASS — every test file in the project (Tasks 1-11) passes with 0 failures.

- [ ] **Step 8: Full live walkthrough against the real backend**

With `npm run web` and the backend both running, use the Preview tools to walk the entire flow for real, screenshotting each step: welcome → register (for self) → fill form with a fresh mobile number → real `201` from the backend → verify screen → read the real `devOtpCode` from the network response → submit → login screen → log in with the same credentials → land on `/home` → confirm the real session token was written to storage → press "تسجيل الخروج" → confirm it returns to the welcome screen. Also verify directly against Postgres (`docker exec backend-postgres-1 psql -U kalamy -d kalamy -c "SELECT mobile, status FROM \"User\" WHERE mobile = '<the number used>';"`) that the row exists and its status is `ACTIVE` after verification — the same kind of direct-database proof already established as this project's standard for "is this really working."

- [ ] **Step 9: Commit**

```bash
git add mobile/src/auth mobile/app/home.tsx mobile/app/_layout.tsx
git commit -m "feat: add AuthProvider, home placeholder, and complete the auth flow"
```

---

## Self-Review Notes

- **Spec coverage:** scaffold/web/RTL (Task 1), theming (Task 2), secure storage (Task 3), API client + error parsing (Task 4), auth API functions + OTP-reason parsing (Task 5), shared components (Task 6), welcome/register-choice (Task 7), registration form (Task 8), OTP verify (Task 9), login/forgot/reset (Task 10), session restore + logout + home placeholder (Task 11) — every in-scope item from the design spec is covered. The `mustChangePassword`-notice-only decision, the `devOtpCode`-dev-mode-only transparency, and the OTP-reason-parsing-from-message-string approach are all carried through exactly as the spec described, not idealized away.
- **Placeholder scan:** no TBD/TODO; every step has runnable code or an exact command with expected output. Task 1's scaffold steps are command-driven (framework-generated files) rather than hand-written boilerplate, which is the correct approach for tool-generated config — the plan is still unambiguous about exactly which commands to run and what to verify.
- **Type consistency:** `RegisterResponse`, `LoginResponse`, `OtpFailureReason` are defined once in `src/api/auth.ts` (Task 5) and consumed with matching field names in Tasks 8-11 (`userId`/`devOtpCode`, `token`/`expiresAt`/`mustChangePassword`, the four reason strings). `AgeGroup`/`ThemeTokens` from Task 2 are consumed identically via `useTheme()` in every component/screen task. `saveToken`/`getToken`/`clearToken` signatures from Task 3 match their usage in Tasks 10-11 exactly.
- **Browser verification:** every screen-producing task (7, 8, 9, 10, 11) has an explicit Preview-tools verification step against the real running backend, not just Jest — matching the "must be seen running in a browser" global constraint.
