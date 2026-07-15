# Mobile Notifications Inbox + Training-Session Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a notifications inbox screen and a real training-session screen to the mobile app, replacing the broken "log training" button (it calls a backend endpoint deleted when §55-62 shipped) with the actual start/resume/progress/cooldown flow the current `TrainingSession` backend contract provides.

**Architecture:** Two new API modules/extensions (`src/api/notifications.ts` new, `src/api/treatmentEngine.ts` extended), two new screens (`app/program/notifications.tsx`, `app/program/training-session.tsx`) following the codebase's existing list-screen and detail-screen conventions exactly, one small necessary fix to `home.tsx` and its test file. No new shared components, no new state-management library, no new navigation chrome — everything follows patterns already present in this codebase.

**Tech Stack:** Expo Router, React 19, TypeScript strict, Jest + `@testing-library/react-native` (`jest-expo` preset).

## Global Constraints

- All new screens theme through `useTheme()`'s `tokens.colors.*`/`tokens.radius.*` — never hardcode colors, matching every existing screen.
- All new copy goes into `mobile/src/copy/ar.ts` under a new per-screen namespace (`ar.notifications`, `ar.trainingSession`), matching the existing per-screen-namespace convention. No i18n library, no English strings — Arabic only, matching the whole file.
- Every new/changed module gets its own colocated `__tests__` file, matching the codebase's one-test-file-per-module convention exactly.
- `logTrainingEvent` and its call site in `home.tsx` are deleted outright once the training-session screen exists — not deprecated, not left as dead code.
- Run tests with `npm test -- --ci` from `mobile/`. Current baseline on this branch: 98 tests across 25 suites, all passing before Task 1 starts. (A first run in a CPU-contended environment showed 6 unrelated failures that fully cleared on an immediate re-run — a pre-existing, documented flake class this test suite already has a comment about; if a run shows a similarly broad, unrelated failure spread, re-run once before treating anything as broken.)
- Backend endpoints this plan consumes are already built and already patient-permission-ready — no backend changes are needed anywhere in this plan: `GET/PATCH /api/v1/notifications[/:id/read]`, `POST/PATCH/GET /api/v1/patients/:patientId/cycles/current/training-sessions[...]`.

---

### Task 1: Notifications API module

**Files:**
- Create: `mobile/src/api/notifications.ts`
- Test: `mobile/src/api/__tests__/notifications.test.ts`
- Modify: `mobile/src/copy/ar.ts`

**Interfaces:**
- Produces: `AppNotification` interface, `getMyNotifications(): Promise<AppNotification[]>`, `markNotificationRead(notificationId: string): Promise<AppNotification>`, `ar.notifications.*` copy — all consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/api/__tests__/notifications.test.ts`:

```typescript
import { apiRequest } from '../client';
import { getMyNotifications, markNotificationRead } from '../notifications';

jest.mock('../client', () => ({
  ...jest.requireActual('../client'),
  apiRequest: jest.fn(),
}));

describe('notifications API functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getMyNotifications fetches the notifications list', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([
      {
        id: 'n1',
        type: 'DAILY_TRAINING_REMINDER',
        title: 't',
        body: 'b',
        relatedEntity: null,
        relatedEntityId: null,
        readAt: null,
        createdAt: '2026-07-15T00:00:00.000Z',
      },
    ]);

    const result = await getMyNotifications();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/notifications', { auth: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n1');
  });

  it('markNotificationRead patches the read endpoint for the given id', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      id: 'n1',
      type: 'DAILY_TRAINING_REMINDER',
      title: 't',
      body: 'b',
      relatedEntity: null,
      relatedEntityId: null,
      readAt: '2026-07-15T01:00:00.000Z',
      createdAt: '2026-07-15T00:00:00.000Z',
    });

    const result = await markNotificationRead('n1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/notifications/n1/read', { method: 'PATCH', auth: true });
    expect(result.readAt).toBe('2026-07-15T01:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --ci notifications.test.ts` (from `mobile/`)
Expected: FAIL — `mobile/src/api/notifications.ts` doesn't exist yet.

- [ ] **Step 3: Create the API module**

Create `mobile/src/api/notifications.ts`:

```typescript
import { apiRequest } from './client';

export type NotificationType =
  | 'SAMPLE_ESCALATED_TO_SUPERVISOR'
  | 'SPECIALIST_DECISION_ISSUED'
  | 'INTERVENTION_TIMED_OUT'
  | 'SAMPLE_ELIGIBLE_FOR_RECORDING'
  | 'SAMPLE_AVAILABLE_FOR_REVIEW'
  | 'SAMPLE_SUBMISSION_REMINDER'
  | 'SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR'
  | 'CONSULTATION_REMINDER'
  | 'DAILY_TRAINING_REMINDER'
  | 'SPECIALIST_WORKLOAD_REMINDER';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntity: string | null;
  relatedEntityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export function getMyNotifications(): Promise<AppNotification[]> {
  return apiRequest<AppNotification[]>('/api/v1/notifications', { auth: true });
}

export function markNotificationRead(notificationId: string): Promise<AppNotification> {
  return apiRequest<AppNotification>(`/api/v1/notifications/${notificationId}/read`, { method: 'PATCH', auth: true });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --ci notifications.test.ts` (from `mobile/`)
Expected: both tests PASS.

- [ ] **Step 5: Add copy**

In `mobile/src/copy/ar.ts`, the file currently ends (lines 173-193):

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
};
```

Add a `notifications` block right after `complaints`, before the closing `};`:

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
  notifications: {
    title: 'الإشعارات',
    empty: 'لا توجد إشعارات بعد',
  },
};
```

Also add `viewNotifications: 'الإشعارات'` to the `program` block (line 55-72), right after `viewComplaints`:

```typescript
    viewComplaints: 'الشكاوى',
    viewNotifications: 'الإشعارات',
    logout: 'تسجيل الخروج',
```

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `npm test -- --ci` (from `mobile/`)
Expected: everything PASSES — 100 tests (98 + 2 new), 26 suites (25 + 1 new).

- [ ] **Step 7: Commit**

```bash
git add mobile/src/api/notifications.ts mobile/src/api/__tests__/notifications.test.ts mobile/src/copy/ar.ts
git commit -m "feat: add notifications API module"
```

---

### Task 2: Notifications screen

**Files:**
- Create: `mobile/app/program/notifications.tsx`
- Test: `mobile/app/program/__tests__/notifications.test.tsx`
- Modify: `mobile/app/home.tsx`

**Interfaces:**
- Consumes: `getMyNotifications`, `markNotificationRead`, `AppNotification` (Task 1), `ar.notifications.*` (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `mobile/app/program/__tests__/notifications.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import NotificationsScreen from '../notifications';
import { getMyNotifications, markNotificationRead } from '../../../src/api/notifications';

jest.mock('../../../src/api/notifications');
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

const unreadNotification = {
  id: 'n1',
  type: 'DAILY_TRAINING_REMINDER' as const,
  title: 'تذكير',
  body: 'أكمل تدريبك',
  relatedEntity: null,
  relatedEntityId: null,
  readAt: null,
  createdAt: '2026-07-15T00:00:00.000Z',
};

describe('NotificationsScreen', () => {
  it('shows an empty state when there are no notifications', async () => {
    (getMyNotifications as jest.Mock).mockResolvedValue([]);

    render(<ThemeProvider><NotificationsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لا توجد إشعارات بعد')).toBeTruthy();
    });
  });

  it('renders a notification\'s title and body', async () => {
    (getMyNotifications as jest.Mock).mockResolvedValue([unreadNotification]);

    render(<ThemeProvider><NotificationsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('تذكير')).toBeTruthy();
      expect(screen.getByText('أكمل تدريبك')).toBeTruthy();
    });
  });

  it('marks an unread notification as read on tap', async () => {
    (getMyNotifications as jest.Mock).mockResolvedValue([unreadNotification]);
    (markNotificationRead as jest.Mock).mockResolvedValue({ ...unreadNotification, readAt: '2026-07-15T01:00:00.000Z' });

    render(<ThemeProvider><NotificationsScreen /></ThemeProvider>);
    await waitFor(() => {
      expect(screen.getByText('تذكير')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('تذكير'));

    await waitFor(() => {
      expect(markNotificationRead).toHaveBeenCalledWith('n1');
    });
  });

  it('does not call markNotificationRead when tapping an already-read notification', async () => {
    (getMyNotifications as jest.Mock).mockResolvedValue([{ ...unreadNotification, readAt: '2026-07-15T01:00:00.000Z' }]);

    render(<ThemeProvider><NotificationsScreen /></ThemeProvider>);
    await waitFor(() => {
      expect(screen.getByText('تذكير')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('تذكير'));

    await waitFor(() => {
      expect(markNotificationRead).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --ci notifications.test.tsx` (from `mobile/`)
Expected: FAIL — `mobile/app/program/notifications.tsx` doesn't exist yet (this matches two test files with the same base name in different directories, both named `notifications.test.tsx` — Jest disambiguates by full path, this is fine and already how `client.test.ts`/other same-named-across-dirs files work in this codebase, but always target `program/__tests__/notifications.test.tsx` specifically when running only this file, e.g. `npm test -- --ci app/program/__tests__/notifications.test.tsx`).

- [ ] **Step 3: Create the screen**

Create `mobile/app/program/notifications.tsx`:

```typescript
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { getMyNotifications, markNotificationRead, AppNotification } from '../../src/api/notifications';

export default function NotificationsScreen() {
  const { tokens } = useTheme();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMyNotifications();
      setNotifications(result);
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

  async function handlePress(notification: AppNotification) {
    if (notification.readAt) return;
    try {
      const updated = await markNotificationRead(notification.id);
      setNotifications((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }

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
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.notifications.title}</Text>

      {notifications.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary }}>{ar.notifications.empty}</Text>
      ) : (
        notifications.map((notification) => {
          const isUnread = !notification.readAt;
          return (
            <Pressable key={notification.id} onPress={() => handlePress(notification)}>
              <View style={[styles.card, { borderColor: tokens.colors.border }]}>
                <View style={styles.titleRow}>
                  {isUnread ? <View style={[styles.dot, { backgroundColor: tokens.colors.primary }]} /> : null}
                  <Text style={{ color: tokens.colors.text, fontWeight: isUnread ? '700' : '400' }}>{notification.title}</Text>
                </View>
                <Text style={{ color: tokens.colors.textSecondary }}>{notification.body}</Text>
                <Text style={{ color: tokens.colors.textSecondary, fontSize: 12 }}>{notification.createdAt}</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  card: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
```

- [ ] **Step 4: Add the entry point in `home.tsx`**

In `mobile/app/home.tsx`, the `linksRow` currently reads (lines 211-216):

```typescript
      <View style={styles.linksRow}>
        <Button title={ar.program.viewLevelContent} onPress={() => router.push('/program/level-content')} />
        <Button title={ar.program.viewHistory} onPress={() => router.push('/program/history')} />
        <Button title={ar.program.viewReports} onPress={() => router.push('/program/reports')} />
        <Button title={ar.program.viewComplaints} onPress={() => router.push('/program/complaints')} />
      </View>
```

Add a `viewNotifications` button after `viewComplaints`:

```typescript
      <View style={styles.linksRow}>
        <Button title={ar.program.viewLevelContent} onPress={() => router.push('/program/level-content')} />
        <Button title={ar.program.viewHistory} onPress={() => router.push('/program/history')} />
        <Button title={ar.program.viewReports} onPress={() => router.push('/program/reports')} />
        <Button title={ar.program.viewComplaints} onPress={() => router.push('/program/complaints')} />
        <Button title={ar.program.viewNotifications} onPress={() => router.push('/program/notifications')} />
      </View>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --ci app/program/__tests__/notifications.test.tsx app/__tests__/home.test.tsx` (from `mobile/`)
Expected: all 4 new tests PASS; all existing `home.test.tsx` tests still PASS unchanged (the new button doesn't affect any existing assertion, since none of them query for the full links row exhaustively).

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `npm test -- --ci` (from `mobile/`)
Expected: everything PASSES — 104 tests (100 + 4 new), 27 suites (26 + 1 new).

- [ ] **Step 7: Commit**

```bash
git add mobile/app/program/notifications.tsx mobile/app/program/__tests__/notifications.test.tsx mobile/app/home.tsx
git commit -m "feat: add notifications inbox screen"
```

---

### Task 3: Training-session API additions

**Files:**
- Modify: `mobile/src/api/treatmentEngine.ts`
- Create: `mobile/src/api/__tests__/treatmentEngine.test.ts`
- Modify: `mobile/src/copy/ar.ts`

**Interfaces:**
- Produces: `TrainingSession`, `TrainingProgressSummary` interfaces, `startOrResumeTrainingSession(patientProfileId: string): Promise<TrainingSession>`, `recordTrainingProgress(patientProfileId: string, unitsCompleted: number): Promise<TrainingSession>`, `getTrainingProgress(patientProfileId: string): Promise<TrainingProgressSummary>`, `ar.trainingSession.*` copy — all consumed by Task 4.
- Removes: `logTrainingEvent` (no longer exported; Task 5 removes its last caller in `home.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/api/__tests__/treatmentEngine.test.ts`:

```typescript
import { apiRequest } from '../client';
import { startOrResumeTrainingSession, recordTrainingProgress, getTrainingProgress } from '../treatmentEngine';

jest.mock('../client', () => ({
  ...jest.requireActual('../client'),
  apiRequest: jest.fn(),
}));

describe('training-session API functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('startOrResumeTrainingSession posts to the training-sessions endpoint', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'IN_PROGRESS',
      unitsCompleted: 0,
      startedAt: '2026-07-15T00:00:00.000Z',
      completedAt: null,
    });

    const result = await startOrResumeTrainingSession('profile-1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/cycles/current/training-sessions', {
      method: 'POST',
      auth: true,
    });
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('recordTrainingProgress patches the cumulative unitsCompleted', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'IN_PROGRESS',
      unitsCompleted: 30,
      startedAt: '2026-07-15T00:00:00.000Z',
      completedAt: null,
    });

    const result = await recordTrainingProgress('profile-1', 30);

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/cycles/current/training-sessions/current/progress', {
      method: 'PATCH',
      auth: true,
      body: { unitsCompleted: 30 },
    });
    expect(result.unitsCompleted).toBe(30);
  });

  it('getTrainingProgress fetches today\'s summary', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      completedToday: 2,
      targetPerDay: 7,
      intervalActive: false,
      nextAvailableAt: null,
      currentSessionId: null,
    });

    const result = await getTrainingProgress('profile-1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/cycles/current/training-sessions/progress', {
      auth: true,
    });
    expect(result.completedToday).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --ci src/api/__tests__/treatmentEngine.test.ts` (from `mobile/`)
Expected: FAIL — none of the three functions exist yet.

- [ ] **Step 3: Add the new functions, remove `logTrainingEvent`**

In `mobile/src/api/treatmentEngine.ts`, the file currently has this function (lines 113-119):

```typescript
export function logTrainingEvent(patientProfileId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientProfileId}/cycles/current/training-events`, {
    method: 'POST',
    auth: true,
    body: {},
  });
}
```

Replace it with:

```typescript
export type TrainingSessionStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface TrainingSession {
  id: string;
  trainingCycleId: string;
  status: TrainingSessionStatus;
  unitsCompleted: number;
  startedAt: string;
  completedAt: string | null;
}

export function startOrResumeTrainingSession(patientProfileId: string): Promise<TrainingSession> {
  return apiRequest<TrainingSession>(`/api/v1/patients/${patientProfileId}/cycles/current/training-sessions`, {
    method: 'POST',
    auth: true,
  });
}

export function recordTrainingProgress(patientProfileId: string, unitsCompleted: number): Promise<TrainingSession> {
  return apiRequest<TrainingSession>(`/api/v1/patients/${patientProfileId}/cycles/current/training-sessions/current/progress`, {
    method: 'PATCH',
    auth: true,
    body: { unitsCompleted },
  });
}

export interface TrainingProgressSummary {
  completedToday: number;
  targetPerDay: number;
  intervalActive: boolean;
  nextAvailableAt: string | null;
  currentSessionId: string | null;
}

export function getTrainingProgress(patientProfileId: string): Promise<TrainingProgressSummary> {
  return apiRequest<TrainingProgressSummary>(`/api/v1/patients/${patientProfileId}/cycles/current/training-sessions/progress`, {
    auth: true,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --ci src/api/__tests__/treatmentEngine.test.ts` (from `mobile/`)
Expected: all 3 tests PASS.

- [ ] **Step 5: Confirm `logTrainingEvent`'s only caller still compiles (it doesn't yet — that's expected)**

`mobile/app/home.tsx` still imports and calls `logTrainingEvent` at this point in the plan — TypeScript will now report a missing-export error there. This is expected and resolved by Task 5, not this task. Do not modify `home.tsx` in this task; confirm the error is exactly the missing `logTrainingEvent` export (not something else) via `npx tsc --noEmit` (from `mobile/`) and move on — Jest's per-file test runs above are unaffected by this, since `jest-expo`/Babel transpile without full type-checking.

- [ ] **Step 6: Add copy**

In `mobile/src/copy/ar.ts`, add a `trainingSession` block right after the `notifications` block added in Task 1 (before the closing `};`):

```typescript
  trainingSession: {
    title: 'تدريب اليوم',
    hoursRemainingLabel: 'ساعة متبقية حتى فتح مرحلة العينة',
    dailyTargetLabel: 'هدف اليوم',
    intervalActiveLabel: 'التدريب التالي متاح الساعة',
    startOrResume: 'ابدأ / استكمل التدريب',
    addUnits: '+10 وحدة',
    unitsProgressLabel: 'وحدة',
    completedTitle: 'أحسنت! أكملت تدريب اليوم',
    backToHome: 'العودة للرئيسية',
    viewLevelContent: 'مشاهدة محتوى المستوى',
    trainingListTitle: 'قائمة التدريب',
  },
```

- [ ] **Step 7: Run the full suite to check for regressions**

Run: `npm test -- --ci` (from `mobile/`)
Expected: everything PASSES — 107 tests (104 + 3 new), 28 suites (27 + 1 new). (`npx tsc --noEmit` will still show the one expected `home.tsx` error from Step 5 until Task 5 lands — that's fine, `npm test` itself doesn't type-check.)

- [ ] **Step 8: Commit**

```bash
git add mobile/src/api/treatmentEngine.ts mobile/src/api/__tests__/treatmentEngine.test.ts mobile/src/copy/ar.ts
git commit -m "feat: replace logTrainingEvent with the training-session API contract"
```

---

### Task 4: Training-session screen

**Files:**
- Create: `mobile/app/program/training-session.tsx`
- Test: `mobile/app/program/__tests__/training-session.test.tsx`

**Interfaces:**
- Consumes: `startOrResumeTrainingSession`, `recordTrainingProgress`, `getTrainingProgress`, `TrainingSession`, `TrainingProgressSummary` (Task 3), `getCurrentCycle`, `getLevels`, `getActiveLevelVersion`, `TrainingCycle`, `Level`, `LevelVersion` (existing, `treatmentEngine.ts`), `ar.trainingSession.*` (Task 3).

- [ ] **Step 1: Write the failing tests**

Create `mobile/app/program/__tests__/training-session.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import TrainingSessionScreen from '../training-session';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import {
  getCurrentCycle,
  getLevels,
  getActiveLevelVersion,
  startOrResumeTrainingSession,
  recordTrainingProgress,
  getTrainingProgress,
} from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});

const baseCycle = {
  id: 'cycle-1',
  levelId: 'level-1',
  status: 'ACTIVE_LEVEL_TRAINING',
  humanModelWatchedAt: '2026-07-14T00:00:00.000Z',
  firstTrainingEventAt: '2026-07-14T12:00:00.000Z',
};

const baseLevels = [{ id: 'level-1', name: 'المستوى الأول', order: 1, status: 'ACTIVE' as const }];
const baseLevelVersion = { id: 'v1', levelId: 'level-1', trainingListJson: JSON.stringify(['تمرين 1', 'تمرين 2']), samplePartTemplateJson: '[]', versionNumber: 1, behavioralTechnique: 'x', cognitiveVideo1Url: null, cognitiveVideo1Question: null, cognitiveVideo2Url: null, cognitiveVideo2Question: null, humanModelVideoUrl: null, humanModelDurationSeconds: null, publishedAt: null };

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1' });
  (getCurrentCycle as jest.Mock).mockResolvedValue(baseCycle);
  (getLevels as jest.Mock).mockResolvedValue(baseLevels);
  (getActiveLevelVersion as jest.Mock).mockResolvedValue(baseLevelVersion);
});

describe('TrainingSessionScreen', () => {
  it('shows today\'s target and completed count', async () => {
    (getTrainingProgress as jest.Mock).mockResolvedValue({
      completedToday: 2,
      targetPerDay: 7,
      intervalActive: false,
      nextAvailableAt: null,
      currentSessionId: null,
    });

    render(<ThemeProvider><TrainingSessionScreen /></ThemeProvider>);

    // A loose single-digit regex here (e.g. /2/) would be a real, reproducible
    // collision risk: baseLevelVersion's training list renders "تمرين 2" (exercise 2)
    // elsewhere on the same screen, and the time-computed "hours remaining" line
    // could independently contain a "7" depending on wall-clock time when the test
    // runs. Match the full, specific label text instead so this can only match the
    // one intended Text node.
    await waitFor(() => {
      expect(screen.getByText(/هدف اليوم: 2 \/ 7/)).toBeTruthy();
    });
  });

  it('shows the interval-active state instead of the progress control when a cooldown is active', async () => {
    (getTrainingProgress as jest.Mock).mockResolvedValue({
      completedToday: 1,
      targetPerDay: 7,
      intervalActive: true,
      nextAvailableAt: '2026-07-15T13:00:00.000Z',
      currentSessionId: null,
    });

    render(<ThemeProvider><TrainingSessionScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText(ar_intervalActiveLabelText())).toBeTruthy();
    });
    expect(screen.queryByText('+10 وحدة')).toBeNull();

    function ar_intervalActiveLabelText() {
      return /التدريب التالي متاح الساعة/;
    }
  });

  it('starts a session and increments progress on tap, sending the cumulative value', async () => {
    (getTrainingProgress as jest.Mock).mockResolvedValue({
      completedToday: 0,
      targetPerDay: 7,
      intervalActive: false,
      nextAvailableAt: null,
      currentSessionId: null,
    });
    (startOrResumeTrainingSession as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'IN_PROGRESS',
      unitsCompleted: 0,
      startedAt: '2026-07-15T12:00:00.000Z',
      completedAt: null,
    });
    (recordTrainingProgress as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'IN_PROGRESS',
      unitsCompleted: 10,
      startedAt: '2026-07-15T12:00:00.000Z',
      completedAt: null,
    });

    render(<ThemeProvider><TrainingSessionScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('ابدأ / استكمل التدريب')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('ابدأ / استكمل التدريب'));

    await waitFor(() => {
      expect(startOrResumeTrainingSession).toHaveBeenCalledWith('profile-1');
      expect(screen.getByText('+10 وحدة')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('+10 وحدة'));

    await waitFor(() => {
      expect(recordTrainingProgress).toHaveBeenCalledWith('profile-1', 10);
    });
  });

  it('shows a completion state once the session reaches the threshold', async () => {
    (getTrainingProgress as jest.Mock).mockResolvedValue({
      completedToday: 0,
      targetPerDay: 7,
      intervalActive: false,
      nextAvailableAt: null,
      currentSessionId: null,
    });
    (startOrResumeTrainingSession as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'IN_PROGRESS',
      unitsCompleted: 90,
      startedAt: '2026-07-15T12:00:00.000Z',
      completedAt: null,
    });
    (recordTrainingProgress as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'COMPLETED',
      unitsCompleted: 100,
      startedAt: '2026-07-15T12:00:00.000Z',
      completedAt: '2026-07-15T12:30:00.000Z',
    });

    render(<ThemeProvider><TrainingSessionScreen /></ThemeProvider>);
    await waitFor(() => {
      expect(screen.getByText('ابدأ / استكمل التدريب')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('ابدأ / استكمل التدريب'));
    await waitFor(() => {
      expect(screen.getByText('+10 وحدة')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('+10 وحدة'));

    await waitFor(() => {
      expect(screen.getByText('أحسنت! أكملت تدريب اليوم')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --ci app/program/__tests__/training-session.test.tsx` (from `mobile/`)
Expected: FAIL — `mobile/app/program/training-session.tsx` doesn't exist yet.

- [ ] **Step 3: Create the screen**

Create `mobile/app/program/training-session.tsx`:

```typescript
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import {
  getCurrentCycle,
  getLevels,
  getActiveLevelVersion,
  startOrResumeTrainingSession,
  recordTrainingProgress,
  getTrainingProgress,
  TrainingCycle,
  Level,
  LevelVersion,
  TrainingSession,
  TrainingProgressSummary,
} from '../../src/api/treatmentEngine';

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
const PROGRESS_STEP = 10;

function hoursRemainingUntilSampleEligibility(firstTrainingEventAt: string | null): number | null {
  if (!firstTrainingEventAt) return 72;
  const elapsedMs = Date.now() - new Date(firstTrainingEventAt).getTime();
  const remainingMs = SEVENTY_TWO_HOURS_MS - elapsedMs;
  if (remainingMs <= 0) return null;
  return Math.ceil(remainingMs / (60 * 60 * 1000));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
}

export default function TrainingSessionScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<TrainingCycle | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelVersion, setLevelVersion] = useState<LevelVersion | null>(null);
  const [progress, setProgress] = useState<TrainingProgressSummary | null>(null);
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const currentCycle = await getCurrentCycle(id);
      setCycle(currentCycle);
      const [levelsResult, versionResult, progressResult] = await Promise.all([
        getLevels(),
        getActiveLevelVersion(currentCycle.levelId),
        getTrainingProgress(id),
      ]);
      setLevels(levelsResult);
      setLevelVersion(versionResult);
      setProgress(progressResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (patientProfileId) {
        load(patientProfileId);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [patientProfileId]),
  );

  async function handleStartOrResume() {
    if (!patientProfileId) return;
    setSubmitting(true);
    try {
      const result = await startOrResumeTrainingSession(patientProfileId);
      setSession(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddUnits() {
    if (!patientProfileId || !session) return;
    setSubmitting(true);
    try {
      const cumulative = session.unitsCompleted + PROGRESS_STEP;
      const result = await recordTrainingProgress(patientProfileId, cumulative);
      setSession(result);
      if (result.status === 'COMPLETED' && patientProfileId) {
        const refreshedProgress = await getTrainingProgress(patientProfileId);
        setProgress(refreshedProgress);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={{ color: tokens.colors.text }}>{ar.program.loading}</Text>
      </View>
    );
  }

  if (error || !cycle || !progress) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error ?? 'حدث خطأ غير متوقع'} />
      </View>
    );
  }

  const levelName = levels.find((l) => l.id === cycle.levelId)?.name ?? '';
  const hoursRemaining = hoursRemainingUntilSampleEligibility(cycle.firstTrainingEventAt);
  const trainingList: string[] = levelVersion ? JSON.parse(levelVersion.trainingListJson) : [];

  if (session?.status === 'COMPLETED') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.trainingSession.completedTitle}</Text>
        <View style={{ marginTop: 24 }}>
          <Button title={ar.trainingSession.backToHome} onPress={() => router.push('/home')} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.trainingSession.title}</Text>
      {levelName ? <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>{levelName}</Text> : null}
      {hoursRemaining !== null ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 8 }}>
          {hoursRemaining} {ar.trainingSession.hoursRemainingLabel}
        </Text>
      ) : null}
      <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>
        {ar.trainingSession.dailyTargetLabel}: {progress.completedToday} / {progress.targetPerDay}
      </Text>

      {progress.intervalActive && progress.nextAvailableAt ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>
          {ar.trainingSession.intervalActiveLabel} {formatTime(progress.nextAvailableAt)}
        </Text>
      ) : session ? (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>
            {session.unitsCompleted} / 100 {ar.trainingSession.unitsProgressLabel}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: tokens.colors.border }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: tokens.colors.primary, width: `${Math.min(session.unitsCompleted, 100)}%` },
              ]}
            />
          </View>
          <View style={{ marginTop: 12 }}>
            <Button title={ar.trainingSession.addUnits} onPress={handleAddUnits} loading={submitting} />
          </View>
        </View>
      ) : (
        <View style={{ marginBottom: 16 }}>
          <Button title={ar.trainingSession.startOrResume} onPress={handleStartOrResume} loading={submitting} />
        </View>
      )}

      {!progress.intervalActive && !session ? null : null}

      <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.trainingSession.trainingListTitle}</Text>
      {trainingList.map((item, index) => (
        <Text key={index} style={{ color: tokens.colors.text, marginBottom: 4 }}>
          {item}
        </Text>
      ))}

      <View style={{ marginTop: 24 }}>
        <Button title={ar.trainingSession.viewLevelContent} onPress={() => router.push('/program/level-content')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  progressTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: 10 },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --ci app/program/__tests__/training-session.test.tsx` (from `mobile/`)
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm test -- --ci` (from `mobile/`)
Expected: everything PASSES — 111 tests (107 + 4 new), 29 suites (28 + 1 new). (`npx tsc --noEmit` will still show the one expected `home.tsx` error until Task 5 lands.)

- [ ] **Step 6: Commit**

```bash
git add mobile/app/program/training-session.tsx mobile/app/program/__tests__/training-session.test.tsx
git commit -m "feat: add training-session screen"
```

---

### Task 5: Repoint the "log training" button and fix its test

**Files:**
- Modify: `mobile/app/home.tsx`
- Modify: `mobile/app/__tests__/home.test.tsx`

**Interfaces:**
- Consumes: nothing new — this task only removes the last caller of the now-deleted `logTrainingEvent` and points the button at Task 4's screen instead.

- [ ] **Step 1: Write the failing test**

In `mobile/app/__tests__/home.test.tsx`, the file currently reads (relevant excerpts):

```typescript
import { getProgress, getCurrentCycle, getCycleHistory, getActiveTreatmentPlan, startCycle, logTrainingEvent } from '../../src/api/treatmentEngine';
import { ApiError } from '../../src/api/client';

jest.mock('../../src/auth/AuthProvider');
jest.mock('../../src/patient/PatientProfileProvider');
jest.mock('../../src/api/treatmentEngine');
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});
```

and the test to replace currently reads:

```typescript
  it('shows an inline "log training" button once the model is watched, and calls the endpoint', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({
      id: 'cycle-1',
      levelId: 'level-1',
      status: 'ACTIVE_LEVEL_TRAINING',
      humanModelWatchedAt: '2026-07-01T00:00:00.000Z',
    });
    (logTrainingEvent as jest.Mock).mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE_LEVEL_TRAINING' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('سجّل تدريب اليوم')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('سجّل تدريب اليوم'));

    await waitFor(() => {
      expect(logTrainingEvent).toHaveBeenCalledWith('profile-1');
    });
  });
```

Replace the import line (removing `logTrainingEvent`, it no longer exists):

```typescript
import { getProgress, getCurrentCycle, getCycleHistory, getActiveTreatmentPlan, startCycle } from '../../src/api/treatmentEngine';
```

Replace the `expo-router` mock, hoisting a stable `push` reference so the test can assert on it (every other test in this file continues to work identically — none of them relied on `push` being a fresh mock per render):

```typescript
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});
```

Add `jest.clearAllMocks()` already exists in the file's `beforeEach` — confirm it stays there (it does, untouched); it's what resets `mockPush`'s call count between tests.

Replace the test itself:

```typescript
  it('navigates to the training-session screen once the model is watched', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({
      id: 'cycle-1',
      levelId: 'level-1',
      status: 'ACTIVE_LEVEL_TRAINING',
      humanModelWatchedAt: '2026-07-01T00:00:00.000Z',
    });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('سجّل تدريب اليوم')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('سجّل تدريب اليوم'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/program/training-session');
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --ci app/__tests__/home.test.tsx` (from `mobile/`)
Expected: FAIL — `home.tsx` still calls `handleLogTraining`/`logTrainingEvent`, so `mockPush` is never called with `/program/training-session`; also `logTrainingEvent` no longer exists as an export, so the mocked module has no such property (the test's `jest.mock('../../src/api/treatmentEngine')` auto-mocks whatever the real module currently exports, so this manifests as `handleLogTraining` throwing when it calls `undefined`).

- [ ] **Step 3: Repoint the button**

In `mobile/app/home.tsx`, the file currently has this import (lines 11-22):

```typescript
import {
  getProgress,
  getCurrentCycle,
  getCycleHistory,
  getActiveTreatmentPlan,
  startCycle,
  logTrainingEvent,
  ProgressDashboard,
  TrainingCycle,
  TrainingCycleWithSample,
  TreatmentPlan,
} from '../src/api/treatmentEngine';
```

this handler (lines 114-125):

```typescript
  async function handleLogTraining() {
    if (!patientProfileId) return;
    setSubmitting(true);
    try {
      await logTrainingEvent(patientProfileId);
      await load(patientProfileId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }
```

and this render branch (line 149):

```typescript
      return <Button title={ar.program.logTraining} onPress={handleLogTraining} loading={submitting} />;
```

Replace the import (removing `logTrainingEvent`):

```typescript
import {
  getProgress,
  getCurrentCycle,
  getCycleHistory,
  getActiveTreatmentPlan,
  startCycle,
  ProgressDashboard,
  TrainingCycle,
  TrainingCycleWithSample,
  TreatmentPlan,
} from '../src/api/treatmentEngine';
```

Delete the `handleLogTraining` function entirely (it's no longer called from anywhere).

Replace the render branch:

```typescript
      return <Button title={ar.program.logTraining} onPress={() => router.push('/program/training-session')} />;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --ci app/__tests__/home.test.tsx` (from `mobile/`)
Expected: all tests in this file PASS, including the rewritten one.

- [ ] **Step 5: Confirm the TypeScript error from Task 3 is now resolved**

Run: `npx tsc --noEmit` (from `mobile/`)
Expected: no errors — this was the one caller of `logTrainingEvent` left dangling since Task 3.

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `npm test -- --ci` (from `mobile/`)
Expected: everything PASSES — 111 tests (unchanged count: one test renamed/rewritten in place, not added), 29 suites.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/home.tsx mobile/app/__tests__/home.test.tsx
git commit -m "fix: repoint the log-training button at the training-session screen"
```

---

## Self-Review Notes

- **Spec coverage:** §62's checklist is covered item-by-item in the design's mapping table; the two deliberately-deferred items (passed-levels reinforcement screen, unread-count badge) are named explicitly with reasons, not silently dropped. §59's "commitment indicator only" framing is the stated rationale for the stepper-based progress control, quoted directly in the design.
- **No placeholders:** every step has complete, runnable code including all five new/changed test files and the exact before/after diffs for every modified file.
- **Type consistency:** `AppNotification`, `TrainingSession`, `TrainingProgressSummary` are spelled and typed identically everywhere they're produced (Task 1/Task 3) and consumed (Task 2/Task 4). `ar.notifications.*`/`ar.trainingSession.*` keys used in each screen's JSX match exactly what Task 1/Task 3 add to `ar.ts` — cross-checked key-by-key while writing Task 2's and Task 4's code against Task 1's and Task 3's copy blocks.
- **Cross-task ordering verified:** Task 3 intentionally leaves `home.tsx` momentarily broken (a known, called-out TypeScript error, not a test failure) between Tasks 3 and 5 — Task 4 doesn't depend on `home.tsx` compiling, only on Task 3's API additions, so this ordering doesn't block Task 4's own tests from passing. Task 5 is explicitly the task that resolves it.
- **Test-running note carried into every task:** the documented CPU-contention flake (a comment already present in `home.test.tsx` itself) means a broad, unrelated first-run failure spread should be re-run once before treating anything as a real regression — stated once in Global Constraints rather than repeated in every task.
