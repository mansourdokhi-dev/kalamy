# Mobile Sample Recording Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a patient record, review, assemble, and submit a Treatment Engine v2 speech sample from the mobile app, and separately re-record any parts a specialist flags as damaged.

**Architecture:** A small backend upload endpoint turns a locally-recorded audio file into a URL the existing sample endpoints already know how to store. The mobile app gets a reusable record/playback component pair (`AudioRecorder`/`AudioPlayer`), 8 new API functions, a 3-step wizard screen for the main recording flow, a simpler screen for damaged-part re-record, and a Home-screen integration replacing the current placeholder text with real navigation.

**Tech Stack:** NestJS 11 + `@nestjs/platform-express`'s `FileInterceptor`/multer (backend, no new runtime dependency beyond `@types/multer` for typings) + local disk storage; Expo ~57 + `expo-audio` (new mobile dependency) + React Native 0.86 + expo-router.

## Global Constraints

- Backend: the new upload endpoint reuses the existing `PREPARE_SAMPLE` permission — no RBAC changes.
- Backend: no Prisma schema changes, no new migrations. The upload endpoint is pure file-handling; it returns a URL string consumed exactly like any other `recordingUrl`.
- Backend: uploaded files are never deleted, even when an attempt is soft-deleted or a part is superseded by re-record (matches the project's "never destroy clinical history" convention).
- Mobile: the only new dependency is `expo-audio` (for recording/playback) — no `@react-native-picker/picker` or other UI-kit dependency; part-assignment in Step 2 uses plain `Pressable` rows, not a native picker.
- Mobile: recording is capped at **3 minutes** per attempt (auto-stop, not silent truncation), matching real therapy-session protocol.
- Mobile: RTL and Arabic-only copy, matching the existing `src/copy/ar.ts` flat-nested-object convention exactly.
- Mobile: every fetch uses the existing `apiRequest` client from `mobile/src/api/client.ts` (extended in this plan to support file uploads, not replaced).
- The initial-recording flow (`sample-recording.tsx`) and the damaged-part re-record flow (`sample-rerecord.tsx`) are both in scope and both reuse `AudioRecorder`.
- No specialist/clinician-facing UI, no real cloud storage integration, no audio transcription/AI analysis, no video playback UI, no multi-child caregiver switching — all out of scope per `docs/superpowers/specs/2026-07-10-mobile-sample-recording-design.md`.

---

### Task 1: Backend — audio upload endpoint

**Files:**
- Modify: `backend/src/modules/treatment-engine/samples.controller.ts`
- Modify: `backend/src/main.ts`
- Modify: `backend/.gitignore`
- Modify: `backend/package.json` (add `@types/multer` devDependency)
- Test: `backend/test/treatment-engine-upload.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /api/v1/patients/:patientId/cycles/current/sample-session/upload` — `multipart/form-data` with a field named `audio` — returns `{ "url": string }`. Consumed by mobile's `uploadRecording()` (Task 2).

- [ ] **Step 1: Install `@types/multer`**

Run: `cd backend && npm install --save-dev @types/multer`
Expected: `backend/package.json`'s `devDependencies` gains `@types/multer`.

- [ ] **Step 2: Write the failing e2e test**

Create `backend/test/treatment-engine-upload.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerAndLogin(
  app: INestApplication,
  prisma: PrismaService,
  mobile: string,
  role: 'CLINICIAN' | 'ADMIN' | 'SUPERVISOR' | null,
): Promise<string> {
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ fullName: 'Test User', mobile, password: 'test-pass-1', role: 'PATIENT' });
  await request(app.getHttpServer())
    .post('/api/v1/auth/verify')
    .send({ mobile, code: register.body.devOtpCode });
  if (role) {
    await prisma.user.update({ where: { mobile }, data: { role } });
  }
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password: 'test-pass-1' });
  return login.body.token;
}

describe('Treatment Engine — Sample upload (e2e)', () => {
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

  async function seedPatientReadyForSample(clinicianMobile: string, patientMobile: string) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id,
        fullName: 'Upload Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: `UPLOAD-TEST-${patientMobile}`,
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: {
        levelId: level.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    await prisma.trainingCycle72h.update({ where: { id: startRes.body.id }, data: { status: 'SAMPLE_ELIGIBLE' } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    return { patientProfile, patientToken };
  }

  it('accepts an audio file upload and returns a servable URL', async () => {
    const { patientProfile, patientToken } = await seedPatientReadyForSample('+966500003000', '+966500003001');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/upload`)
      .set('Authorization', `Bearer ${patientToken}`)
      .attach('audio', Buffer.from('fake-audio-bytes'), { filename: 'test.m4a', contentType: 'audio/m4a' })
      .expect(201);

    expect(res.body.url).toContain('/uploads/audio/');
    expect(res.body.url).toMatch(/\.m4a$/);
  });

  it('rejects a non-audio file with 400', async () => {
    const { patientProfile, patientToken } = await seedPatientReadyForSample('+966500003100', '+966500003101');

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/upload`)
      .set('Authorization', `Bearer ${patientToken}`)
      .attach('audio', Buffer.from('not audio'), { filename: 'test.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('rejects the request with 404 when patientId does not resolve to a current cycle for this actor', async () => {
    const patientToken = await registerAndLogin(app, prisma, '+966500003201', null);

    await request(app.getHttpServer())
      .post('/api/v1/patients/00000000-0000-0000-0000-000000000000/cycles/current/sample-session/upload')
      .set('Authorization', `Bearer ${patientToken}`)
      .attach('audio', Buffer.from('fake-audio-bytes'), { filename: 'test.m4a', contentType: 'audio/m4a' })
      .expect(404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx jest --config ./test/jest-e2e.json --runInBand treatment-engine-upload`
Expected: FAIL — route doesn't exist yet (404 on all three tests, first two failing their `.expect(201)`/`.expect(400)`).

- [ ] **Step 4: Add the upload route to `samples.controller.ts`**

Read `backend/src/modules/treatment-engine/samples.controller.ts` first (unchanged parts must stay exactly as they are). Add these imports at the top:

```typescript
import { BadRequestException, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import type { Request } from 'express';
```

Add this method inside the `SamplesController` class, alongside the other routes (order doesn't matter, but place it after `openSession` for readability):

```typescript
  @Post('upload')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'audio');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('audio/')) {
          cb(new BadRequestException('Only audio files are accepted'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadRecording(
    @Param('patientId') patientId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.trainingCyclesService.getCurrent(patientId, user);
    if (!file) {
      throw new BadRequestException('No audio file provided');
    }
    return { url: `${req.protocol}://${req.get('host')}/uploads/audio/${file.filename}` };
  }
```

- [ ] **Step 5: Wire static file serving in `main.ts`**

Read `backend/src/main.ts` first. Replace its full contents with:

```typescript
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  const config = new DocumentBuilder()
    .setTitle('Kalamy API')
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, Exercise Library, Treatment Engine (Levels, 72-Hour Cycles, Samples, Specialist Review), Progress, Reports, Complaints, and Administration modules')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document));

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}
bootstrap();
```

- [ ] **Step 6: Add `/uploads` to `.gitignore`**

Read `backend/.gitignore` first (current contents: `node_modules/`, `dist/`, `.env`, `*.log`, `coverage/`). Append a new line:

```
uploads/
```

- [ ] **Step 7: Run the e2e test to verify it passes**

Run: `cd backend && npx jest --config ./test/jest-e2e.json --runInBand treatment-engine-upload`
Expected: PASS, all 3 tests.

- [ ] **Step 8: Run the full backend e2e suite to confirm no regressions**

Run: `cd backend && npm run test:e2e`
Expected: every existing suite still passes, plus the 3 new tests (158/158 if the baseline was 155/155).

- [ ] **Step 9: Run `tsc --noEmit` to confirm the new file/multer types compile cleanly**

Run: `cd backend && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/treatment-engine/samples.controller.ts backend/src/main.ts backend/.gitignore backend/package.json backend/package-lock.json backend/test/treatment-engine-upload.e2e-spec.ts
git commit -m "feat: add audio upload endpoint for sample recording

Accepts a multipart audio file, stores it under backend/uploads/audio/
(git-ignored), and returns a URL the existing sample endpoints already
know how to store as recordingUrl. No schema changes, no new RBAC
grant — reuses PREPARE_SAMPLE. Files are never deleted server-side,
matching the project's never-destroy-clinical-history convention."
```

---

### Task 2: Mobile — API client multipart support + sample API functions + `expo-audio` dependency

**Files:**
- Modify: `mobile/src/api/client.ts`
- Modify: `mobile/src/api/treatmentEngine.ts`
- Modify: `mobile/app.json`
- Modify: `mobile/package.json`
- Test: `mobile/src/api/__tests__/client.test.ts` (add to existing file)

**Interfaces:**
- Consumes: nothing new from earlier tasks.
- Produces: `apiRequest`'s `ApiRequestOptions` gains an optional `formData?: FormData` field. `treatmentEngine.ts` gains: `openSampleSession(patientProfileId): Promise<SampleSession>`, `listAttempts(patientProfileId): Promise<SampleAttempt[]>`, `recordAttempt(patientProfileId, recordingUrl): Promise<SampleAttempt>`, `deleteAttempt(patientProfileId, attemptId): Promise<SampleAttempt>`, `submitSample(patientProfileId, dto: SubmitSampleInput): Promise<SpeechSample>`, `rerecordDamagedParts(patientProfileId, parts: RerecordPartInput[]): Promise<SpeechSample>`, `uploadRecording(patientProfileId, fileUri): Promise<{ url: string }>`, plus exported types `SampleSession`, `SampleAttempt`, `SubmitSamplePart`, `SubmitSampleInput`, `RerecordPartInput`. `TrainingCycle` gains an optional `speechSample?: SpeechSample | null` field.

- [ ] **Step 1: Write the failing test for `apiRequest`'s multipart support**

Read `mobile/src/api/__tests__/client.test.ts` first — add these two tests to its existing `describe` block, matching the file's established per-test `global.fetch = jest.fn().mockResolvedValue(...)` pattern exactly (do not remove any existing tests):

```typescript
  it('sends a FormData body directly, without JSON-encoding it or forcing a JSON content-type', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ url: 'http://localhost:3000/uploads/audio/x.m4a' }),
    }) as unknown as typeof fetch;
    const formData = new FormData();
    formData.append('audio', 'fake-file-data');

    await apiRequest('/api/v1/upload', { method: 'POST', formData });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/upload'),
      expect.objectContaining({
        body: formData,
        headers: expect.not.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('still JSON-encodes and sets Content-Type when formData is not provided', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await apiRequest('/api/v1/x', { method: 'POST', body: { a: 1 } });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/x'),
      expect.objectContaining({
        body: JSON.stringify({ a: 1 }),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npm test -- client.test.ts`
Expected: FAIL — `formData` isn't a recognized option yet, so the first new test's `options.body` won't equal `formData` and `Content-Type` will still be `'application/json'`.

- [ ] **Step 3: Extend `apiRequest` in `client.ts`**

Read `mobile/src/api/client.ts` first. Replace its full contents with:

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
  formData?: FormData;
  auth?: boolean;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (!options.formData) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.auth) {
    const token = await getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npm test -- client.test.ts`
Expected: PASS, including the 2 new tests plus every pre-existing test in that file.

- [ ] **Step 5: Add `expo-audio` and configure its plugin**

Run: `cd mobile && npx expo install expo-audio`
Expected: `mobile/package.json`'s `dependencies` gains an `expo-audio` entry pinned to the version compatible with Expo ~57.

Read `mobile/app.json` first. Change its `"plugins"` array from:

```json
    "plugins": [
      "expo-router",
      "expo-status-bar",
      "expo-secure-store"
    ]
```

to:

```json
    "plugins": [
      "expo-router",
      "expo-status-bar",
      "expo-secure-store",
      [
        "expo-audio",
        {
          "microphonePermission": "يحتاج كلامي إلى الوصول إلى الميكروفون لتسجيل عينتك الصوتية.",
          "recordAudioAndroid": true,
          "enableBackgroundRecording": false,
          "enableBackgroundPlayback": false
        }
      ]
    ]
```

- [ ] **Step 6: Extend `treatmentEngine.ts` with the sample API functions and types**

Read `mobile/src/api/treatmentEngine.ts` first (do not remove or reorder any existing export). Make two small edits to existing code, then append new code.

**Edit A** — extend the existing `TrainingCycle` interface to add one optional field (the backend's `GET /cycles/current` response already includes this; only the mobile-side type was missing it):

```typescript
export interface TrainingCycle {
  id: string;
  patientProfileId: string;
  treatmentPlanId: string;
  levelId: string;
  levelVersionId: string;
  cycleNumber: number;
  status: LevelCycleStatus;
  humanModelWatchedAt: string | null;
  firstTrainingEventAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  speechSample?: SpeechSample | null;
}
```

(This is a forward reference to `SpeechSample`, declared later in the same file — valid TypeScript, since interface declarations are not order-sensitive.)

**Edit B** — none; everything else below is a pure append at the end of the file.

Append this to the end of `mobile/src/api/treatmentEngine.ts`:

```typescript

export interface SampleSession {
  id: string;
  trainingCycleId: string;
  attemptsUsed: number;
  status: 'OPEN' | 'CLOSED_SUBMITTED' | 'CLOSED_EXHAUSTED';
  createdAt: string;
  updatedAt: string;
}

export function openSampleSession(patientProfileId: string): Promise<SampleSession> {
  return apiRequest<SampleSession>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session`, {
    method: 'POST',
    auth: true,
  });
}

export interface SampleAttempt {
  id: string;
  sampleSessionId: string;
  attemptNumber: number;
  recordingUrl: string;
  deletedAt: string | null;
  createdAt: string;
}

export function listAttempts(patientProfileId: string): Promise<SampleAttempt[]> {
  return apiRequest<SampleAttempt[]>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/attempts`, {
    auth: true,
  });
}

export function recordAttempt(patientProfileId: string, recordingUrl: string): Promise<SampleAttempt> {
  return apiRequest<SampleAttempt>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/attempts`, {
    method: 'POST',
    auth: true,
    body: { recordingUrl },
  });
}

export function deleteAttempt(patientProfileId: string, attemptId: string): Promise<SampleAttempt> {
  return apiRequest<SampleAttempt>(
    `/api/v1/patients/${patientProfileId}/cycles/current/sample-session/attempts/${attemptId}`,
    { method: 'DELETE', auth: true },
  );
}

export interface SubmitSamplePart {
  partType: string;
  label: string;
  order: number;
  sourceAttemptId: string;
}

export interface SubmitSampleInput {
  parts: SubmitSamplePart[];
  selfSeverityCurrent: number;
  selfSeverityExpectedNext: number;
  camperdownPerformanceRating: number;
  clientOpinionScore: number;
}

export function submitSample(patientProfileId: string, dto: SubmitSampleInput): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/submit`, {
    method: 'POST',
    auth: true,
    body: dto,
  });
}

export interface RerecordPartInput {
  id: string;
  recordingUrl: string;
}

export function rerecordDamagedParts(patientProfileId: string, parts: RerecordPartInput[]): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/rerecord`, {
    method: 'POST',
    auth: true,
    body: { parts },
  });
}

export function uploadRecording(patientProfileId: string, fileUri: string): Promise<{ url: string }> {
  const formData = new FormData();
  const filename = fileUri.split('/').pop() ?? 'recording.m4a';
  formData.append('audio', {
    uri: fileUri,
    name: filename,
    type: 'audio/m4a',
  } as unknown as Blob);
  return apiRequest<{ url: string }>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/upload`, {
    method: 'POST',
    auth: true,
    formData,
  });
}
```

Per this codebase's established convention (`api/auth.ts`, and every function added to `treatmentEngine.ts` in the previous sub-project), these 7 functions get no dedicated unit test file — they're thin typed wrappers around `apiRequest`, verified only through the screens/components that consume them in Tasks 3-8.

- [ ] **Step 7: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus the 2 new `client.test.ts` tests (53/53 if the baseline was 51/51).

- [ ] **Step 8: Commit**

```bash
git add mobile/src/api/client.ts mobile/src/api/treatmentEngine.ts mobile/src/api/__tests__/client.test.ts mobile/app.json mobile/package.json mobile/package-lock.json
git commit -m "feat: add multipart upload support and sample-recording API functions

Extends apiRequest with an optional formData path (no JSON-encoding,
no forced Content-Type) so file uploads can reuse the same client.
Adds openSampleSession/listAttempts/recordAttempt/deleteAttempt/
submitSample/rerecordDamagedParts/uploadRecording wrapping the
existing (and one new) backend sample endpoints. Adds expo-audio as
the app's first audio dependency, with its Expo config plugin set to
Arabic mic-permission copy and background recording/playback both
disabled (not needed for this flow)."
```

---

### Task 3: Mobile — `AudioRecorder` component

**Files:**
- Create: `mobile/src/components/AudioRecorder.tsx`
- Modify: `mobile/src/copy/ar.ts` (add the `sampleRecording` namespace's recorder-related keys)
- Test: `mobile/src/components/__tests__/AudioRecorder.test.tsx`

**Interfaces:**
- Consumes: `expo-audio`'s `useAudioRecorder`, `useAudioRecorderState`, `RecordingPresets`, `requestRecordingPermissionsAsync` (Task 2's dependency install); `Button` from `mobile/src/components/Button.tsx`; `useTheme` from `mobile/src/theme/ThemeContext.tsx`.
- Produces: `AudioRecorder({ onRecorded: (uri: string) => void; disabled?: boolean })` — a component. Consumed by `sample-recording.tsx` (Task 6) and `sample-rerecord.tsx` (Task 8).

- [ ] **Step 1: Add the recorder-related copy keys**

Read `mobile/src/copy/ar.ts` first. Add this new top-level key after the existing `sampleResult` key (before the closing `};`):

```typescript
  sampleRecording: {
    title: 'تسجيل عينتك الصوتية',
    record: 'ابدأ التسجيل',
    stopRecording: 'إيقاف التسجيل',
    micPermissionDenied: 'يلزم الوصول إلى الميكروفون لتسجيل عينتك',
    maxDurationReached: 'تم بلوغ الحد الأقصى لمدة التسجيل (3 دقائق)',
  },
```

- [ ] **Step 2: Write the failing test**

Create `mobile/src/components/__tests__/AudioRecorder.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { AudioRecorder } from '../AudioRecorder';
import { useAudioRecorder, useAudioRecorderState, requestRecordingPermissionsAsync } from 'expo-audio';

jest.mock('expo-audio', () => ({
  useAudioRecorder: jest.fn(),
  useAudioRecorderState: jest.fn(),
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: jest.fn(),
}));

function mockRecorder(overrides: Partial<{ uri: string | null }> = {}) {
  return {
    uri: overrides.uri ?? null,
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
  };
}

function mockState(overrides: Partial<{ isRecording: boolean; durationMillis: number }> = {}) {
  return { isRecording: overrides.isRecording ?? false, durationMillis: overrides.durationMillis ?? 0, canRecord: true };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AudioRecorder', () => {
  it('requests mic permission and starts recording on first press when permission is granted', async () => {
    const recorder = mockRecorder();
    (useAudioRecorder as jest.Mock).mockReturnValue(recorder);
    (useAudioRecorderState as jest.Mock).mockReturnValue(mockState());
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    const onRecorded = jest.fn();

    render(<ThemeProvider><AudioRecorder onRecorded={onRecorded} /></ThemeProvider>);
    fireEvent.press(screen.getByText('ابدأ التسجيل'));

    await waitFor(() => {
      expect(recorder.prepareToRecordAsync).toHaveBeenCalled();
      expect(recorder.record).toHaveBeenCalled();
    });
  });

  it('shows a permission-denied message and does not start recording when permission is refused', async () => {
    const recorder = mockRecorder();
    (useAudioRecorder as jest.Mock).mockReturnValue(recorder);
    (useAudioRecorderState as jest.Mock).mockReturnValue(mockState());
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

    render(<ThemeProvider><AudioRecorder onRecorded={jest.fn()} /></ThemeProvider>);
    fireEvent.press(screen.getByText('ابدأ التسجيل'));

    await waitFor(() => {
      expect(screen.getByText('يلزم الوصول إلى الميكروفون لتسجيل عينتك')).toBeTruthy();
    });
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('stops recording and calls onRecorded with the resulting uri when pressed again while recording', async () => {
    const recorder = mockRecorder({ uri: 'file:///tmp/recording-1.m4a' });
    (useAudioRecorder as jest.Mock).mockReturnValue(recorder);
    (useAudioRecorderState as jest.Mock).mockReturnValue(mockState({ isRecording: true, durationMillis: 5000 }));
    const onRecorded = jest.fn();

    render(<ThemeProvider><AudioRecorder onRecorded={onRecorded} /></ThemeProvider>);
    fireEvent.press(screen.getByText('إيقاف التسجيل'));

    await waitFor(() => {
      expect(recorder.stop).toHaveBeenCalled();
      expect(onRecorded).toHaveBeenCalledWith('file:///tmp/recording-1.m4a');
    });
  });

  it('auto-stops and calls onRecorded once the 3-minute cap is reached', async () => {
    const recorder = mockRecorder({ uri: 'file:///tmp/recording-2.m4a' });
    (useAudioRecorder as jest.Mock).mockReturnValue(recorder);
    (useAudioRecorderState as jest.Mock).mockReturnValue(mockState({ isRecording: true, durationMillis: 3 * 60 * 1000 }));
    const onRecorded = jest.fn();

    render(<ThemeProvider><AudioRecorder onRecorded={onRecorded} /></ThemeProvider>);

    await waitFor(() => {
      expect(recorder.stop).toHaveBeenCalledTimes(1);
      expect(onRecorded).toHaveBeenCalledWith('file:///tmp/recording-2.m4a');
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npm test -- AudioRecorder.test.tsx`
Expected: FAIL — `mobile/src/components/AudioRecorder.tsx` doesn't exist yet.

- [ ] **Step 4: Write the component**

Create `mobile/src/components/AudioRecorder.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { useTheme } from '../theme/ThemeContext';
import { Button } from './Button';
import { ar } from '../copy/ar';

const MAX_DURATION_MILLIS = 3 * 60 * 1000;

interface AudioRecorderProps {
  onRecorded: (uri: string) => void;
  disabled?: boolean;
}

export function AudioRecorder({ onRecorded, disabled }: AudioRecorderProps) {
  const { tokens } = useTheme();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const autoStopTriggered = useRef(false);

  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis >= MAX_DURATION_MILLIS && !autoStopTriggered.current) {
      autoStopTriggered.current = true;
      stopAndReport();
    }
    if (!recorderState.isRecording) {
      autoStopTriggered.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState.isRecording, recorderState.durationMillis]);

  async function stopAndReport() {
    await audioRecorder.stop();
    if (audioRecorder.uri) {
      onRecorded(audioRecorder.uri);
    }
  }

  async function handlePress() {
    if (recorderState.isRecording) {
      await stopAndReport();
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record();
  }

  const seconds = Math.floor(recorderState.durationMillis / 1000);
  const hitMaxDuration = recorderState.isRecording && recorderState.durationMillis >= MAX_DURATION_MILLIS;

  return (
    <View>
      {permissionDenied ? (
        <Text style={{ color: tokens.colors.danger, marginBottom: 8 }}>{ar.sampleRecording.micPermissionDenied}</Text>
      ) : null}
      {hitMaxDuration ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 8 }}>{ar.sampleRecording.maxDurationReached}</Text>
      ) : recorderState.isRecording ? (
        <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>{`${seconds}s`}</Text>
      ) : null}
      <Button
        title={recorderState.isRecording ? ar.sampleRecording.stopRecording : ar.sampleRecording.record}
        onPress={handlePress}
        disabled={disabled}
      />
    </View>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npm test -- AudioRecorder.test.tsx`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus the 4 new tests.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/components/AudioRecorder.tsx mobile/src/components/__tests__/AudioRecorder.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add AudioRecorder component with 3-minute auto-stop cap"
```

---

### Task 4: Mobile — `AudioPlayer` component

**Files:**
- Create: `mobile/src/components/AudioPlayer.tsx`
- Modify: `mobile/src/copy/ar.ts` (add `play`/`pause` keys to `sampleRecording`)
- Test: `mobile/src/components/__tests__/AudioPlayer.test.tsx`

**Interfaces:**
- Consumes: `expo-audio`'s `useAudioPlayer`, `useAudioPlayerStatus`; `Button` from `mobile/src/components/Button.tsx`.
- Produces: `AudioPlayer({ uri: string })` — a component. Consumed by `sample-recording.tsx` (Task 6, to preview pool attempts).

- [ ] **Step 1: Add the play/pause copy keys**

Read `mobile/src/copy/ar.ts` first. Add these two keys inside the `sampleRecording` object added in Task 3, alongside `record`/`stopRecording`:

```typescript
    play: 'تشغيل',
    pause: 'إيقاف مؤقت',
```

- [ ] **Step 2: Write the failing test**

Create `mobile/src/components/__tests__/AudioPlayer.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { AudioPlayer } from '../AudioPlayer';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

jest.mock('expo-audio', () => ({
  useAudioPlayer: jest.fn(),
  useAudioPlayerStatus: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AudioPlayer', () => {
  it('shows a play button and current/total time when paused', () => {
    const player = { play: jest.fn(), pause: jest.fn() };
    (useAudioPlayer as jest.Mock).mockReturnValue(player);
    (useAudioPlayerStatus as jest.Mock).mockReturnValue({ playing: false, currentTime: 0, duration: 12 });

    render(<ThemeProvider><AudioPlayer uri="file:///tmp/a.m4a" /></ThemeProvider>);

    expect(screen.getByText('تشغيل')).toBeTruthy();
    expect(screen.getByText('0 ث / 12 ث')).toBeTruthy();
  });

  it('calls player.play() when the play button is pressed', () => {
    const player = { play: jest.fn(), pause: jest.fn() };
    (useAudioPlayer as jest.Mock).mockReturnValue(player);
    (useAudioPlayerStatus as jest.Mock).mockReturnValue({ playing: false, currentTime: 0, duration: 12 });

    render(<ThemeProvider><AudioPlayer uri="file:///tmp/a.m4a" /></ThemeProvider>);
    fireEvent.press(screen.getByText('تشغيل'));

    expect(player.play).toHaveBeenCalled();
  });

  it('shows a pause button and calls player.pause() when pressed while playing', () => {
    const player = { play: jest.fn(), pause: jest.fn() };
    (useAudioPlayer as jest.Mock).mockReturnValue(player);
    (useAudioPlayerStatus as jest.Mock).mockReturnValue({ playing: true, currentTime: 4, duration: 12 });

    render(<ThemeProvider><AudioPlayer uri="file:///tmp/a.m4a" /></ThemeProvider>);
    expect(screen.getByText('إيقاف مؤقت')).toBeTruthy();
    fireEvent.press(screen.getByText('إيقاف مؤقت'));

    expect(player.pause).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npm test -- AudioPlayer.test.tsx`
Expected: FAIL — `mobile/src/components/AudioPlayer.tsx` doesn't exist yet.

- [ ] **Step 4: Write the component**

Create `mobile/src/components/AudioPlayer.tsx`:

```typescript
import { View, Text, StyleSheet } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTheme } from '../theme/ThemeContext';
import { Button } from './Button';
import { ar } from '../copy/ar';

interface AudioPlayerProps {
  uri: string;
}

export function AudioPlayer({ uri }: AudioPlayerProps) {
  const { tokens } = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  function handlePress() {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }

  return (
    <View style={styles.row}>
      <Button title={status.playing ? ar.sampleRecording.pause : ar.sampleRecording.play} onPress={handlePress} />
      <Text style={{ color: tokens.colors.textSecondary }}>
        {`${Math.floor(status.currentTime)} ${ar.sampleRecording.secondsUnit} / ${Math.floor(status.duration)} ${ar.sampleRecording.secondsUnit}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npm test -- AudioPlayer.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 6: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus the 3 new tests.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/components/AudioPlayer.tsx mobile/src/components/__tests__/AudioPlayer.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add AudioPlayer component for reviewing recorded attempts"
```

---

### Task 5: Mobile — `sample-recording.tsx` (the main 3-step wizard)

**Files:**
- Create: `mobile/app/program/sample-recording.tsx`
- Modify: `mobile/src/copy/ar.ts` (add the remaining `sampleRecording` keys)
- Test: `mobile/app/program/__tests__/sample-recording.test.tsx`

**Interfaces:**
- Consumes: `getCurrentCycle`, `getActiveLevelVersion`, `openSampleSession`, `listAttempts`, `recordAttempt`, `deleteAttempt`, `uploadRecording`, `submitSample` (Task 2); `AudioRecorder` (Task 3); `AudioPlayer` (Task 4); `Button`/`ErrorBanner`; `usePatientProfile()`.
- Produces: nothing consumed by later tasks (Task 6's re-record screen is independent — it does not reuse this screen's code, only the same `AudioRecorder` component).

- [ ] **Step 1: Add the remaining `sampleRecording` copy keys**

Read `mobile/src/copy/ar.ts` first. Add these keys inside the existing `sampleRecording` object (alongside `title`/`record`/`stopRecording`/`micPermissionDenied`/`maxDurationReached`/`play`/`pause` from Tasks 3-4):

```typescript
    requiredPartsTitle: 'الأجزاء المطلوبة',
    attemptsTitle: 'محاولاتك المسجّلة',
    attemptLabel: 'محاولة',
    deleteAttempt: 'حذف',
    maxAttemptsReached: 'وصلت للحد الأقصى (10 محاولات)',
    uploading: 'جارٍ الرفع...',
    next: 'التالي',
    back: 'رجوع',
    assignPartsTitle: 'اختر التسجيل المناسب لكل جزء',
    selfReportTitle: 'تقييمك الذاتي',
    selfSeverityCurrentLabel: 'شدة التلعثم الحالية',
    selfSeverityExpectedNextLabel: 'الشدة المتوقعة للمستوى التالي',
    camperdownPerformanceLabel: 'تقييم أدائك',
    clientOpinionLabel: 'رأيك في أدائك',
    submit: 'إرسال العينة',
```

- [ ] **Step 2: Write the failing test**

Create `mobile/app/program/__tests__/sample-recording.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import SampleRecordingScreen from '../sample-recording';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import {
  getCurrentCycle,
  getActiveLevelVersion,
  openSampleSession,
  listAttempts,
  recordAttempt,
  deleteAttempt,
  uploadRecording,
  submitSample,
} from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));

jest.mock('../../../src/components/AudioRecorder', () => ({
  AudioRecorder: ({ onRecorded }: { onRecorded: (uri: string) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onRecorded('file:///mock-recording.m4a')}>
        <Text>SIMULATE_RECORD</Text>
      </Pressable>
    );
  },
}));

jest.mock('../../../src/components/AudioPlayer', () => ({
  AudioPlayer: () => {
    const { Text } = require('react-native');
    return <Text>MOCK_PLAYER</Text>;
  },
}));

function mockLevelVersion(samplePartTemplateJson: string) {
  return {
    id: 'version-1',
    levelId: 'level-1',
    versionNumber: 1,
    cognitiveVideo1Url: null,
    cognitiveVideo1Question: null,
    cognitiveVideo2Url: null,
    cognitiveVideo2Question: null,
    behavioralTechnique: 'x',
    humanModelVideoUrl: null,
    humanModelDurationSeconds: null,
    trainingListJson: '[]',
    samplePartTemplateJson,
    publishedAt: '2026-07-01T00:00:00.000Z',
  };
}

function mockAttempt(id: string, attemptNumber: number) {
  return {
    id,
    sampleSessionId: 'session-1',
    attemptNumber,
    recordingUrl: `https://example.com/${id}.m4a`,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

const twoPartsTemplate = JSON.stringify([
  { partType: 'مقطع', label: 'مقطع 1', order: 1, required: true },
  { partType: 'كلمة', label: 'كلمة 1', order: 2, required: true },
]);

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
  (getActiveLevelVersion as jest.Mock).mockResolvedValue(mockLevelVersion(twoPartsTemplate));
});

describe('SampleRecordingScreen', () => {
  it('opens a new sample session when the cycle is SAMPLE_ELIGIBLE, then shows the required parts', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_ELIGIBLE' });
    (openSampleSession as jest.Mock).mockResolvedValue({ id: 'session-1', trainingCycleId: 'cycle-1', attemptsUsed: 0, status: 'OPEN' });
    (listAttempts as jest.Mock).mockResolvedValue([]);

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(openSampleSession).toHaveBeenCalledWith('profile-1');
      expect(screen.getByText('مقطع 1')).toBeTruthy();
      expect(screen.getByText('كلمة 1')).toBeTruthy();
    });
  });

  it('does not re-open a session when the cycle is already SAMPLE_PREPARATION, and lists existing attempts', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    (listAttempts as jest.Mock).mockResolvedValue([mockAttempt('attempt-1', 1)]);

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(openSampleSession).not.toHaveBeenCalled();
      expect(screen.getByText('محاولة 1')).toBeTruthy();
    });
  });

  it('records a new attempt: uploads the file, records it, and refreshes the attempts list', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    (listAttempts as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockAttempt('attempt-1', 1)]);
    (uploadRecording as jest.Mock).mockResolvedValue({ url: 'https://example.com/attempt-1.m4a' });
    (recordAttempt as jest.Mock).mockResolvedValue(mockAttempt('attempt-1', 1));

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('SIMULATE_RECORD')).toBeTruthy());
    fireEvent.press(screen.getByText('SIMULATE_RECORD'));

    await waitFor(() => {
      expect(uploadRecording).toHaveBeenCalledWith('profile-1', 'file:///mock-recording.m4a');
      expect(recordAttempt).toHaveBeenCalledWith('profile-1', 'https://example.com/attempt-1.m4a');
      expect(screen.getByText('محاولة 1')).toBeTruthy();
    });
  });

  it('disables recording once 10 attempts exist', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    const tenAttempts = Array.from({ length: 10 }, (_, i) => mockAttempt(`attempt-${i}`, i + 1));
    (listAttempts as jest.Mock).mockResolvedValue(tenAttempts);

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('وصلت للحد الأقصى (10 محاولات)')).toBeTruthy();
    });
    expect(screen.queryByText('SIMULATE_RECORD')).toBeNull();
  });

  it('deletes an attempt and refreshes the list', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    (listAttempts as jest.Mock)
      .mockResolvedValueOnce([mockAttempt('attempt-1', 1)])
      .mockResolvedValueOnce([]);
    (deleteAttempt as jest.Mock).mockResolvedValue({ ...mockAttempt('attempt-1', 1), deletedAt: '2026-07-01T00:00:00.000Z' });

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('محاولة 1')).toBeTruthy());
    fireEvent.press(screen.getByText('حذف'));

    await waitFor(() => {
      expect(deleteAttempt).toHaveBeenCalledWith('profile-1', 'attempt-1');
      expect(screen.queryByText('محاولة 1')).toBeNull();
    });
  });

  it('gates Step 2/3 progression on part assignment, then submits with the correct shape', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    (getActiveLevelVersion as jest.Mock).mockResolvedValue(
      mockLevelVersion(JSON.stringify([{ partType: 'مقطع', label: 'مقطع 1', order: 1, required: true }])),
    );
    (listAttempts as jest.Mock).mockResolvedValue([mockAttempt('attempt-1', 1)]);
    (submitSample as jest.Mock).mockResolvedValue({ id: 'sample-1' });

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('محاولة 1')).toBeTruthy());

    fireEvent.press(screen.getByText('التالي'));
    await waitFor(() => expect(screen.getByText('اختر التسجيل المناسب لكل جزء')).toBeTruthy());

    // Step 2's own Next is disabled until the single required part is assigned
    fireEvent.press(screen.getByText('التالي'));
    expect(screen.queryByText('تقييمك الذاتي')).toBeNull();

    fireEvent.press(screen.getByText('محاولة 1'));
    fireEvent.press(screen.getByText('التالي'));
    await waitFor(() => expect(screen.getByText('تقييمك الذاتي')).toBeTruthy());

    fireEvent.press(screen.getByText('إرسال العينة'));

    await waitFor(() => {
      expect(submitSample).toHaveBeenCalledWith('profile-1', {
        parts: [{ partType: 'مقطع', label: 'مقطع 1', order: 1, sourceAttemptId: 'attempt-1' }],
        selfSeverityCurrent: 5,
        selfSeverityExpectedNext: 5,
        camperdownPerformanceRating: 5,
        clientOpinionScore: 5,
      });
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npm test -- sample-recording.test.tsx`
Expected: FAIL — `mobile/app/program/sample-recording.tsx` doesn't exist yet.

- [ ] **Step 4: Write the screen**

Create `mobile/app/program/sample-recording.tsx`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { AudioRecorder } from '../../src/components/AudioRecorder';
import { AudioPlayer } from '../../src/components/AudioPlayer';
import { ApiError } from '../../src/api/client';
import {
  getCurrentCycle,
  getActiveLevelVersion,
  openSampleSession,
  listAttempts,
  recordAttempt,
  deleteAttempt,
  uploadRecording,
  submitSample,
  SampleAttempt,
  LevelVersion,
} from '../../src/api/treatmentEngine';

const MAX_ATTEMPTS = 10;

interface SamplePartTemplate {
  partType: string;
  label: string;
  order: number;
  required: boolean;
}

function ScoreStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const { tokens } = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ color: tokens.colors.text, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Button title="-" onPress={() => onChange(Math.max(1, value - 1))} />
        <Text style={{ color: tokens.colors.text, fontSize: 16, fontWeight: '600' }}>{value}</Text>
        <Button title="+" onPress={() => onChange(Math.min(9, value + 1))} />
      </View>
    </View>
  );
}

export default function SampleRecordingScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levelVersion, setLevelVersion] = useState<LevelVersion | null>(null);
  const [attempts, setAttempts] = useState<SampleAttempt[]>([]);
  const [uploading, setUploading] = useState(false);
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [selfSeverityCurrent, setSelfSeverityCurrent] = useState(5);
  const [selfSeverityExpectedNext, setSelfSeverityExpectedNext] = useState(5);
  const [camperdownPerformanceRating, setCamperdownPerformanceRating] = useState(5);
  const [clientOpinionScore, setClientOpinionScore] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const cycle = await getCurrentCycle(id);
      if (cycle.status === 'SAMPLE_ELIGIBLE') {
        await openSampleSession(id);
      }
      const [version, attemptsResult] = await Promise.all([getActiveLevelVersion(cycle.levelId), listAttempts(id)]);
      setLevelVersion(version);
      setAttempts(attemptsResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (patientProfileId) {
      load(patientProfileId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientProfileId]);

  async function handleRecorded(fileUri: string) {
    if (!patientProfileId) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadRecording(patientProfileId, fileUri);
      await recordAttempt(patientProfileId, url);
      const attemptsResult = await listAttempts(patientProfileId);
      setAttempts(attemptsResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(attemptId: string) {
    if (!patientProfileId) return;
    try {
      await deleteAttempt(patientProfileId, attemptId);
      const attemptsResult = await listAttempts(patientProfileId);
      setAttempts(attemptsResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }

  async function handleSubmit() {
    if (!patientProfileId || !levelVersion) return;
    setSubmitting(true);
    setError(null);
    try {
      const requiredParts: SamplePartTemplate[] = JSON.parse(levelVersion.samplePartTemplateJson);
      const parts = requiredParts.map((part) => ({
        partType: part.partType,
        label: part.label,
        order: part.order,
        sourceAttemptId: assignments[part.order],
      }));
      await submitSample(patientProfileId, {
        parts,
        selfSeverityCurrent,
        selfSeverityExpectedNext,
        camperdownPerformanceRating,
        clientOpinionScore,
      });
      router.back();
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

  if (!levelVersion) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error ?? 'حدث خطأ غير متوقع'} />
      </View>
    );
  }

  const requiredParts: SamplePartTemplate[] = JSON.parse(levelVersion.samplePartTemplateJson);
  const atMaxAttempts = attempts.length >= MAX_ATTEMPTS;
  const allPartsAssigned = requiredParts.every((part) => assignments[part.order]);

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.sampleRecording.title}</Text>
      {error ? <ErrorBanner message={error} /> : null}

      {step === 1 ? (
        <View>
          <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.sampleRecording.requiredPartsTitle}</Text>
          {requiredParts.map((part) => (
            <Text key={part.order} style={{ color: tokens.colors.textSecondary, marginBottom: 4 }}>
              {part.label}
            </Text>
          ))}

          <Text style={[styles.sectionTitle, { color: tokens.colors.text, marginTop: 16 }]}>{ar.sampleRecording.attemptsTitle}</Text>
          {attempts.map((attempt) => (
            <View key={attempt.id} style={styles.attemptRow}>
              <Text style={{ color: tokens.colors.text }}>{`${ar.sampleRecording.attemptLabel} ${attempt.attemptNumber}`}</Text>
              <AudioPlayer uri={attempt.recordingUrl} />
              <Button title={ar.sampleRecording.deleteAttempt} onPress={() => handleDelete(attempt.id)} />
            </View>
          ))}

          {atMaxAttempts ? (
            <Text style={{ color: tokens.colors.textSecondary, marginVertical: 8 }}>{ar.sampleRecording.maxAttemptsReached}</Text>
          ) : uploading ? (
            <Text style={{ color: tokens.colors.textSecondary, marginVertical: 8 }}>{ar.sampleRecording.uploading}</Text>
          ) : (
            <AudioRecorder onRecorded={handleRecorded} />
          )}

          <View style={{ marginTop: 24 }}>
            <Button title={ar.sampleRecording.next} onPress={() => setStep(2)} disabled={attempts.length === 0} />
          </View>
        </View>
      ) : null}

      {step === 2 ? (
        <View>
          <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.sampleRecording.assignPartsTitle}</Text>
          {requiredParts.map((part) => (
            <View key={part.order} style={{ marginBottom: 16 }}>
              <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>{part.label}</Text>
              {attempts.map((attempt) => {
                const selected = assignments[part.order] === attempt.id;
                return (
                  <Pressable
                    key={attempt.id}
                    onPress={() => setAssignments((prev) => ({ ...prev, [part.order]: attempt.id }))}
                    style={[styles.attemptChoiceRow, { borderColor: selected ? tokens.colors.primary : tokens.colors.border }]}
                  >
                    <Text style={{ color: selected ? tokens.colors.primary : tokens.colors.text }}>
                      {`${ar.sampleRecording.attemptLabel} ${attempt.attemptNumber}`}
                    </Text>
                    <AudioPlayer uri={attempt.recordingUrl} />
                  </Pressable>
                );
              })}
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <Button title={ar.sampleRecording.back} onPress={() => setStep(1)} />
            <Button title={ar.sampleRecording.next} onPress={() => setStep(3)} disabled={!allPartsAssigned} />
          </View>
        </View>
      ) : null}

      {step === 3 ? (
        <View>
          <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.sampleRecording.selfReportTitle}</Text>
          <ScoreStepper label={ar.sampleRecording.selfSeverityCurrentLabel} value={selfSeverityCurrent} onChange={setSelfSeverityCurrent} />
          <ScoreStepper label={ar.sampleRecording.selfSeverityExpectedNextLabel} value={selfSeverityExpectedNext} onChange={setSelfSeverityExpectedNext} />
          <ScoreStepper label={ar.sampleRecording.camperdownPerformanceLabel} value={camperdownPerformanceRating} onChange={setCamperdownPerformanceRating} />
          <ScoreStepper label={ar.sampleRecording.clientOpinionLabel} value={clientOpinionScore} onChange={setClientOpinionScore} />
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <Button title={ar.sampleRecording.back} onPress={() => setStep(2)} />
            <Button title={ar.sampleRecording.submit} onPress={handleSubmit} loading={submitting} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  attemptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 8 },
  attemptChoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npm test -- sample-recording.test.tsx`
Expected: PASS, all 6 tests.

- [ ] **Step 6: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus the 6 new tests.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/program/sample-recording.tsx mobile/app/program/__tests__/sample-recording.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add the sample recording wizard (record pool, assign parts, self-report, submit)

Resumes correctly if the patient navigates away mid-session (only
opens a new SampleSession when the cycle is SAMPLE_ELIGIBLE, not when
already SAMPLE_PREPARATION). Enforces the 10-attempt cap client-side
as a UX nicety; the backend remains the real enforcement."
```

---

### Task 6: Mobile — `sample-rerecord.tsx` (damaged-part re-record)

**Files:**
- Create: `mobile/app/program/sample-rerecord.tsx`
- Modify: `mobile/src/copy/ar.ts` (add the `sampleRerecord` namespace)
- Test: `mobile/app/program/__tests__/sample-rerecord.test.tsx`

**Interfaces:**
- Consumes: `getCurrentCycle` (Task 2, now returning `speechSample` per the extended `TrainingCycle` type), `uploadRecording`, `rerecordDamagedParts` (Task 2); `AudioRecorder` (Task 3); `Button`/`ErrorBanner`; `usePatientProfile()`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `sampleRerecord` copy namespace**

Read `mobile/src/copy/ar.ts` first. Add this key alongside `sampleRecording` (before the closing `};`):

```typescript
  sampleRerecord: {
    title: 'إعادة تسجيل الأجزاء المطلوبة',
    instructions: 'أعد تسجيل الأجزاء التالية التي طلب أخصائيك إعادة تسجيلها',
    recorded: 'تم التسجيل',
    submit: 'إرسال',
  },
```

- [ ] **Step 2: Write the failing test**

Create `mobile/app/program/__tests__/sample-rerecord.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import SampleRerecordScreen from '../sample-rerecord';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getCurrentCycle, uploadRecording, rerecordDamagedParts } from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));

jest.mock('../../../src/components/AudioRecorder', () => ({
  AudioRecorder: ({ onRecorded }: { onRecorded: (uri: string) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onRecorded('file:///mock-rerecording.m4a')}>
        <Text>SIMULATE_RECORD</Text>
      </Pressable>
    );
  },
}));

function mockCycleWithDamagedParts() {
  return {
    id: 'cycle-1',
    patientProfileId: 'profile-1',
    treatmentPlanId: 'plan-1',
    levelId: 'level-1',
    levelVersionId: 'version-1',
    cycleNumber: 1,
    status: 'TECHNICAL_PARTIAL_RERECORD',
    humanModelWatchedAt: '2026-07-01T00:00:00.000Z',
    firstTrainingEventAt: '2026-07-01T00:00:00.000Z',
    closedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    speechSample: {
      id: 'sample-1',
      trainingCycleId: 'cycle-1',
      selfSeverityCurrent: 5,
      selfSeverityExpectedNext: 5,
      camperdownPerformanceRating: 5,
      clientOpinionScore: 5,
      submittedAt: '2026-07-01T00:00:00.000Z',
      reviewedByUserId: 'clinician-1',
      clinicianOpinionScore: 4,
      reviewNotes: null,
      reviewedAt: '2026-07-02T00:00:00.000Z',
      decision: null,
      parts: [
        { id: 'part-1', partType: 'مقطع', label: 'مقطع 1', order: 1, recordingUrl: null, technicallyDamaged: true },
        { id: 'part-2', partType: 'كلمة', label: 'كلمة 1', order: 2, recordingUrl: 'https://example.com/ok.m4a', technicallyDamaged: false },
      ],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('SampleRerecordScreen', () => {
  it('shows only the damaged parts, not the untouched ones', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue(mockCycleWithDamagedParts());

    render(<ThemeProvider><SampleRerecordScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('مقطع 1')).toBeTruthy();
    });
    expect(screen.queryByText('كلمة 1')).toBeNull();
  });

  it('uploads a re-recording for a damaged part and marks it as recorded', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue(mockCycleWithDamagedParts());
    (uploadRecording as jest.Mock).mockResolvedValue({ url: 'https://example.com/fixed.m4a' });

    render(<ThemeProvider><SampleRerecordScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('SIMULATE_RECORD')).toBeTruthy());
    fireEvent.press(screen.getByText('SIMULATE_RECORD'));

    await waitFor(() => {
      expect(uploadRecording).toHaveBeenCalledWith('profile-1', 'file:///mock-rerecording.m4a');
      expect(screen.getByText('تم التسجيل')).toBeTruthy();
    });
  });

  it('keeps Submit disabled until every damaged part has a fresh recording, then submits with the correct shape', async () => {
    const cycleWithTwoDamaged = mockCycleWithDamagedParts();
    cycleWithTwoDamaged.speechSample.parts.push({
      id: 'part-3',
      partType: 'جملة',
      label: 'جملة 1',
      order: 3,
      recordingUrl: null,
      technicallyDamaged: true,
    });
    (getCurrentCycle as jest.Mock).mockResolvedValue(cycleWithTwoDamaged);
    (uploadRecording as jest.Mock).mockResolvedValue({ url: 'https://example.com/fixed.m4a' });
    (rerecordDamagedParts as jest.Mock).mockResolvedValue({ id: 'sample-1' });

    render(<ThemeProvider><SampleRerecordScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getAllByText('SIMULATE_RECORD')).toHaveLength(2));

    // Submit is disabled with only 1 of 2 damaged parts recorded
    fireEvent.press(screen.getAllByText('SIMULATE_RECORD')[0]);
    await waitFor(() => expect(screen.getAllByText('تم التسجيل')).toHaveLength(1));
    fireEvent.press(screen.getByText('إرسال'));
    expect(rerecordDamagedParts).not.toHaveBeenCalled();

    // Recording the second damaged part enables Submit
    fireEvent.press(screen.getByText('SIMULATE_RECORD'));
    await waitFor(() => expect(screen.getAllByText('تم التسجيل')).toHaveLength(2));
    fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(rerecordDamagedParts).toHaveBeenCalledWith('profile-1', [
        { id: 'part-1', recordingUrl: 'https://example.com/fixed.m4a' },
        { id: 'part-3', recordingUrl: 'https://example.com/fixed.m4a' },
      ]);
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npm test -- sample-rerecord.test.tsx`
Expected: FAIL — `mobile/app/program/sample-rerecord.tsx` doesn't exist yet.

- [ ] **Step 4: Write the screen**

Create `mobile/app/program/sample-rerecord.tsx`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { AudioRecorder } from '../../src/components/AudioRecorder';
import { ApiError } from '../../src/api/client';
import { getCurrentCycle, uploadRecording, rerecordDamagedParts, SampleSamplePart } from '../../src/api/treatmentEngine';

export default function SampleRerecordScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [damagedParts, setDamagedParts] = useState<SampleSamplePart[]>([]);
  const [recordings, setRecordings] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const cycle = await getCurrentCycle(id);
      const parts = cycle.speechSample?.parts.filter((p) => p.technicallyDamaged) ?? [];
      setDamagedParts(parts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (patientProfileId) {
      load(patientProfileId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientProfileId]);

  async function handleRecorded(partId: string, fileUri: string) {
    if (!patientProfileId) return;
    setError(null);
    try {
      const { url } = await uploadRecording(patientProfileId, fileUri);
      setRecordings((prev) => ({ ...prev, [partId]: url }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }

  async function handleSubmit() {
    if (!patientProfileId) return;
    setSubmitting(true);
    setError(null);
    try {
      const parts = damagedParts.map((part) => ({ id: part.id, recordingUrl: recordings[part.id] }));
      await rerecordDamagedParts(patientProfileId, parts);
      router.back();
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

  if (error && damagedParts.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error} />
      </View>
    );
  }

  const allRecorded = damagedParts.every((part) => recordings[part.id]);

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.sampleRerecord.title}</Text>
      <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>{ar.sampleRerecord.instructions}</Text>
      {error ? <ErrorBanner message={error} /> : null}

      {damagedParts.map((part) => (
        <View key={part.id} style={styles.partRow}>
          <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>{part.label}</Text>
          {recordings[part.id] ? (
            <Text style={{ color: tokens.colors.primary }}>{ar.sampleRerecord.recorded}</Text>
          ) : (
            <AudioRecorder onRecorded={(uri) => handleRecorded(part.id, uri)} />
          )}
        </View>
      ))}

      <View style={{ marginTop: 24 }}>
        <Button title={ar.sampleRerecord.submit} onPress={handleSubmit} disabled={!allRecorded} loading={submitting} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  partRow: { marginBottom: 24 },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npm test -- sample-rerecord.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 6: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus the 3 new tests.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/program/sample-rerecord.tsx mobile/app/program/__tests__/sample-rerecord.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add damaged-part re-record screen

Filters to only technicallyDamaged parts, reuses AudioRecorder (no
attempt pool, no self-report — those only apply to initial
submission), gates Submit until every damaged part has a fresh
recording."
```

---

### Task 7: Mobile — Home screen integration

**Files:**
- Modify: `mobile/app/home.tsx`
- Modify: `mobile/src/copy/ar.ts` (remove the now-dead `sampleComingSoon` key, add `recordSample`/`rerecordParts`)
- Modify: `mobile/app/__tests__/home.test.tsx` (add 2 tests to the existing file)

**Interfaces:**
- Consumes: nothing new — this task only rewires existing navigation.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the `program` copy keys**

Read `mobile/src/copy/ar.ts` first. In the existing `program` object, remove this line:

```typescript
    sampleComingSoon: 'هذه المرحلة تتطلب تسجيل عينة صوتية — هذه الميزة قادمة في تحديث لاحق',
```

and add these two lines in its place:

```typescript
    recordSample: 'سجّل عينتك',
    rerecordParts: 'أعد تسجيل الأجزاء المطلوبة',
```

- [ ] **Step 2: Write the failing tests**

Read `mobile/app/__tests__/home.test.tsx` first — add these two tests to its existing `describe` block (do not remove any existing tests):

```typescript
  it('shows the "record your sample" action for SAMPLE_ELIGIBLE and SAMPLE_PREPARATION', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_ELIGIBLE' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('سجّل عينتك')).toBeTruthy();
    });
  });

  it('shows the "re-record required parts" action for TECHNICAL_PARTIAL_RERECORD', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'TECHNICAL_PARTIAL_RERECORD' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('أعد تسجيل الأجزاء المطلوبة')).toBeTruthy();
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd mobile && npm test -- home.test.tsx`
Expected: FAIL on both new tests — neither button text exists yet (the old code still renders `ar.program.sampleComingSoon`, which Step 1 already deleted, so these 2 tests fail with "text not found" rather than a stale-string mismatch).

- [ ] **Step 4: Update `home.tsx`'s `renderPrimaryAction`**

Read `mobile/app/home.tsx` first. Change the `STATES_NEEDING_SAMPLE_RECORDING` constant from:

```typescript
const STATES_NEEDING_SAMPLE_RECORDING = new Set(['SAMPLE_ELIGIBLE', 'SAMPLE_PREPARATION', 'TECHNICAL_PARTIAL_RERECORD']);
```

to:

```typescript
const STATES_NEEDING_SAMPLE_RECORDING = new Set(['SAMPLE_ELIGIBLE', 'SAMPLE_PREPARATION']);
```

Then, inside `renderPrimaryAction()`, replace:

```typescript
    if (STATES_NEEDING_SAMPLE_RECORDING.has(cycle.status)) {
      return <Text style={{ color: tokens.colors.textSecondary }}>{ar.program.sampleComingSoon}</Text>;
    }
```

with:

```typescript
    if (STATES_NEEDING_SAMPLE_RECORDING.has(cycle.status)) {
      return <Button title={ar.program.recordSample} onPress={() => router.push('/program/sample-recording')} />;
    }
    if (cycle.status === 'TECHNICAL_PARTIAL_RERECORD') {
      return <Button title={ar.program.rerecordParts} onPress={() => router.push('/program/sample-rerecord')} />;
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd mobile && npm test -- home.test.tsx`
Expected: PASS, all 7 tests (5 pre-existing + 2 new).

- [ ] **Step 6: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus the 2 new tests.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/home.tsx mobile/app/__tests__/home.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: wire Home's sample-recording placeholder to the real screens

SAMPLE_ELIGIBLE/SAMPLE_PREPARATION now navigate to the recording
wizard; TECHNICAL_PARTIAL_RERECORD now navigates to the damaged-part
re-record screen — replacing the 'coming soon' placeholder text from
sub-project 2."
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
Expected: every suite passes, including the 3 new tests from Task 1 and every pre-existing suite untouched by this plan (158/158 if the baseline was 155/155).

- [ ] **Step 2: Run `tsc --noEmit` on the backend**

```bash
cd backend
npx tsc --noEmit
```
Expected: zero errors (confirms the `@types/multer` addition resolves `Express.Multer.File` correctly).

- [ ] **Step 3: Run the full mobile test suite**

```bash
cd mobile
npm test
```
Expected: every suite passes, including the new `client.test.ts` additions, `AudioRecorder.test.tsx`, `AudioPlayer.test.tsx`, `sample-recording.test.tsx`, `sample-rerecord.test.tsx`, and the 2 new `home.test.tsx` tests, plus every pre-existing test untouched by this plan.

- [ ] **Step 4: Manual walkthrough against the running dev servers**

Start both dev servers (`kalamy-backend` and `kalamy-mobile-web` from `.claude/launch.json`, or directly via `npm run start:dev` / `npm run web` if running inside an isolated worktree whose path differs from the main repo root — confirm via the dev-server logs that they report starting from the worktree path, not a stale checkout).

Because real microphone access is not available through a headless/automated browser preview, this walkthrough has two parts:

**Part A — backend correctness via curl (always do this part):**
1. Register a patient, verify OTP, log in.
2. As a clinician, create the patient's profile, an approved assessment, and an active treatment plan (matching this project's established manual-walkthrough pattern from prior sub-projects).
3. Create and publish a `Level`/`LevelVersion` with a real `samplePartTemplateJson` (at least 2 parts).
4. Start a cycle, advance it to `SAMPLE_ELIGIBLE` via direct Prisma update (the 72h/3-period gate is real and cannot be walked through live — this is the same accepted shortcut used in prior sub-projects' walkthroughs).
5. As the patient: `POST .../cycles/current/sample-session` (open), then `POST .../sample-session/upload` with a real small `.m4a`/`.wav` file via curl's `--form`, confirm the returned URL is reachable via a plain `GET` (confirms `useStaticAssets` actually serves the file, not just that the row was saved).
6. Record 2 attempts via `.../sample-session/attempts` using the uploaded URLs, list them, delete one, confirm the 10-attempt cap still triggers a 409 on the 11th real attempt.
7. Submit the sample with both required parts mapped to live attempts, confirm the cycle transitions to `WAITING_FOR_SPECIALIST`.
8. Directly via Prisma, mark one submitted part `technicallyDamaged: true` and set the cycle to `TECHNICAL_PARTIAL_RERECORD` (mirroring how the backend's own specialist-review flow would do this — no mobile UI exists for the specialist side, so this step uses direct DB manipulation, consistent with how sample-result's decision-flagging was tested end-to-end in the previous sub-project).
9. As the patient: `POST .../sample-session/rerecord` with a fresh upload for the damaged part only, confirm the part updates and the cycle returns to `WAITING_FOR_SPECIALIST`.

**Part B — mobile UI walkthrough (do this if a real device/simulator or a browser with working microphone access is available; otherwise, skip and note it as not verifiable in this environment, same as the "Chrome unreachable" precedent from the previous sub-project):**
1. Log in as the patient in the mobile app.
2. Confirm My Program shows "سجّل عينتك" once the seeded cycle reaches `SAMPLE_ELIGIBLE`.
3. Tap through the recording wizard: record 2 attempts, verify playback works, delete one and re-record it, assign attempts to both required parts, fill in the 4 self-report scores, submit.
4. Confirm the cycle now shows the "waiting for your therapist" message on Home.
5. After manually flagging a part as damaged (Step 8 of Part A), confirm Home now shows "أعد تسجيل الأجزاء المطلوبة", and that tapping it shows only the damaged part, lets you re-record it, and submitting returns you to Home.

This step has no automated pass/fail for Part B specifically — its purpose is to catch anything the component-test mocks might have papered over (e.g., a real `expo-audio` API mismatch that only surfaces at runtime, a real file-upload failure). Report what you saw; if anything looks wrong, fix it in the relevant earlier task's files and re-run that task's own test file before continuing.

- [ ] **Step 5: Commit (only if Step 4 required fixes)**

If Step 4 surfaced no issues, there is nothing to commit for this task. If it did, commit the fix with a message describing what the manual walkthrough caught that the automated tests didn't.

---

## Self-Review Notes

**Spec coverage**: every in-scope item from `docs/superpowers/specs/2026-07-10-mobile-sample-recording-design.md` has a task — the upload endpoint (Task 1), the `apiRequest` multipart extension + all 7 sample API functions + the `TrainingCycle.speechSample` type fix (Task 2), `AudioRecorder`/`AudioPlayer` (Tasks 3-4), the 3-step recording wizard (Task 5), the damaged-part re-record screen (Task 6), and the Home integration (Task 7). The spec's key decisions (self-hosted upload, 3-minute cap, pool-then-assign UX, bundled scope, wizard-in-one-screen structure, `expo-audio` over `expo-av`) are each reflected in the task that implements them, with the reasoning restated so an implementer who only reads their own task brief still understands *why*.

**Placeholder scan**: no task contains "TBD"/"TODO"/"add error handling"/"similar to Task N" — every step has complete, copy-pasteable code, and every test asserts real behavior (specific Arabic strings, specific function-call arguments and shapes), not `expect(true).toBe(true)`-style stand-ins.

**Type consistency, checked across tasks**: `SampleSession`, `SampleAttempt`, `SubmitSamplePart`, `SubmitSampleInput`, `RerecordPartInput` are all defined once (Task 2) and reused by name in every later task that touches them — Task 5 imports `SampleAttempt`/`LevelVersion` from Task 2's file rather than redefining them; Task 6 imports `SampleSamplePart` (already existing from sub-project 2) the same way. `usePatientProfile()`'s return shape is consumed identically in Tasks 5-7, matching prior sub-project's established convention. `TrainingCycle.speechSample` (added in Task 2) is consumed only by Task 6, exactly as scoped.

**A note on test-file placement for the API layer**: following this codebase's own established convention (`api/auth.ts`/`api/treatmentEngine.ts`'s existing exports have no dedicated test files; their behavior is verified through the screens/components that mock them), Task 2's 7 new sample functions get no dedicated unit tests — they are thin typed wrappers around `apiRequest`, and their correct usage (right path, right method, right body shape) is verified by Tasks 5-6's screen tests, which assert on the exact arguments those mocked functions were called with. The one exception is `apiRequest` itself gaining genuinely new capability (multipart support) — that gets a dedicated test in Task 2, since it's non-trivial framework-level behavior, not a thin wrapper.

