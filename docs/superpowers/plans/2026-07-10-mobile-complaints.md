# Mobile Complaints (Submit + Own History) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a patient submit a complaint or suggestion from the mobile app, and view their own history of past submissions and current status.

**Architecture:** One small backend addition (a patient-scoped `GET /api/v1/complaints/mine` list endpoint — the existing Complaints module has submit + single-complaint-lookup but no "list my own" endpoint), plus three mobile pieces: an API client module, two screens (a compact history list and a separate submit form), and a Home screen link. Mirrors the file/task shape already used for Reports (`docs/superpowers/plans/2026-07-10-mobile-reports-viewing.md`).

**Tech Stack:** NestJS 11/TypeScript backend, Prisma 6.19.3, nestjs-zod, Jest+Supertest e2e (real Docker Postgres). Expo ~57/React Native 0.86/React 19.2/TypeScript mobile, expo-router, hand-rolled `apiRequest` client, `@testing-library/react-native`.

## Global Constraints

- No Prisma schema changes — the `Complaint` model already has everything needed.
- The new backend route (`GET /api/v1/complaints/mine`) must be registered before the existing `GET /:id` route in `ComplaintsController`, or Nest's router will try to match `"mine"` as an `:id` value.
- No clinician linking in the mobile submit form — `relatedClinicianUserId` is omitted entirely from the mobile `POST` body.
- Two separate mobile screens (list, submit) — not one combined screen.
- Compact history list only — no complaint-detail drill-down screen.
- Arabic is the only language; all new user-facing strings go in `mobile/src/copy/ar.ts`, matching the existing structure (a namespace object per screen/domain).
- New test files harden their **first** test's `waitFor` with `{ timeout: 3000 }` from the start — this project has hit the identical RTL cold-start flake five times across two prior sub-projects (always the first test in a newly-added file, under CPU-contended/cold-cache conditions).

---

### Task 1: Backend — `GET /api/v1/complaints/mine`

**Files:**
- Modify: `backend/src/modules/complaints/complaints.service.ts`
- Modify: `backend/src/modules/complaints/complaints.controller.ts`
- Test: `backend/test/complaints.e2e-spec.ts`

**Interfaces:**
- Consumes: nothing new — uses the existing `PrismaService`, `AuthenticatedUser`, `Permission.VIEW_COMPLAINT` (already granted to `PATIENT`/`CAREGIVER`/`CLINICIAN`/`SUPERVISOR`/`ADMIN` in `backend/src/common/rbac/permissions.ts`).
- Produces: `ComplaintsService.findMine(actor: AuthenticatedUser): Promise<Complaint[]>` and route `GET /api/v1/complaints/mine` — later mobile tasks call this via `getMyComplaints()`.

- [ ] **Step 1: Write the failing e2e test**

Read `backend/test/complaints.e2e-spec.ts` first. Add this new `describe` block at the end of the file (after the existing `describe('Complaints: update status', ...)` block, following the file's own established pattern of a local `createUserToken` helper per block):

```typescript
describe('Complaints: mine (patient-scoped history)', () => {
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

  async function createUserToken(mobile: string, password: string, role: 'PATIENT' | 'CAREGIVER'): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Complaint Mine Test User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role !== 'PATIENT') {
      await prisma.user.update({ where: { mobile }, data: { role } });
    }
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('lets a PATIENT list their own complaints, newest first', async () => {
    const token = await createUserToken('+966500000920', 'password123', 'PATIENT');
    await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'COMPLAINT', subject: 'First complaint', description: 'Submitted first' });
    await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'SUGGESTION', subject: 'Second complaint', description: 'Submitted second' });

    const response = await request(app.getHttpServer()).get('/api/v1/complaints/mine').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0].subject).toBe('Second complaint');
    expect(response.body[1].subject).toBe('First complaint');
  });

  it("does not include another user's complaints", async () => {
    const ownToken = await createUserToken('+966500000921', 'password123', 'PATIENT');
    const otherToken = await createUserToken('+966500000922', 'password123', 'PATIENT');
    await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ type: 'COMPLAINT', subject: "Someone else's complaint", description: 'Not mine' });

    const response = await request(app.getHttpServer()).get('/api/v1/complaints/mine').set('Authorization', `Bearer ${ownToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(0);
  });

  it('returns an empty array for a CAREGIVER with no complaints submitted', async () => {
    const token = await createUserToken('+966500000923', 'password123', 'CAREGIVER');

    const response = await request(app.getHttpServer()).get('/api/v1/complaints/mine').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest --config test/jest-e2e.json complaints.e2e-spec -t "mine"`
Expected: FAIL — `GET /api/v1/complaints/mine` doesn't exist yet (404, and the first two tests' `POST` setup calls will succeed but the `GET` assertion will fail).

- [ ] **Step 3: Add the service method**

Read `backend/src/modules/complaints/complaints.service.ts` first. Add this method to `ComplaintsService`, placed right after `create()` and before `listAll()`:

```typescript
  async findMine(actor: AuthenticatedUser): Promise<Complaint[]> {
    return this.prisma.complaint.findMany({
      where: { submittedByUserId: actor.id },
      orderBy: { createdAt: 'desc' },
    });
  }
```

- [ ] **Step 4: Add the controller route**

Read `backend/src/modules/complaints/complaints.controller.ts` first. Add this route **immediately before** the existing `@Get(':id')` route (route ordering matters — a literal `/mine` route must come before the `:id` parameter route, or Nest would treat `"mine"` as an id):

```typescript
  @Get('mine')
  @RequirePermission(Permission.VIEW_COMPLAINT)
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.complaintsService.findMine(user);
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx jest --config test/jest-e2e.json complaints.e2e-spec -t "mine"`
Expected: PASS, all 3 new tests.

- [ ] **Step 6: Run the full backend e2e suite to confirm no regressions**

Run: `cd backend && npm run test:e2e`
Expected: every existing suite still passes, plus the 3 new tests (all in the existing `complaints.e2e-spec.ts` file, so the suite count stays the same and only the test count increases).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/complaints/complaints.service.ts backend/src/modules/complaints/complaints.controller.ts backend/test/complaints.e2e-spec.ts
git commit -m "feat: add GET /api/v1/complaints/mine for patient-scoped history

The existing Complaints module had submit + single-complaint-lookup
but no way for a patient to list their own submission history — this
adds that, gated by the same VIEW_COMPLAINT permission patients
already have. Registered before the :id route to avoid Nest matching
'mine' as an id."
```

---

### Task 2: Mobile — `complaints.ts` API client

**Files:**
- Create: `mobile/src/api/complaints.ts`

**Interfaces:**
- Consumes: `apiRequest` from `mobile/src/api/client.ts`.
- Produces: `Complaint`, `ComplaintType`, `ComplaintStatus`, `SubmitComplaintInput` types; `getMyComplaints(): Promise<Complaint[]>`; `submitComplaint(input: SubmitComplaintInput): Promise<Complaint>` — consumed by Tasks 3 and 4.

- [ ] **Step 1: Create the file**

```typescript
import { apiRequest } from './client';

export type ComplaintType = 'COMPLAINT' | 'SUGGESTION';
export type ComplaintStatus = 'OPEN' | 'REVIEWED' | 'RESOLVED';

export interface Complaint {
  id: string;
  type: ComplaintType;
  subject: string;
  description: string;
  status: ComplaintStatus;
  createdAt: string;
}

export interface SubmitComplaintInput {
  type: ComplaintType;
  subject: string;
  description: string;
}

export function getMyComplaints(): Promise<Complaint[]> {
  return apiRequest<Complaint[]>('/api/v1/complaints/mine', { auth: true });
}

export function submitComplaint(input: SubmitComplaintInput): Promise<Complaint> {
  return apiRequest<Complaint>('/api/v1/complaints', { method: 'POST', body: input, auth: true });
}
```

This module has no dedicated unit test file, following this codebase's established convention (`api/patients.ts`, `api/treatmentEngine.ts`, `api/reports.ts` have none either) — its behavior is verified through Task 3 and Task 4's screen tests, which mock it.

- [ ] **Step 2: Verify it compiles**

Run: `cd mobile && npx tsc --noEmit`
Expected: zero new errors attributable to this file (pre-existing jest-namespace type errors in `__tests__` files repo-wide are unrelated and already present on master).

- [ ] **Step 3: Commit**

```bash
git add mobile/src/api/complaints.ts
git commit -m "feat: add mobile API client for the complaints module"
```

---

### Task 3: Mobile — `complaints.tsx` list screen

**Files:**
- Create: `mobile/app/program/complaints.tsx`
- Modify: `mobile/src/copy/ar.ts` (add the `complaints` namespace)
- Test: `mobile/app/program/__tests__/complaints.test.tsx`

**Interfaces:**
- Consumes: `getMyComplaints`, `Complaint` (Task 2); `Button`, `ErrorBanner`; `useTheme()`; `useRouter`/`useFocusEffect` from `expo-router`.
- Produces: nothing consumed by later tasks — Task 5 only navigates to this screen's route (`/program/complaints`), it doesn't import anything from this file. Task 4 is a separate screen this one links to by route path only (`/program/complaint-submit`), not by import.

- [ ] **Step 1: Add the `complaints` copy namespace**

Read `mobile/src/copy/ar.ts` first. Add this key alongside `reports` (after the `reports: { ... }` block closes, before the final `};` of the file):

```typescript
  complaints: {
    title: 'شكاوى ومقترحاتي',
    submitLinkLabel: 'تقديم شكوى جديدة',
    submitScreenTitle: 'تقديم شكوى أو اقتراح',
    types: {
      COMPLAINT: 'شكوى',
      SUGGESTION: 'اقتراح',
    },
    statuses: {
      OPEN: 'مفتوحة',
      REVIEWED: 'قيد المراجعة',
      RESOLVED: 'تم الحل',
    },
    typeLabel: 'النوع',
    statusLabel: 'الحالة',
    subjectLabel: 'الموضوع',
    descriptionLabel: 'الوصف',
    submitButtonLabel: 'إرسال',
    noComplaintsYet: 'لا توجد شكاوى بعد',
  },
```

- [ ] **Step 2: Write the failing test**

Create `mobile/app/program/__tests__/complaints.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import ComplaintsScreen from '../complaints';
import { getMyComplaints } from '../../../src/api/complaints';
import { ApiError } from '../../../src/api/client';

const mockPush = jest.fn();
jest.mock('../../../src/api/complaints');
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ComplaintsScreen', () => {
  it('renders the complaint history with type, subject, status, and date', async () => {
    (getMyComplaints as jest.Mock).mockResolvedValue([
      {
        id: 'complaint-1',
        type: 'COMPLAINT',
        subject: 'تأخر الرد من الأخصائي',
        description: 'لم يتم الرد خلال أسبوعين',
        status: 'OPEN',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ]);

    render(<ThemeProvider><ComplaintsScreen /></ThemeProvider>);

    // See reports.test.tsx (commit 5241b81) and its several prior repeats for
    // why: under CPU-contended/cold-start conditions, RTL's default ~1s
    // waitFor timeout has been too tight even for mocked promises with no
    // real I/O — especially for the first test in a newly-added file.
    await waitFor(
      () => {
        expect(screen.getByText('شكاوى ومقترحاتي')).toBeTruthy();
        expect(screen.getByText('شكوى')).toBeTruthy();
        expect(screen.getByText('تأخر الرد من الأخصائي')).toBeTruthy();
        expect(screen.getByText('مفتوحة')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it('shows the empty state when there are no complaints', async () => {
    (getMyComplaints as jest.Mock).mockResolvedValue([]);

    render(<ThemeProvider><ComplaintsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لا توجد شكاوى بعد')).toBeTruthy();
    });
  });

  it('shows an ErrorBanner when the fetch fails', async () => {
    (getMyComplaints as jest.Mock).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Something broke'));

    render(<ThemeProvider><ComplaintsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Something broke')).toBeTruthy();
    });
  });

  it('navigates to the submit screen when the "submit new complaint" link is pressed', async () => {
    (getMyComplaints as jest.Mock).mockResolvedValue([]);

    render(<ThemeProvider><ComplaintsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('تقديم شكوى جديدة')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('تقديم شكوى جديدة'));

    expect(mockPush).toHaveBeenCalledWith('/program/complaint-submit');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npm test -- complaints.test.tsx`
Expected: FAIL — `mobile/app/program/complaints.tsx` doesn't exist yet.

- [ ] **Step 4: Write the screen**

Create `mobile/app/program/complaints.tsx`:

```typescript
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { getMyComplaints, Complaint } from '../../src/api/complaints';

function typeLabel(type: Complaint['type']): string {
  return ar.complaints.types[type];
}

function statusLabel(status: Complaint['status']): string {
  return ar.complaints.statuses[status];
}

export default function ComplaintsScreen() {
  const router = useRouter();
  const { tokens } = useTheme();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMyComplaints();
      setComplaints(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={{ color: tokens.colors.text }}>{ar.program.loading}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.complaints.title}</Text>

      <View style={{ marginBottom: 16 }}>
        <Button title={ar.complaints.submitLinkLabel} onPress={() => router.push('/program/complaint-submit')} />
      </View>

      {complaints.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary }}>{ar.complaints.noComplaintsYet}</Text>
      ) : (
        complaints.map((complaint) => (
          <View key={complaint.id} style={[styles.card, { borderColor: tokens.colors.border }]}>
            <Text style={{ color: tokens.colors.text }}>
              {ar.complaints.typeLabel}: <Text>{typeLabel(complaint.type)}</Text>
            </Text>
            <Text style={{ color: tokens.colors.text }}>{complaint.subject}</Text>
            <Text style={{ color: tokens.colors.text }}>
              {ar.complaints.statusLabel}: <Text>{statusLabel(complaint.status)}</Text>
            </Text>
            <Text style={{ color: tokens.colors.textSecondary }}>{complaint.createdAt}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  card: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8, gap: 2 },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npm test -- complaints.test.tsx`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus the 4 new tests.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/program/complaints.tsx mobile/app/program/__tests__/complaints.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add the Complaints history screen

Read-only compact list (type/subject/status/date) of the patient's
own submitted complaints, with a link to the separate submit screen.
Refetches on focus so returning from a successful submission shows
the new entry without a manual refresh."
```

---

### Task 4: Mobile — `complaint-submit.tsx` form screen

**Files:**
- Modify: `mobile/src/components/TextField.tsx` (add a `multiline` prop)
- Create: `mobile/app/program/complaint-submit.tsx`
- Test: `mobile/app/program/__tests__/complaint-submit.test.tsx`

**Interfaces:**
- Consumes: `submitComplaint`, `ComplaintType` (Task 2); `TextField` (extended in this task), `Button`, `ErrorBanner`; `useTheme()`; `useRouter` from `expo-router`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend `TextField` with a `multiline` prop**

Read `mobile/src/components/TextField.tsx` first. Replace the whole file:

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
  multiline?: boolean;
  testID?: string;
}

export function TextField({ label, value, onChangeText, error, secureTextEntry, keyboardType, multiline, testID }: TextFieldProps) {
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
        multiline={multiline}
        style={[
          styles.input,
          multiline ? styles.multilineInput : null,
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
  multilineInput: { minHeight: 100, textAlignVertical: 'top' },
});
```

This is additive and backward-compatible — every existing usage omits `multiline`, so it defaults to `undefined`/falsy and behaves exactly as before.

- [ ] **Step 2: Run the existing TextField-consuming tests to confirm no regressions from the extension alone**

Run: `cd mobile && npm test -- form.test.tsx`
Expected: PASS (unchanged) — confirms the `TextField` change didn't break the registration form, which is this component's other consumer.

- [ ] **Step 3: Write the failing test for the submit screen**

Create `mobile/app/program/__tests__/complaint-submit.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import ComplaintSubmitScreen from '../complaint-submit';
import { submitComplaint } from '../../../src/api/complaints';
import { ApiError } from '../../../src/api/client';

const mockBack = jest.fn();
jest.mock('../../../src/api/complaints');
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: mockBack }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ComplaintSubmitScreen', () => {
  it('does not submit until both subject and description are filled, then submits with the default COMPLAINT type', async () => {
    render(<ThemeProvider><ComplaintSubmitScreen /></ThemeProvider>);

    // See reports.test.tsx (commit 5241b81) and its several prior repeats for
    // why: under CPU-contended/cold-start conditions, RTL's default ~1s
    // waitFor timeout has been too tight even for mocked promises with no
    // real I/O — especially for the first test in a newly-added file.
    await waitFor(
      () => {
        expect(screen.getByText('إرسال')).toBeTruthy();
      },
      { timeout: 3000 },
    );

    fireEvent.press(screen.getByText('إرسال'));
    expect(submitComplaint).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('subject-input'), 'موضوع الشكوى');
    fireEvent.press(screen.getByText('إرسال'));
    expect(submitComplaint).not.toHaveBeenCalled();

    (submitComplaint as jest.Mock).mockResolvedValue({
      id: 'complaint-1',
      type: 'COMPLAINT',
      subject: 'موضوع الشكوى',
      description: 'وصف الشكوى بالتفصيل',
      status: 'OPEN',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
    fireEvent.changeText(screen.getByTestId('description-input'), 'وصف الشكوى بالتفصيل');
    fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(submitComplaint).toHaveBeenCalledWith({
        type: 'COMPLAINT',
        subject: 'موضوع الشكوى',
        description: 'وصف الشكوى بالتفصيل',
      });
    });
  });

  it('navigates back after a successful submission', async () => {
    (submitComplaint as jest.Mock).mockResolvedValue({
      id: 'complaint-1',
      type: 'COMPLAINT',
      subject: 'a',
      description: 'b',
      status: 'OPEN',
      createdAt: '2026-07-10T00:00:00.000Z',
    });

    render(<ThemeProvider><ComplaintSubmitScreen /></ThemeProvider>);

    fireEvent.changeText(screen.getByTestId('subject-input'), 'a');
    fireEvent.changeText(screen.getByTestId('description-input'), 'b');
    fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });
  });

  it('submits with type SUGGESTION when the suggestion option is selected first', async () => {
    (submitComplaint as jest.Mock).mockResolvedValue({
      id: 'complaint-1',
      type: 'SUGGESTION',
      subject: 'a',
      description: 'b',
      status: 'OPEN',
      createdAt: '2026-07-10T00:00:00.000Z',
    });

    render(<ThemeProvider><ComplaintSubmitScreen /></ThemeProvider>);

    fireEvent.press(screen.getByTestId('type-suggestion'));
    fireEvent.changeText(screen.getByTestId('subject-input'), 'a');
    fireEvent.changeText(screen.getByTestId('description-input'), 'b');
    fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(submitComplaint).toHaveBeenCalledWith({ type: 'SUGGESTION', subject: 'a', description: 'b' });
    });
  });

  it('shows an ErrorBanner and preserves entered values when submission fails', async () => {
    (submitComplaint as jest.Mock).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Something broke'));

    render(<ThemeProvider><ComplaintSubmitScreen /></ThemeProvider>);

    fireEvent.changeText(screen.getByTestId('subject-input'), 'a');
    fireEvent.changeText(screen.getByTestId('description-input'), 'b');
    fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(screen.getByText('Something broke')).toBeTruthy();
    });
    expect(screen.getByTestId('subject-input').props.value).toBe('a');
    expect(screen.getByTestId('description-input').props.value).toBe('b');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd mobile && npm test -- complaint-submit.test.tsx`
Expected: FAIL — `mobile/app/program/complaint-submit.tsx` doesn't exist yet.

- [ ] **Step 5: Write the screen**

Create `mobile/app/program/complaint-submit.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { TextField } from '../../src/components/TextField';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { submitComplaint, ComplaintType } from '../../src/api/complaints';
import { ApiError } from '../../src/api/client';

export default function ComplaintSubmitScreen() {
  const router = useRouter();
  const { tokens } = useTheme();

  const [type, setType] = useState<ComplaintType>('COMPLAINT');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = subject.trim().length > 0 && description.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitComplaint({ type, subject, description });
      router.back();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.complaints.submitScreenTitle}</Text>
      {submitError ? <ErrorBanner message={submitError} /> : null}

      <View style={styles.typeRow}>
        <Pressable
          testID="type-complaint"
          onPress={() => setType('COMPLAINT')}
          style={[
            styles.typeOption,
            { borderColor: tokens.colors.border, borderRadius: tokens.radius.sm },
            type === 'COMPLAINT' ? { backgroundColor: tokens.colors.primary } : null,
          ]}
        >
          <Text style={{ color: type === 'COMPLAINT' ? tokens.colors.onPrimary : tokens.colors.text }}>
            {ar.complaints.types.COMPLAINT}
          </Text>
        </Pressable>
        <Pressable
          testID="type-suggestion"
          onPress={() => setType('SUGGESTION')}
          style={[
            styles.typeOption,
            { borderColor: tokens.colors.border, borderRadius: tokens.radius.sm },
            type === 'SUGGESTION' ? { backgroundColor: tokens.colors.primary } : null,
          ]}
        >
          <Text style={{ color: type === 'SUGGESTION' ? tokens.colors.onPrimary : tokens.colors.text }}>
            {ar.complaints.types.SUGGESTION}
          </Text>
        </Pressable>
      </View>

      <TextField testID="subject-input" label={ar.complaints.subjectLabel} value={subject} onChangeText={setSubject} />
      <TextField
        testID="description-input"
        label={ar.complaints.descriptionLabel}
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <Button title={ar.complaints.submitButtonLabel} onPress={handleSubmit} disabled={!canSubmit} loading={submitting} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  typeRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  typeOption: { flex: 1, borderWidth: 1, paddingVertical: 10, alignItems: 'center' },
});
```

The submit button is guarded twice — `disabled={!canSubmit}` on the `Button` itself, and `if (!canSubmit) return;` at the top of `handleSubmit` — so the guard holds regardless of whether a disabled `Pressable` blocks `fireEvent.press` at the React Native layer in tests.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd mobile && npm test -- complaint-submit.test.tsx`
Expected: PASS, all 4 tests.

- [ ] **Step 7: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus this task's 4 new tests and Task 3's 4 new tests.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/components/TextField.tsx mobile/app/program/complaint-submit.tsx mobile/app/program/__tests__/complaint-submit.test.tsx
git commit -m "feat: add the Complaint submission form screen

Type picker (complaint/suggestion, defaults to complaint), subject
and description fields, submit disabled until both are non-empty.
Extends TextField with an optional multiline prop for the description
field — additive, every existing caller is unaffected."
```

---

### Task 5: Mobile — Home screen integration

**Files:**
- Modify: `mobile/app/home.tsx`
- Modify: `mobile/src/copy/ar.ts` (add `viewComplaints` to the `program` namespace)
- Modify: `mobile/app/__tests__/home.test.tsx` (add 1 test to the existing file)

**Interfaces:**
- Consumes: nothing new — this task only adds a navigation button.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `viewComplaints` copy key**

Read `mobile/src/copy/ar.ts` first. In the existing `program` object, add this line alongside `viewReports`:

```typescript
    viewComplaints: 'الشكاوى',
```

- [ ] **Step 2: Write the failing test**

Read `mobile/app/__tests__/home.test.tsx` first — add this test to its existing `describe` block (do not remove any existing tests):

```typescript
  it('always shows the "Complaints" link in the links row, regardless of cycle status', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'ACTIVE_LEVEL_TRAINING', humanModelWatchedAt: '2026-07-01T00:00:00.000Z' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('الشكاوى')).toBeTruthy();
    });
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npm test -- home.test.tsx`
Expected: FAIL on the new test — the "الشكاوى" text doesn't exist yet.

- [ ] **Step 4: Update `home.tsx`'s `linksRow`**

Read `mobile/app/home.tsx` first. Replace:

```typescript
      <View style={styles.linksRow}>
        <Button title={ar.program.viewLevelContent} onPress={() => router.push('/program/level-content')} />
        <Button title={ar.program.viewHistory} onPress={() => router.push('/program/history')} />
        <Button title={ar.program.viewReports} onPress={() => router.push('/program/reports')} />
      </View>
```

with:

```typescript
      <View style={styles.linksRow}>
        <Button title={ar.program.viewLevelContent} onPress={() => router.push('/program/level-content')} />
        <Button title={ar.program.viewHistory} onPress={() => router.push('/program/history')} />
        <Button title={ar.program.viewReports} onPress={() => router.push('/program/reports')} />
        <Button title={ar.program.viewComplaints} onPress={() => router.push('/program/complaints')} />
      </View>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npm test -- home.test.tsx`
Expected: PASS, all 9 tests (8 pre-existing + 1 new).

- [ ] **Step 6: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus this task's 1 new test.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/home.tsx mobile/app/__tests__/home.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add a Complaints link to Home, always visible regardless of cycle status

A patient can submit or check on a complaint at any time, not gated
behind training progress — matching Level Content/History/Reports'
existing always-visible link behavior."
```

---

### Task 6: Full suite verification + manual walkthrough

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

- [ ] **Step 3: Run the full mobile test suite**

```bash
cd mobile
npm test
```
Expected: every suite passes, including the 2 new test files (`complaints.test.tsx`, `complaint-submit.test.tsx`) and the 1 new `home.test.tsx` test, plus every pre-existing test untouched by this plan.

- [ ] **Step 4: Manual walkthrough against the running dev servers**

Start both dev servers directly via `npm run start:dev` (backend) / `npm run web` (mobile) from this worktree's own directories — confirm via their startup logs that they compiled from the correct worktree path, not a stale checkout. If the browser tool is available, use it for an actual click-through; if not (as happened during the Reports sub-project), drive the same flow directly against the real running backend via a Node/`fetch` script (not `curl -d` with inline Arabic strings — that has previously mangled UTF-8 bytes via Git-Bash/Windows encoding).

1. Register a patient, verify OTP, log in.
2. As the patient in the mobile app: from Home, tap "الشكاوى" — confirm the empty state shows, then tap "تقديم شكوى جديدة".
3. On the submit screen: confirm the submit button is disabled with both fields empty, fill in a subject and a real Arabic description, leave the type on the default "شكوى" selection, submit.
4. Confirm it navigates back to the history list and the new complaint now appears with the correct type/subject/status ("مفتوحة")/date — this is the real test of `useFocusEffect` refetching on return, which no mocked test can fully confirm.
5. Submit a second complaint, this time selecting "اقتراح" before submitting, and confirm both now show correctly in the list with their distinct types.
6. Directly call `GET /api/v1/complaints/mine` as this patient and confirm the raw JSON shape matches `complaints.ts`'s `Complaint` type field-for-field, and that both complaints appear newest-first.
7. Confirm the "الشكاوى" link is reachable regardless of the patient's current cycle status (try it both before and after starting a cycle), matching Reports' precedent.

This step has no automated pass/fail — its purpose is to catch anything the component-test mocks might have papered over (a real Arabic rendering issue, a refetch-on-focus bug, a route-ordering mistake that only shows up against the real router). Report what you saw; if anything looks wrong, fix it in the relevant earlier task's files and re-run that task's own test file before continuing.

- [ ] **Step 5: Commit (only if Step 4 required fixes)**

If Step 4 surfaced no issues, there is nothing to commit for this task. If it did, commit the fix with a message describing what the manual walkthrough caught that the automated tests didn't.

---

## Self-Review Notes

**Spec coverage**: every in-scope item from `docs/superpowers/specs/2026-07-10-mobile-complaints-design.md` has a task — the backend gap (Task 1), the API client (Task 2), the history list screen (Task 3), the submit form screen with the type picker defaulting to COMPLAINT (Task 4), and the Home integration (Task 5). The design's key decisions — no clinician linking, two separate screens, compact list with no drill-down — are all reflected directly in Task 3/4's code (no `relatedClinicianUserId` anywhere in the mobile `SubmitComplaintInput`, no detail screen file, no combined form+list screen).

**Placeholder scan**: no task contains "TBD"/"TODO"/"add error handling"/"similar to Task N" — every step has complete, copy-pasteable code, and every test asserts real behavior (specific Arabic strings, specific function-call arguments), not `expect(true).toBe(true)`-style stand-ins.

**Type consistency, checked across tasks**: `Complaint`, `ComplaintType`, `ComplaintStatus`, `SubmitComplaintInput` are defined once in Task 2's `complaints.ts` and imported by name in Task 3 (`Complaint`) and Task 4 (`ComplaintType`) — no redefinition. `getMyComplaints()`/`submitComplaint()`'s signatures match exactly between Task 2's definition and Tasks 3/4's usage. The backend's `ComplaintType`/`ComplaintStatus` Prisma enum values (`COMPLAINT`/`SUGGESTION`, `OPEN`/`REVIEWED`/`RESOLVED`) match the mobile types and `ar.ts`'s `complaints.types`/`complaints.statuses` keys exactly — verified against `backend/prisma/schema.prisma` directly during planning, not assumed.

**Route-ordering constraint carried through**: Task 1 Step 4 explicitly places `@Get('mine')` before `@Get(':id')` and explains why, so this doesn't get silently reordered by an implementer unfamiliar with Nest's route-matching behavior.
