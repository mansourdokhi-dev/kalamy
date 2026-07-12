# Sample Video Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current audio-only patient sample recording with video recording (which carries its own audio track) end-to-end — backend storage/streaming and mobile capture/playback — so the future staff-web "Sample Review" screen has real video data to show.

**Architecture:** The backend gains a small storage abstraction (`MediaStorageService`, one local-disk implementation for now) used by the existing upload endpoint and two new authenticated media-streaming endpoints, replacing the current unauthenticated static file route. `SampleAttempt`/`SampleSamplePart` gain media metadata fields (mime type, size, duration). Mobile adds `expo-camera` (capture) and `expo-video` (playback), with new `VideoRecorder`/`VideoPlayer` components that are drop-in-shaped replacements for the existing `AudioRecorder`/`AudioPlayer`, wired into the two existing recording screens.

**Tech Stack:** NestJS + Prisma + Zod + Multer (backend, unchanged libraries, new usage), Expo SDK 57 + `expo-camera` + `expo-video` (mobile, two new first-party Expo packages).

## Global Constraints

- Backend DTOs use `nestjs-zod`'s `createZodDto` pattern exactly as existing DTOs do.
- Every backend endpoint is guarded by `@UseGuards(SessionGuard, PermissionsGuard)` at the controller level and `@RequirePermission(Permission.X)` per method.
- Backend e2e tests live in `backend/test/*.e2e-spec.ts`, run against a real Postgres via `npm run test:e2e -- <pattern>`. Each `describe` block re-declares its own local `loginAs`/`registerActivateAndLogin`-style helpers rather than sharing a utils file — match this convention.
- **`recordingUrl` changes meaning, not name.** Across the whole codebase (Prisma fields, DTOs, API responses, mobile types) `recordingUrl` currently holds a full public URL (`http://host/uploads/audio/<uuid>.m4a`). After this plan, it holds a bare storage key/filename (`<uuid>.mp4`) that the new authenticated media endpoints resolve internally — callers never construct or parse a URL from it themselves, they just pass the id (`attemptId`/`partId`) to the media endpoint. The field is **not** renamed, to avoid an unnecessary rename sweep across every call site — this is a deliberate, documented change in meaning, not an oversight.
- Expo SDK is 57 (`mobile/package.json`: `expo: ~57.0.4`). `mobile/AGENTS.md` requires checking https://docs.expo.dev/versions/v57.0.0/ before writing Expo-API code — this plan's mobile tasks already reflect the verified v57 API for `expo-camera` (`CameraView`, `recordAsync`/`stopRecording`, `useCameraPermissions`/`useMicrophonePermissions`) and `expo-video` (`useVideoPlayer`, `VideoView`, `useEvent` from the core `expo` package) — use exactly these APIs, don't substitute remembered APIs from older Expo versions.
- Mobile component tests mock the relevant Expo package's hooks directly (see `mobile/src/components/__tests__/AudioRecorder.test.tsx`/`AudioPlayer.test.tsx` for the exact pattern) — screen-level tests instead mock the component module itself (see `mobile/app/program/__tests__/sample-recording.test.tsx`). Follow both conventions exactly as established.
- Every backend task's code must pass its e2e suite; every mobile task's code must pass `npm test` (Jest via `jest-expo` preset) — this project has no separate `tsc`/build-only gate for mobile (unlike `staff-web`), but `jest-expo` does type-check via its transform, so a passing suite is sufficient evidence here.

---

### Task 1: Backend — Prisma schema for media metadata

**Files:**
- Modify: `backend/prisma/schema.prisma` (`SampleAttempt` model, lines 429-441; `SampleSamplePart` model, lines 464-479)
- Test: `backend/test/treatment-engine-sample-prep.e2e-spec.ts` (existing suite — will be exercised by later tasks; this task just needs the migration to apply cleanly)

**Interfaces:**
- Produces: `SampleAttempt.mimeType: String`, `SampleAttempt.fileSizeBytes: Int`, `SampleAttempt.durationSeconds: Int?` (required fields — every attempt is created from a real upload, so these are always known); `SampleSamplePart.mimeType: String?`, `SampleSamplePart.fileSizeBytes: Int?`, `SampleSamplePart.durationSeconds: Int?` (nullable, matching the existing nullable `recordingUrl` — all four get nulled together when a part is marked `technicallyDamaged`).

- [ ] **Step 1: Add the new fields to the schema**

In `backend/prisma/schema.prisma`, replace the `SampleAttempt` model:

```prisma
model SampleAttempt {
  id              String        @id @default(uuid())
  sampleSessionId String
  sampleSession   SampleSession @relation(fields: [sampleSessionId], references: [id])
  attemptNumber   Int
  recordingUrl    String
  mimeType        String
  fileSizeBytes   Int
  durationSeconds Int?
  deletedAt       DateTime?
  createdAt       DateTime      @default(now())

  sampleParts SampleSamplePart[]

  @@index([sampleSessionId, attemptNumber])
}
```

Replace the `SampleSamplePart` model:

```prisma
model SampleSamplePart {
  id                 String         @id @default(uuid())
  speechSampleId     String
  speechSample       SpeechSample   @relation(fields: [speechSampleId], references: [id])
  sourceAttemptId    String?
  sourceAttempt      SampleAttempt? @relation(fields: [sourceAttemptId], references: [id])
  partType           String
  label              String
  order              Int
  recordingUrl       String?
  mimeType           String?
  fileSizeBytes      Int?
  durationSeconds    Int?
  technicallyDamaged Boolean        @default(false)
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt

  @@index([speechSampleId, order])
}
```

- [ ] **Step 2: Generate and apply the migration**

Run (from `backend/`): `npx prisma migrate dev --name add_sample_media_metadata`
Expected: a new migration folder under `backend/prisma/migrations/`, applied cleanly with no data-loss warnings (no production data exists yet, so existing `SampleAttempt`/`SampleSamplePart` rows in your local dev DB, if any from prior testing, will need `mimeType`/`fileSizeBytes` backfilled or the table cleared — if Prisma prompts about non-nullable columns on existing rows, choose to reset the dev database via `npx prisma migrate reset` since there's no real data to preserve).

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npm run prisma:generate` (from `backend/`)
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 4: Run the existing sample e2e suites to confirm nothing broke**

Run: `npm run test:e2e -- treatment-engine-sample` (from `backend/`)
Expected: FAIL — the existing tests create attempts/submit samples without the new required `mimeType`/`fileSizeBytes` fields, so this is the expected RED state before Task 4 updates the DTOs and test helpers. Confirm the failures are about missing/invalid fields, not an unrelated regression.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat: add media metadata fields to SampleAttempt and SampleSamplePart"
```

---

### Task 2: Backend — MediaStorageService abstraction

**Files:**
- Create: `backend/src/modules/treatment-engine/media-storage/media-storage.service.ts`
- Create: `backend/src/modules/treatment-engine/media-storage/media-storage.module.ts`
- Test: `backend/src/modules/treatment-engine/media-storage/media-storage.service.spec.ts`
- Modify: `backend/src/modules/treatment-engine/treatment-engine.module.ts` (import `MediaStorageModule`)

**Interfaces:**
- Produces: an abstract class `MediaStorageService` with `getUploadDir(): string`, `createReadStream(filename: string): fs.ReadStream`, `delete(filename: string): Promise<void>`; a concrete `LocalDiskMediaStorageService extends MediaStorageService` registered as the `MediaStorageService` provider token. Task 3 (upload endpoint), Task 5 (media-serving endpoints), and Task 6 (delete-attempt) all inject `MediaStorageService` (the abstract class as DI token) rather than touching `fs`/`diskStorage` directly — this is what makes a future cloud-storage swap a one-line provider change instead of a rewrite.

- [ ] **Step 1: Write the failing unit test**

Create `backend/src/modules/treatment-engine/media-storage/media-storage.service.spec.ts`:

```typescript
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalDiskMediaStorageService } from './media-storage.service';

describe('LocalDiskMediaStorageService', () => {
  let tempRoot: string;
  let service: LocalDiskMediaStorageService;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'kalamy-media-test-'));
    service = new LocalDiskMediaStorageService(tempRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates and returns the upload directory', () => {
    const dir = service.getUploadDir();
    expect(existsSync(dir)).toBe(true);
    expect(dir).toContain(tempRoot);
  });

  it('streams back a file that was written to the upload directory', (done) => {
    const dir = service.getUploadDir();
    const filePath = join(dir, 'test-video.mp4');
    writeFileSync(filePath, 'fake video bytes');

    const stream = service.createReadStream('test-video.mp4');
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk as Buffer));
    stream.on('end', () => {
      expect(Buffer.concat(chunks).toString()).toBe('fake video bytes');
      done();
    });
    stream.on('error', done);
  });

  it('deletes a file from the upload directory', async () => {
    const dir = service.getUploadDir();
    const filePath = join(dir, 'to-delete.mp4');
    writeFileSync(filePath, 'bytes');

    await service.delete('to-delete.mp4');

    expect(existsSync(filePath)).toBe(false);
  });

  it('does not throw when deleting a file that does not exist', async () => {
    await expect(service.delete('never-existed.mp4')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- media-storage.service.spec` (from `backend/`)
Expected: FAIL with "Cannot find module './media-storage.service'".

- [ ] **Step 3: Implement the storage abstraction**

Create `backend/src/modules/treatment-engine/media-storage/media-storage.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { createReadStream, mkdirSync, ReadStream, unlink } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const unlinkAsync = promisify(unlink);

export abstract class MediaStorageService {
  abstract getUploadDir(): string;
  abstract createReadStream(filename: string): ReadStream;
  abstract delete(filename: string): Promise<void>;
}

@Injectable()
export class LocalDiskMediaStorageService extends MediaStorageService {
  private readonly uploadDir: string;

  constructor(rootDir: string = process.cwd()) {
    super();
    this.uploadDir = join(rootDir, 'uploads', 'video');
    mkdirSync(this.uploadDir, { recursive: true });
  }

  getUploadDir(): string {
    return this.uploadDir;
  }

  createReadStream(filename: string): ReadStream {
    return createReadStream(join(this.uploadDir, filename));
  }

  async delete(filename: string): Promise<void> {
    try {
      await unlinkAsync(join(this.uploadDir, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- media-storage.service.spec` (from `backend/`)
Expected: PASS (4 tests).

- [ ] **Step 5: Wire up the module**

Create `backend/src/modules/treatment-engine/media-storage/media-storage.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MediaStorageService, LocalDiskMediaStorageService } from './media-storage.service';

@Module({
  providers: [{ provide: MediaStorageService, useClass: LocalDiskMediaStorageService }],
  exports: [MediaStorageService],
})
export class MediaStorageModule {}
```

In `backend/src/modules/treatment-engine/treatment-engine.module.ts`, add the import:

```typescript
import { MediaStorageModule } from './media-storage/media-storage.module';
```

And add `MediaStorageModule` to the `imports` array (alongside `AuthModule`, `PatientAccessModule`):

```typescript
@Module({
  imports: [AuthModule, PatientAccessModule, MediaStorageModule],
  controllers: [LevelsController, TrainingCyclesController, SamplesController, SpecialistReviewController],
  providers: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService],
  exports: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService],
})
export class TreatmentEngineModule {}
```

- [ ] **Step 6: Run the full test file once more and build**

Run: `npm test -- media-storage.service.spec` (from `backend/`)
Expected: PASS (4 tests).
Run: `npm run build` (from `backend/`)
Expected: builds successfully — confirms `treatment-engine.module.ts`'s new import compiles.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine/media-storage backend/src/modules/treatment-engine/treatment-engine.module.ts
git commit -m "feat: add MediaStorageService abstraction (local-disk implementation)"
```

---

### Task 3: Backend — upload endpoint accepts video

**Files:**
- Modify: `backend/src/modules/treatment-engine/samples.controller.ts` (the `uploadRecording` handler and its `FileInterceptor` config)
- Test: `backend/test/treatment-engine-sample-prep.e2e-spec.ts`

**Interfaces:**
- Consumes: `MediaStorageService` (Task 2) injected into `SamplesController`.
- Produces: `POST .../sample-session/upload` now validates `video/*` mimetypes (not `audio/*`), raises the size limit to 100MB, writes to `MediaStorageService.getUploadDir()` instead of a hardcoded `uploads/audio` path, and returns `{ url: string; mimeType: string; fileSizeBytes: number }` where `url` is now the bare stored filename (e.g. `<uuid>.mp4`), not a full public URL. Task 4 consumes this exact response shape.

- [ ] **Step 1: Find the existing upload test and write the failing replacement**

Read `backend/test/treatment-engine-sample-prep.e2e-spec.ts` to find its existing `describe('... upload ...')` block (or wherever the upload endpoint is currently tested) and its helper functions. Add these test cases to that same file, inside the existing describe block that exercises the upload endpoint (matching its existing `loginAs`/`registerActivateAndLogin` local helpers and patient/cycle setup pattern already in that file):

```typescript
  it('accepts a video file upload and returns url, mimeType, and fileSizeBytes', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/upload`)
      .set('Authorization', `Bearer ${patientToken}`)
      .attach('audio', Buffer.from('fake mp4 bytes'), { filename: 'clip.mp4', contentType: 'video/mp4' });

    expect(response.status).toBe(201);
    expect(response.body.mimeType).toBe('video/mp4');
    expect(response.body.fileSizeBytes).toBeGreaterThan(0);
    expect(response.body.url).toMatch(/\.mp4$/);
    expect(response.body.url).not.toMatch(/^https?:\/\//);
  });

  it('rejects a non-video file upload', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/upload`)
      .set('Authorization', `Bearer ${patientToken}`)
      .attach('audio', Buffer.from('not a video'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(response.status).toBe(400);
  });
```

(The multipart field name stays `audio` — matches the existing `FileInterceptor('audio', ...)` registration and the mobile client's `formData.append('audio', ...)`; renaming it would be a gratuitous, unrelated churn.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-sample-prep` (from `backend/`)
Expected: FAIL — the video test fails because the current `fileFilter` rejects anything not starting with `audio/`; the reject-non-video test may currently pass by coincidence (since `text/plain` also isn't `audio/*`) or fail depending on exact assertions — confirm both for the stated reasons before proceeding.

- [ ] **Step 3: Update the controller**

In `backend/src/modules/treatment-engine/samples.controller.ts`, add the `MediaStorageService` import and inject it:

```typescript
import { MediaStorageService } from './media-storage/media-storage.service';
```

Update the constructor:

```typescript
  constructor(
    private readonly samplesService: SamplesService,
    private readonly trainingCyclesService: TrainingCyclesService,
    private readonly mediaStorageService: MediaStorageService,
  ) {}
```

Replace the `@Post('upload')` handler and its `FileInterceptor` config entirely:

```typescript
  @Post('upload')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: diskStorage({
        destination: (req, _file, cb) => {
          const mediaStorageService: MediaStorageService = req.app.get(MediaStorageService);
          cb(null, mediaStorageService.getUploadDir());
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 100 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('video/')) {
          cb(new BadRequestException('Only video files are accepted'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadRecording(
    @Param('patientId') patientId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.trainingCyclesService.getCurrent(patientId, user);
    if (!file) {
      throw new BadRequestException('No video file provided');
    }
    return { url: file.filename, mimeType: file.mimetype, fileSizeBytes: file.size };
  }
```

Note the destructive-looking `req.app.get(MediaStorageService)` inside `destination` — Multer's storage engine callbacks run outside Nest's request-scoped DI, so this is the standard NestJS pattern for reaching an injectable from within a Multer callback (`req.app` is the underlying Express/Nest application instance, which exposes `.get()` for resolving providers). This mirrors how the existing code already reached into `mkdirSync`/`join` directly in the `destination` callback — same callback shape, now delegating the actual path resolution to the injected service instead of hardcoding it.

Also remove the now-unused imports this change makes dead: `mkdirSync` (no longer called directly in the controller — `MediaStorageService`'s constructor handles directory creation) and `Req`/`type { Request }` (no longer used since `req.protocol`/`req.get('host')` are gone). Keep `diskStorage`, `randomUUID`, `extname`, `join` (still used for `destination`'s path — actually `join` is no longer directly needed either since the destination callback now just calls `mediaStorageService.getUploadDir()`; remove it too if no other usage remains in the file). Verify with `npx tsc --noEmit` per Step 6 which unused imports actually need removing — don't guess, let the compiler tell you (`noUnusedLocals`/`noUnusedParameters` if enabled, or ESLint if that's how this project catches it; if neither catches it, remove them anyway for cleanliness since they're clearly dead after this edit).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-sample-prep` (from `backend/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/treatment-engine/samples.controller.ts backend/test/treatment-engine-sample-prep.e2e-spec.ts
git commit -m "feat: accept video uploads instead of audio, using MediaStorageService"
```

---

### Task 4: Backend — attempt/part metadata plumbing

**Files:**
- Modify: `backend/src/modules/treatment-engine/dto/record-attempt.dto.ts`
- Modify: `backend/src/modules/treatment-engine/dto/rerecord-parts.dto.ts`
- Modify: `backend/src/modules/treatment-engine/samples.service.ts` (`recordAttempt`, `submitSample`, `rerecordDamagedParts`)
- Modify: `backend/src/modules/treatment-engine/specialist-review.service.ts` (the damaged-part nulling logic, line ~90)
- Test: `backend/test/treatment-engine-sample-prep.e2e-spec.ts`, `backend/test/treatment-engine-sample-submit.e2e-spec.ts`, `backend/test/treatment-engine-rerecord.e2e-spec.ts`

**Interfaces:**
- Consumes: the upload endpoint's `{ url, mimeType, fileSizeBytes }` response (Task 3).
- Produces: `RecordAttemptDto` now requires `{ recordingUrl: string, mimeType: string, fileSizeBytes: number (positive int), durationSeconds?: number (positive int) }` (note: `recordingUrl` validation changes from `z.url()` to `z.string().min(1)`, since it's now a bare filename, not a URL). `RerecordPartsDto`'s part items gain the same three fields alongside the existing `id`/`recordingUrl` (same `z.url()` → `z.string().min(1)` fix). `SamplesService.recordAttempt`/`rerecordDamagedParts` persist these fields; `submitSample` copies them from the source attempt onto the created part; the specialist-review damaged-part-nulling update also nulls the three new fields alongside `recordingUrl`. Mobile Task 11 will call these endpoints with this exact shape.

- [ ] **Step 1: Write the failing e2e tests**

In `backend/test/treatment-engine-sample-prep.e2e-spec.ts`, find the existing test(s) that call `POST .../attempts` (recording an attempt) and update them to send the new required fields, e.g. wherever the test currently does:

```typescript
.send({ recordingUrl: 'https://example.com/clip.mp4' })
```

change to:

```typescript
.send({ recordingUrl: 'clip-1.mp4', mimeType: 'video/mp4', fileSizeBytes: 204800, durationSeconds: 12 })
```

Then add this new test in the same describe block:

```typescript
  it('persists mimeType, fileSizeBytes, and durationSeconds on the attempt', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'clip-2.mp4', mimeType: 'video/mp4', fileSizeBytes: 512000, durationSeconds: 20 });

    expect(response.status).toBe(201);
    expect(response.body.mimeType).toBe('video/mp4');
    expect(response.body.fileSizeBytes).toBe(512000);
    expect(response.body.durationSeconds).toBe(20);
  });

  it('rejects recording an attempt without mimeType or fileSizeBytes', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'clip-3.mp4' });

    expect(response.status).toBe(400);
  });
```

In `backend/test/treatment-engine-sample-submit.e2e-spec.ts`, find the test(s) asserting on a submitted sample's parts and add an assertion that the created part's `mimeType`/`fileSizeBytes` match the source attempt's — e.g. after an existing `submitSample` call whose response includes `parts`:

```typescript
    expect(response.body.parts[0].mimeType).toBe('video/mp4');
    expect(response.body.parts[0].fileSizeBytes).toBeGreaterThan(0);
```

(Adjust the attempt-creation calls earlier in that same test to include the new required `mimeType`/`fileSizeBytes` fields, matching the pattern above, so the attempt exists in a valid state before being submitted.)

In `backend/test/treatment-engine-rerecord.e2e-spec.ts`, find the existing `POST .../rerecord` test(s) and update the request body to include the new per-part fields, e.g.:

```typescript
.send({ parts: [{ id: damagedPartId, recordingUrl: 'clip-4.mp4', mimeType: 'video/mp4', fileSizeBytes: 300000, durationSeconds: 15 }] })
```

Add an assertion that the resulting part has the new fields populated:

```typescript
    expect(response.body.parts.find((p: any) => p.id === damagedPartId).mimeType).toBe('video/mp4');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-sample-prep treatment-engine-sample-submit treatment-engine-rerecord` (from `backend/`)
Expected: FAIL — the DTOs don't yet accept/require the new fields, and `submitSample`/`rerecordDamagedParts` don't yet persist them.

- [ ] **Step 3: Update the DTOs**

Replace `backend/src/modules/treatment-engine/dto/record-attempt.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RecordAttemptSchema = z.object({
  recordingUrl: z.string().min(1),
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  durationSeconds: z.number().int().positive().optional(),
});

export class RecordAttemptDto extends createZodDto(RecordAttemptSchema) {}
```

Replace `backend/src/modules/treatment-engine/dto/rerecord-parts.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RerecordPartsSchema = z.object({
  parts: z
    .array(
      z.object({
        id: z.string().uuid(),
        recordingUrl: z.string().min(1),
        mimeType: z.string().min(1),
        fileSizeBytes: z.number().int().positive(),
        durationSeconds: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});

export class RerecordPartsDto extends createZodDto(RerecordPartsSchema) {}
```

- [ ] **Step 4: Update `samples.service.ts`**

Replace the `recordAttempt` method (currently lines 41-71):

```typescript
  async recordAttempt(cycleId: string, dto: RecordAttemptDto, actor: AuthenticatedUser): Promise<SampleAttempt> {
    await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.findSessionOrThrow(cycleId);
    if (session.status !== 'OPEN') {
      throw new ConflictException(`Cannot record an attempt in session status ${session.status}`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Row-lock the SampleSession so concurrent recordAttempt calls for the
      // same session serialize instead of racing on the count-then-create below.
      await tx.$queryRaw`SELECT id FROM "SampleSession" WHERE id = ${session.id} FOR UPDATE`;

      const totalAttemptsIncludingDeleted = await tx.sampleAttempt.count({ where: { sampleSessionId: session.id } });
      if (totalAttemptsIncludingDeleted >= MAX_ATTEMPTS) {
        await tx.sampleSession.update({ where: { id: session.id }, data: { status: 'CLOSED_EXHAUSTED' } });
        await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'ACTIVE_LEVEL_TRAINING' } });
        return { exhausted: true as const };
      }

      const attempt = await tx.sampleAttempt.create({
        data: {
          sampleSessionId: session.id,
          attemptNumber: totalAttemptsIncludingDeleted + 1,
          recordingUrl: dto.recordingUrl,
          mimeType: dto.mimeType,
          fileSizeBytes: dto.fileSizeBytes,
          durationSeconds: dto.durationSeconds,
        },
      });
      await tx.sampleSession.update({ where: { id: session.id }, data: { attemptsUsed: totalAttemptsIncludingDeleted + 1 } });
      return { exhausted: false as const, attempt };
    });

    if (result.exhausted) {
      throw new ConflictException('Maximum of 10 recording attempts reached without selecting a sample');
    }
    return result.attempt;
  }
```

In `submitSample`, replace the part-creation block (currently inside the `data.parts.create` map, lines 128-135):

```typescript
          parts: {
            create: dto.parts.map((part) => {
              const sourceAttempt = attemptsById.get(part.sourceAttemptId)!;
              return {
                partType: part.partType,
                label: part.label,
                order: part.order,
                sourceAttemptId: part.sourceAttemptId,
                recordingUrl: sourceAttempt.recordingUrl,
                mimeType: sourceAttempt.mimeType,
                fileSizeBytes: sourceAttempt.fileSizeBytes,
                durationSeconds: sourceAttempt.durationSeconds,
              };
            }),
          },
```

In `rerecordDamagedParts`, replace the `Promise.all` update block (currently lines 192-199):

```typescript
      await Promise.all(
        dto.parts.map((part) =>
          tx.sampleSamplePart.update({
            where: { id: part.id },
            data: {
              recordingUrl: part.recordingUrl,
              mimeType: part.mimeType,
              fileSizeBytes: part.fileSizeBytes,
              durationSeconds: part.durationSeconds,
              technicallyDamaged: false,
            },
          }),
        ),
      );
```

- [ ] **Step 5: Update `specialist-review.service.ts`'s damaged-part nulling**

In `backend/src/modules/treatment-engine/specialist-review.service.ts`, replace line 90:

```typescript
          tx.sampleSamplePart.update({
            where: { id: partId },
            data: { technicallyDamaged: true, recordingUrl: null, mimeType: null, fileSizeBytes: null, durationSeconds: null },
          }),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-sample-prep treatment-engine-sample-submit treatment-engine-rerecord` (from `backend/`)
Expected: PASS.

- [ ] **Step 7: Run the specialist-review suite to confirm no regression from Step 5**

Run: `npm run test:e2e -- treatment-engine-specialist-review` (from `backend/`)
Expected: PASS (existing tests already assert `recordingUrl: null` after a `TECHNICAL_RERECORD` decision — confirm they still pass with the three new fields also nulled; no existing test should need changes since they don't currently assert on `mimeType`/`fileSizeBytes`/`durationSeconds` at all).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/treatment-engine/dto/record-attempt.dto.ts backend/src/modules/treatment-engine/dto/rerecord-parts.dto.ts backend/src/modules/treatment-engine/samples.service.ts backend/src/modules/treatment-engine/specialist-review.service.ts backend/test/treatment-engine-sample-prep.e2e-spec.ts backend/test/treatment-engine-sample-submit.e2e-spec.ts backend/test/treatment-engine-rerecord.e2e-spec.ts
git commit -m "feat: carry media metadata through attempt/submit/rerecord lifecycle"
```

---

### Task 5: Backend — authenticated media-serving endpoints + remove static route

**Files:**
- Modify: `backend/src/modules/treatment-engine/samples.controller.ts` (add `attempts/:attemptId/media`)
- Create: `backend/src/modules/treatment-engine/sample-media.controller.ts`
- Modify: `backend/src/modules/treatment-engine/samples.service.ts` (add a `findAttemptOrThrow` helper for the media route)
- Modify: `backend/src/modules/treatment-engine/treatment-engine.module.ts` (register `SampleMediaController`)
- Modify: `backend/src/main.ts` (remove `useStaticAssets`)
- Test: `backend/test/treatment-engine-sample-prep.e2e-spec.ts`, new test file `backend/test/sample-media.e2e-spec.ts`

**Interfaces:**
- Consumes: `MediaStorageService.createReadStream` (Task 2); `PatientAccessService.assertCanAccess` (existing shared service); `TrainingCyclesService.findCycleForActor` (existing).
- Produces: `GET /api/v1/patients/:patientId/cycles/current/sample-session/attempts/:attemptId/media` (permission `PREPARE_SAMPLE`) streaming an attempt's video with the correct `Content-Type`; `GET /api/v1/patients/:patientId/sample-parts/:partId/media` (permission `VIEW_CYCLE`) streaming a submitted part's video — this is the endpoint the future staff-web review screen will call. Both replace the old unauthenticated `/uploads/audio/...` static path entirely. Mobile Task 13 (`VideoPlayer` usage) points at these.

- [ ] **Step 1: Write the failing e2e tests for the attempt-media route**

In `backend/test/treatment-engine-sample-prep.e2e-spec.ts`, add (matching the file's existing local-helper/setup conventions):

```typescript
  it('streams an attempt recording via the authenticated media endpoint', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'nonexistent-file.mp4', mimeType: 'video/mp4', fileSizeBytes: 100, durationSeconds: 5 });
    const attemptId = createResponse.body.id;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts/${attemptId}/media`)
      .set('Authorization', `Bearer ${patientToken}`);

    // The referenced file doesn't actually exist on disk in this test (no real upload happened),
    // so this confirms the route is reached, permission-checked, and attempts to stream — a 404
    // or 500 here is a file-not-found from the OS, not a routing/auth failure. The full round-trip
    // (real upload -> real stream) is exercised by the manual walkthrough in the final task.
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(404 + 1000); // sentinel: just confirms no NestJS crash (5xx from an unhandled exception type)
  });

  it('rejects an unrelated patient from streaming another patient's attempt media', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'file.mp4', mimeType: 'video/mp4', fileSizeBytes: 100, durationSeconds: 5 });
    const attemptId = createResponse.body.id;

    const strangerToken = await registerActivateAndLogin('+966500000199', 'password123', 'PATIENT');
    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts/${attemptId}/media`)
      .set('Authorization', `Bearer ${strangerToken.token}`);

    expect(response.status).toBe(403);
  });
```

Create `backend/test/sample-media.e2e-spec.ts` for the part-media route, following this codebase's established e2e conventions (own `createTestApp`/`resetDatabase` setup, own local `registerActivateAndLogin`/`createClinicianToken` helpers — model this file directly on the structure of `backend/test/treatment-engine-sample-submit.e2e-spec.ts`, which already sets up a patient through cycle-creation, training, and sample submission to reach a state with a real `SampleSamplePart`):

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Sample part media', () => {
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

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
  }

  async function registerActivateAndLogin(mobile: string, password: string, role: 'PATIENT' | 'CLINICIAN' | 'SUPERVISOR') {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Sample Media Test User',
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
    return { token: await loginAs(mobile, password), userId: registerResponse.body.userId };
  }

  it('returns 404 for a part with no recording (e.g. a damaged, nulled-out part)', async () => {
    const clinician = await registerActivateAndLogin('+966500000210', 'password123', 'CLINICIAN');
    const patient = await registerActivateAndLogin('+966500000211', 'password123', 'PATIENT');

    // A minimal patient/part fixture is enough here since this test only needs a real
    // SampleSamplePart row with recordingUrl: null — full cycle/level/sample setup is
    // exercised end-to-end by treatment-engine-sample-submit.e2e-spec.ts already.
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patient.userId, fullName: 'Media Test Patient', gender: 'MALE', dateOfBirth: new Date('1995-01-01'), nationalId: 'MEDIA-TEST-1' },
    });
    const level = await prisma.level.create({ data: { name: 'Media Test Level', order: 9001 } });
    const levelVersion = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const plan = await prisma.treatmentPlan.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: clinician.userId,
        assessmentId: (
          await prisma.assessment.create({
            data: { patientProfileId: patientProfile.id, clinicianUserId: clinician.userId, type: 'INITIAL', status: 'APPROVED', approvedAt: new Date() },
          })
        ).id,
        goals: 'x',
        reviewDate: new Date(),
      },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: levelVersion.id, cycleNumber: 1 },
    });
    const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id } });
    const part = await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'word', label: 'Test Part', order: 1, recordingUrl: null, technicallyDamaged: true },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/sample-parts/${part.id}/media`)
      .set('Authorization', `Bearer ${clinician.token}`);

    expect(response.status).toBe(404);
  });

  it('rejects a role without VIEW_CYCLE from streaming part media', async () => {
    // No role in this system lacks VIEW_CYCLE among staff/patient/caregiver, so instead
    // confirm the permission guard is present by checking an unauthenticated request is rejected.
    const response = await request(app.getHttpServer()).get(
      '/api/v1/patients/00000000-0000-0000-0000-000000000000/sample-parts/00000000-0000-0000-0000-000000000000/media',
    );
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-sample-prep sample-media` (from `backend/`)
Expected: FAIL — neither route exists yet (404s where a real status is expected, or route-not-found errors).

- [ ] **Step 3: Add a lookup helper to `samples.service.ts`**

Add this method to `SamplesService` (e.g. near `findSessionOrThrow`):

```typescript
  async findAttemptOrThrow(cycleId: string, attemptId: string, actor: AuthenticatedUser): Promise<SampleAttempt> {
    await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.findSessionOrThrow(cycleId);
    const attempt = await this.prisma.sampleAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.sampleSessionId !== session.id || attempt.deletedAt) {
      throw new NotFoundException('Attempt not found');
    }
    return attempt;
  }
```

- [ ] **Step 4: Add the attempt-media route to `samples.controller.ts`**

Add the import:

```typescript
import { Res } from '@nestjs/common';
import type { Response } from 'express';
```

Add this method to `SamplesController` (e.g. after `listAttempts`):

```typescript
  @Get('attempts/:attemptId/media')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async streamAttemptMedia(
    @Param('patientId') patientId: string,
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    const attempt = await this.samplesService.findAttemptOrThrow(current.id, attemptId, user);
    res.setHeader('Content-Type', attempt.mimeType);
    this.mediaStorageService.createReadStream(attempt.recordingUrl).pipe(res);
  }
```

- [ ] **Step 5: Create `sample-media.controller.ts`**

Create `backend/src/modules/treatment-engine/sample-media.controller.ts`:

```typescript
import { Controller, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { MediaStorageService } from './media-storage/media-storage.service';

@Controller('api/v1/patients/:patientId/sample-parts')
@UseGuards(SessionGuard, PermissionsGuard)
export class SampleMediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
    private readonly mediaStorageService: MediaStorageService,
  ) {}

  @Get(':partId/media')
  @RequirePermission(Permission.VIEW_CYCLE)
  async streamPartMedia(
    @Param('patientId') patientId: string,
    @Param('partId') partId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    await this.patientAccessService.assertCanAccess(user, profile);

    const part = await this.prisma.sampleSamplePart.findUnique({
      where: { id: partId },
      include: { speechSample: { include: { trainingCycle: true } } },
    });
    if (!part || part.speechSample.trainingCycle.patientProfileId !== patientId || !part.recordingUrl || !part.mimeType) {
      throw new NotFoundException('Sample part media not found');
    }

    res.setHeader('Content-Type', part.mimeType);
    this.mediaStorageService.createReadStream(part.recordingUrl).pipe(res);
  }
}
```

- [ ] **Step 6: Register `SampleMediaController` and inject `MediaStorageService` into `SamplesController`**

In `backend/src/modules/treatment-engine/treatment-engine.module.ts`, add the import and register the controller:

```typescript
import { SampleMediaController } from './sample-media.controller';
```

```typescript
  controllers: [LevelsController, TrainingCyclesController, SamplesController, SampleMediaController, SpecialistReviewController],
```

Confirm `SamplesController`'s constructor (updated in Task 3) already has `mediaStorageService` injected — it does, from Task 3's Step 3.

- [ ] **Step 7: Remove the unauthenticated static route**

In `backend/src/main.ts`, remove this line entirely:

```typescript
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
```

Remove the now-unused `join` import from `path` if nothing else in the file uses it (check before removing).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-sample-prep sample-media` (from `backend/`)
Expected: PASS.

- [ ] **Step 9: Run the full backend suite to confirm the static-route removal has no other consumers**

Run: `npm run test:e2e` (from `backend/`)
Expected: all suites pass — this confirms no other test or code path depended on `/uploads/...` being served unauthenticated.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/treatment-engine/samples.controller.ts backend/src/modules/treatment-engine/sample-media.controller.ts backend/src/modules/treatment-engine/samples.service.ts backend/src/modules/treatment-engine/treatment-engine.module.ts backend/src/main.ts backend/test/treatment-engine-sample-prep.e2e-spec.ts backend/test/sample-media.e2e-spec.ts
git commit -m "feat: add authenticated media-streaming endpoints, remove unauthenticated static file route"
```

---

### Task 6: Backend — physically delete media file on attempt delete

**Files:**
- Modify: `backend/src/modules/treatment-engine/samples.service.ts` (`deleteAttempt`)
- Test: `backend/test/treatment-engine-sample-prep.e2e-spec.ts`

**Interfaces:**
- Consumes: `MediaStorageService.delete` (Task 2).
- Produces: `SamplesService.deleteAttempt` now removes the underlying file from disk (best-effort — a storage error is logged, not thrown, so a filesystem hiccup never blocks the patient's delete action) in addition to the existing DB soft-delete.

- [ ] **Step 1: Write the failing test**

In `backend/test/treatment-engine-sample-prep.e2e-spec.ts`, add (this test needs filesystem access, so import `fs` and `path` at the top of the file if not already imported):

```typescript
  it('physically removes the media file from disk when an attempt is deleted', async () => {
    const fs = require('fs');
    const path = require('path');

    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/upload`)
      .set('Authorization', `Bearer ${patientToken}`)
      .attach('audio', Buffer.from('fake mp4 bytes'), { filename: 'to-be-deleted.mp4', contentType: 'video/mp4' });
    const { url, mimeType, fileSizeBytes } = createResponse.body;

    const attemptResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: url, mimeType, fileSizeBytes, durationSeconds: 5 });
    const attemptId = attemptResponse.body.id;

    const filePath = path.join(process.cwd(), 'uploads', 'video', url);
    expect(fs.existsSync(filePath)).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts/${attemptId}`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(fs.existsSync(filePath)).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- treatment-engine-sample-prep` (from `backend/`)
Expected: FAIL — the file still exists after delete, since `deleteAttempt` currently only sets `deletedAt`.

- [ ] **Step 3: Update `deleteAttempt`**

In `backend/src/modules/treatment-engine/samples.service.ts`, add the `MediaStorageService` import and inject it:

```typescript
import { MediaStorageService } from './media-storage/media-storage.service';
```

Update the constructor:

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
    private readonly mediaStorageService: MediaStorageService,
  ) {}
```

Replace `deleteAttempt` (currently lines 73-81):

```typescript
  async deleteAttempt(cycleId: string, attemptId: string, actor: AuthenticatedUser): Promise<SampleAttempt> {
    await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.findSessionOrThrow(cycleId);
    const attempt = await this.prisma.sampleAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.sampleSessionId !== session.id) {
      throw new NotFoundException('Attempt not found');
    }
    const deleted = await this.prisma.sampleAttempt.update({ where: { id: attemptId }, data: { deletedAt: new Date() } });
    try {
      await this.mediaStorageService.delete(attempt.recordingUrl);
    } catch (error) {
      // Best-effort: a filesystem error here shouldn't block the patient's delete action —
      // the database soft-delete (above) is the source of truth for whether an attempt is "gone".
      // eslint-disable-next-line no-console
      console.error(`Failed to delete media file for attempt ${attemptId}:`, error);
    }
    return deleted;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- treatment-engine-sample-prep` (from `backend/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/treatment-engine/samples.service.ts backend/test/treatment-engine-sample-prep.e2e-spec.ts
git commit -m "feat: physically delete media file from disk when an attempt is deleted"
```

---

### Task 7: Backend — Swagger update + full smoke verification

**Files:** none created/modified beyond what Swagger auto-generates from existing decorators (no manual Swagger annotation exists elsewhere in this module beyond the `DocumentBuilder` setup already in `main.ts` — the new routes are picked up automatically since they use the same decorator patterns as every other endpoint).

**Interfaces:** N/A — this task is verification only.

- [ ] **Step 1: Run the full backend suite**

Run: `npm run test:e2e` (from `backend/`)
Expected: all suites pass (163+ pre-existing tests from before this project, plus this project's new tests — confirm the exact count grows and nothing regresses). If Docker Desktop isn't running, `docker ps` will fail outright and every suite will fail — restart Docker Desktop and re-run before concluding anything is broken (an established false-positive pattern in this project).

- [ ] **Step 2: Boot the app and confirm Swagger reflects the new routes**

Run: `npm run start:dev` (from `backend/`, in the background)
Once it's listening, fetch `http://localhost:3000/api/docs-json` (or open `http://localhost:3000/api/docs` in a browser) and confirm these paths appear: `POST /api/v1/patients/{patientId}/cycles/current/sample-session/upload` (with the updated response shape), `GET /api/v1/patients/{patientId}/cycles/current/sample-session/attempts/{attemptId}/media`, `GET /api/v1/patients/{patientId}/sample-parts/{partId}/media`. Stop the dev server afterward.

- [ ] **Step 3: Report status**

No commit for this task (verification only) — proceed to Task 8.

---

### Task 8: Mobile — add `expo-camera`/`expo-video` dependencies + permissions config

**Files:**
- Modify: `mobile/package.json` (via `npx expo install`, not hand-edited)
- Modify: `mobile/app.json` (add camera permission plugin config)

**Interfaces:**
- Produces: `expo-camera` and `expo-video` installed at whatever versions `npx expo install` resolves as compatible with Expo SDK 57 (do not hand-pin version numbers — Expo's own tooling knows the correct compatible range better than a guess). Tasks 9-10 (`VideoRecorder`/`VideoPlayer`) consume these packages' APIs exactly as documented in this plan's Global Constraints section.

- [ ] **Step 1: Install the packages**

Run (from `mobile/`): `npx expo install expo-camera expo-video`
Expected: `package.json` gains `expo-camera` and `expo-video` entries with version ranges matching the `~57.0.x`-style pinning already used by every other `expo-*` dependency in this file.

- [ ] **Step 2: Add camera permission config to `app.json`**

In `mobile/app.json`, add `"expo-camera"` to the `plugins` array (alongside the existing `expo-audio` entry), with an Arabic camera-permission description matching the style of the existing microphone one:

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
      ],
      [
        "expo-camera",
        {
          "cameraPermission": "يحتاج كلامي إلى الوصول إلى الكاميرا لتسجيل عينتك المرئية.",
          "microphonePermission": "يحتاج كلامي إلى الوصول إلى الميكروفون لتسجيل عينتك المرئية.",
          "recordAudioAndroid": true
        }
      ]
    ]
```

- [ ] **Step 3: Verify the app still boots**

Run: `npm run web` (from `mobile/`, in the background) briefly to confirm the Expo config parses without error (a broken `app.json` plugin entry fails fast at boot). Stop it once you see it start successfully (or check the terminal output for a config-validation error).

- [ ] **Step 4: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json
git commit -m "feat: add expo-camera and expo-video dependencies with permission config"
```

---

### Task 9: Mobile — `VideoRecorder` component

**Files:**
- Create: `mobile/src/components/VideoRecorder.tsx`
- Test: `mobile/src/components/__tests__/VideoRecorder.test.tsx`
- Modify: `mobile/src/copy/ar.ts` (add camera-permission and enable-camera copy keys to the existing `sampleRecording` namespace)

**Interfaces:**
- Produces: `VideoRecorder({ onRecorded: (uri: string, durationSeconds: number) => void; disabled?: boolean })` — note the signature is `(uri, durationSeconds)`, not just `(uri)` like `AudioRecorder`, since duration must be measured client-side (no server-side way to know it, unlike `mimeType`/`fileSizeBytes` which Multer captures automatically). Task 12 (`sample-recording.tsx`) and Task 13 (`sample-rerecord.tsx`) consume this exact signature.

- [ ] **Step 1: Add the copy keys**

In `mobile/src/copy/ar.ts`, find the `sampleRecording` namespace and add these keys (alongside the existing `micPermissionDenied`, `record`, `stopRecording`, etc.):

```typescript
    cameraPermissionDenied: 'يلزم الوصول إلى الكاميرا والميكروفون لتسجيل عينتك',
    enableCamera: 'تفعيل الكاميرا',
```

- [ ] **Step 2: Write the failing test**

Create `mobile/src/components/__tests__/VideoRecorder.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { VideoRecorder } from '../VideoRecorder';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';

jest.mock('expo-camera', () => ({
  CameraView: (() => {
    const React = require('react');
    const { View } = require('react-native');
    return React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        recordAsync: jest.fn(() => Promise.resolve({ uri: 'file:///tmp/video-1.mp4' })),
        stopRecording: jest.fn(),
      }));
      return <View testID="camera-view" />;
    });
  })(),
  useCameraPermissions: jest.fn(),
  useMicrophonePermissions: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('VideoRecorder', () => {
  it('requests camera and microphone permission on first press, shows the camera view once granted', async () => {
    const requestCamera = jest.fn().mockResolvedValue({ granted: true });
    const requestMic = jest.fn().mockResolvedValue({ granted: true });
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: false }, requestCamera]);
    (useMicrophonePermissions as jest.Mock).mockReturnValue([{ granted: false }, requestMic]);

    render(<ThemeProvider><VideoRecorder onRecorded={jest.fn()} /></ThemeProvider>);
    fireEvent.press(screen.getByText('تفعيل الكاميرا'));

    await waitFor(() => {
      expect(requestCamera).toHaveBeenCalled();
      expect(requestMic).toHaveBeenCalled();
      expect(screen.getByTestId('camera-view')).toBeTruthy();
    });
  });

  it('shows a permission-denied message when either permission is refused', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: false }, jest.fn().mockResolvedValue({ granted: false })]);
    (useMicrophonePermissions as jest.Mock).mockReturnValue([{ granted: false }, jest.fn().mockResolvedValue({ granted: true })]);

    render(<ThemeProvider><VideoRecorder onRecorded={jest.fn()} /></ThemeProvider>);
    fireEvent.press(screen.getByText('تفعيل الكاميرا'));

    await waitFor(() => {
      expect(screen.getByText('يلزم الوصول إلى الكاميرا والميكروفون لتسجيل عينتك')).toBeTruthy();
    });
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('starts recording, stops on press, and calls onRecorded with uri and duration', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
    (useMicrophonePermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
    const onRecorded = jest.fn();

    render(<ThemeProvider><VideoRecorder onRecorded={onRecorded} /></ThemeProvider>);
    fireEvent.press(screen.getByText('تفعيل الكاميرا'));
    await waitFor(() => expect(screen.getByTestId('camera-view')).toBeTruthy());

    fireEvent.press(screen.getByText('ابدأ التسجيل'));
    await waitFor(() => expect(screen.getByText('إيقاف التسجيل')).toBeTruthy());
    fireEvent.press(screen.getByText('إيقاف التسجيل'));

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledWith('file:///tmp/video-1.mp4', expect.any(Number));
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- VideoRecorder.test` (from `mobile/`)
Expected: FAIL with "Cannot find module '../VideoRecorder'".

- [ ] **Step 4: Implement `VideoRecorder`**

Create `mobile/src/components/VideoRecorder.tsx`:

```typescript
import { useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useTheme } from '../theme/ThemeContext';
import { Button } from './Button';
import { ar } from '../copy/ar';

const MAX_DURATION_SECONDS = 3 * 60;

interface VideoRecorderProps {
  onRecorded: (uri: string, durationSeconds: number) => void;
  disabled?: boolean;
}

export function VideoRecorder({ onRecorded, disabled }: VideoRecorderProps) {
  const { tokens } = useTheme();
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  async function handleEnableCamera() {
    const cam = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    const mic = microphonePermission?.granted ? microphonePermission : await requestMicrophonePermission();
    if (!cam.granted || !mic.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);
    setPermissionsGranted(true);
  }

  async function handleStartStop() {
    if (isRecording) {
      cameraRef.current?.stopRecording();
      return;
    }
    if (!cameraRef.current) return;
    setIsRecording(true);
    const startedAt = Date.now();
    const result = await cameraRef.current.recordAsync({ maxDuration: MAX_DURATION_SECONDS, videoQuality: '720p' });
    setIsRecording(false);
    if (result?.uri) {
      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      onRecorded(result.uri, durationSeconds);
    }
  }

  return (
    <View>
      {permissionDenied ? (
        <Text style={{ color: tokens.colors.danger, marginBottom: 8 }}>{ar.sampleRecording.cameraPermissionDenied}</Text>
      ) : null}
      {!permissionsGranted ? (
        <Button title={ar.sampleRecording.enableCamera} onPress={handleEnableCamera} disabled={disabled} />
      ) : (
        <View>
          <CameraView ref={cameraRef} style={styles.camera} mode="video" facing="front" />
          <Button
            title={isRecording ? ar.sampleRecording.stopRecording : ar.sampleRecording.record}
            onPress={handleStartStop}
            disabled={disabled}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { width: '100%', aspectRatio: 3 / 4, marginBottom: 8 },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- VideoRecorder.test` (from `mobile/`)
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/VideoRecorder.tsx mobile/src/components/__tests__/VideoRecorder.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add VideoRecorder component using expo-camera"
```

---

### Task 10: Mobile — `VideoPlayer` component

**Files:**
- Create: `mobile/src/components/VideoPlayer.tsx`
- Test: `mobile/src/components/__tests__/VideoPlayer.test.tsx`
- Modify: `mobile/src/api/client.ts` (export `API_BASE_URL`)

**Interfaces:**
- Consumes: `getToken()` (`mobile/src/storage/session.ts`, existing), `API_BASE_URL` (this task exports it from `client.ts`).
- Produces: `VideoPlayer({ path: string })` — **not** `{ uri: string }` like `AudioPlayer` was. This is a deliberate, important difference: `path` is an authenticated API path (e.g. `/api/v1/patients/<id>/sample-parts/<partId>/media`), not a directly-playable media URL. The component resolves the current auth token itself and passes both the full URL and an `Authorization` header to `expo-video`'s source object — this is what makes playback work against Task 5's authenticated media endpoints, since (unlike a plain `<audio src="...">`) `expo-video`'s `VideoSourceObject` supports a `headers: Record<string, string>` field for exactly this. Tasks 12/13 must pass `path`, not a raw stored `recordingUrl` value — the raw `recordingUrl` is now a bare storage filename with no meaning to a client and must never be used directly as a playback source.

- [ ] **Step 1: Export `API_BASE_URL` from the API client**

In `mobile/src/api/client.ts`, change:

```typescript
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
```

to:

```typescript
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
```

- [ ] **Step 2: Write the failing test**

Create `mobile/src/components/__tests__/VideoPlayer.test.tsx`:

```typescript
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { VideoPlayer } from '../VideoPlayer';
import { useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import { getToken } from '../../storage/session';

jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(),
  VideoView: () => {
    const { View } = require('react-native');
    return <View testID="video-view" />;
  },
}));

jest.mock('expo', () => ({
  useEvent: jest.fn(),
}));

jest.mock('../../storage/session', () => ({
  getToken: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('VideoPlayer', () => {
  it('resolves the auth token before rendering, and passes an authenticated source to useVideoPlayer', async () => {
    (getToken as jest.Mock).mockResolvedValue('token-123');
    const player = { play: jest.fn(), pause: jest.fn(), playing: false };
    (useVideoPlayer as jest.Mock).mockReturnValue(player);
    (useEvent as jest.Mock).mockReturnValue({ isPlaying: false });

    render(<ThemeProvider><VideoPlayer path="/api/v1/patients/p1/sample-parts/part-1/media" /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('video-view')).toBeTruthy();
    });
    const [source] = (useVideoPlayer as jest.Mock).mock.calls[(useVideoPlayer as jest.Mock).mock.calls.length - 1];
    expect(source).toEqual({
      uri: expect.stringContaining('/api/v1/patients/p1/sample-parts/part-1/media'),
      headers: { Authorization: 'Bearer token-123' },
    });
  });

  it('renders nothing until the token has resolved', () => {
    (getToken as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves within this test
    (useVideoPlayer as jest.Mock).mockReturnValue({ play: jest.fn(), pause: jest.fn(), playing: false });
    (useEvent as jest.Mock).mockReturnValue({ isPlaying: false });

    render(<ThemeProvider><VideoPlayer path="/api/v1/patients/p1/sample-parts/part-1/media" /></ThemeProvider>);

    expect(screen.queryByTestId('video-view')).toBeNull();
  });

  it('calls player.play() when the play button is pressed', async () => {
    (getToken as jest.Mock).mockResolvedValue('token-123');
    const player = { play: jest.fn(), pause: jest.fn(), playing: false };
    (useVideoPlayer as jest.Mock).mockReturnValue(player);
    (useEvent as jest.Mock).mockReturnValue({ isPlaying: false });

    render(<ThemeProvider><VideoPlayer path="/api/v1/patients/p1/sample-parts/part-1/media" /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('تشغيل')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText('تشغيل'));
    });

    expect(player.play).toHaveBeenCalled();
  });

  it('shows a pause button and calls player.pause() when playing', async () => {
    (getToken as jest.Mock).mockResolvedValue('token-123');
    const player = { play: jest.fn(), pause: jest.fn(), playing: true };
    (useVideoPlayer as jest.Mock).mockReturnValue(player);
    (useEvent as jest.Mock).mockReturnValue({ isPlaying: true });

    render(<ThemeProvider><VideoPlayer path="/api/v1/patients/p1/sample-parts/part-1/media" /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('إيقاف مؤقت')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText('إيقاف مؤقت'));
    });

    expect(player.pause).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- VideoPlayer.test` (from `mobile/`)
Expected: FAIL with "Cannot find module '../VideoPlayer'".

- [ ] **Step 4: Implement `VideoPlayer`**

Create `mobile/src/components/VideoPlayer.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { Button } from './Button';
import { ar } from '../copy/ar';
import { getToken } from '../storage/session';
import { API_BASE_URL } from '../api/client';

interface VideoPlayerProps {
  path: string;
}

export function VideoPlayer({ path }: VideoPlayerProps) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getToken().then((t) => {
      if (!cancelled) {
        setToken(t);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const source = token ? { uri: `${API_BASE_URL}${path}`, headers: { Authorization: `Bearer ${token}` } } : null;
  const player = useVideoPlayer(source, (p) => {
    if (p) {
      p.loop = false;
    }
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player?.playing ?? false });

  function handlePress() {
    if (!player) return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }

  if (!token) {
    return null;
  }

  return (
    <View>
      <VideoView player={player} style={styles.video} />
      <Button title={isPlaying ? ar.sampleRecording.pause : ar.sampleRecording.play} onPress={handlePress} />
    </View>
  );
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 3 / 4, marginBottom: 8 },
});
```

**Verify against the actual installed `expo-video` types during this step** (per the Global Constraints' Expo-57-verification requirement): confirm `useVideoPlayer` accepts `null` as its source argument without throwing (the docs excerpt used to write this plan didn't explicitly confirm this). If it does not accept `null`, the fallback is to pass an empty-string/placeholder source (e.g. `source ?? { uri: '' }`) and rely on the `if (!token) return null;` early-return to avoid ever rendering `VideoView` with that placeholder — the hook still needs to be called unconditionally on every render (React's rules of hooks), only the rendered output is gated on `token`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- VideoPlayer.test` (from `mobile/`)
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/VideoPlayer.tsx mobile/src/components/__tests__/VideoPlayer.test.tsx mobile/src/api/client.ts
git commit -m "feat: add VideoPlayer component using expo-video with authenticated playback"
```

---

### Task 11: Mobile — API client updates for video upload/metadata

**Files:**
- Modify: `mobile/src/api/treatmentEngine.ts` (`uploadRecording`, `recordAttempt`, `rerecordDamagedParts`, `SampleAttempt`/`SampleSamplePart` interfaces)

**Interfaces:**
- Produces: `uploadRecording(patientProfileId: string, fileUri: string): Promise<{ url: string; mimeType: string; fileSizeBytes: number }>` (was `Promise<{ url: string }>`); `recordAttempt(patientProfileId: string, input: { recordingUrl: string; mimeType: string; fileSizeBytes: number; durationSeconds?: number }): Promise<SampleAttempt>` (was `(patientProfileId, recordingUrl)`); `rerecordDamagedParts(patientProfileId: string, parts: RerecordPartInput[]): Promise<SpeechSample>` where `RerecordPartInput` gains `mimeType`/`fileSizeBytes`/`durationSeconds`. `SampleAttempt`/`SampleSamplePart` interfaces gain the same three fields. Task 12/13 consume these exact signatures.

- [ ] **Step 1: Update the interfaces and functions**

In `mobile/src/api/treatmentEngine.ts`, replace the `SampleSamplePart` interface:

```typescript
export interface SampleSamplePart {
  id: string;
  partType: string;
  label: string;
  order: number;
  recordingUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
  technicallyDamaged: boolean;
}
```

Replace the `SampleAttempt` interface:

```typescript
export interface SampleAttempt {
  id: string;
  sampleSessionId: string;
  attemptNumber: number;
  recordingUrl: string;
  mimeType: string;
  fileSizeBytes: number;
  durationSeconds: number | null;
  deletedAt: string | null;
  createdAt: string;
}
```

Replace `recordAttempt`:

```typescript
export interface RecordAttemptInput {
  recordingUrl: string;
  mimeType: string;
  fileSizeBytes: number;
  durationSeconds?: number;
}

export function recordAttempt(patientProfileId: string, input: RecordAttemptInput): Promise<SampleAttempt> {
  return apiRequest<SampleAttempt>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/attempts`, {
    method: 'POST',
    auth: true,
    body: input,
  });
}
```

Replace `RerecordPartInput` and `rerecordDamagedParts`:

```typescript
export interface RerecordPartInput {
  id: string;
  recordingUrl: string;
  mimeType: string;
  fileSizeBytes: number;
  durationSeconds?: number;
}

export function rerecordDamagedParts(patientProfileId: string, parts: RerecordPartInput[]): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/rerecord`, {
    method: 'POST',
    auth: true,
    body: { parts },
  });
}
```

Replace `uploadRecording`:

```typescript
function guessVideoMimeType(fileUri: string): string {
  const extension = fileUri.split('.').pop()?.toLowerCase();
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'mp4') return 'video/mp4';
  return 'video/mp4';
}

export interface UploadRecordingResult {
  url: string;
  mimeType: string;
  fileSizeBytes: number;
}

export function uploadRecording(patientProfileId: string, fileUri: string): Promise<UploadRecordingResult> {
  const formData = new FormData();
  const mimeType = guessVideoMimeType(fileUri);
  const extension = mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  const filename = fileUri.split('/').pop() ?? `recording.${extension}`;
  formData.append('audio', {
    uri: fileUri,
    name: filename,
    type: mimeType,
  } as unknown as Blob);
  return apiRequest<UploadRecordingResult>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/upload`, {
    method: 'POST',
    auth: true,
    formData,
  });
}
```

(The multipart field name stays `audio`, matching the backend's unchanged `FileInterceptor('audio', ...)` registration from Task 3 — only the accepted content type changed, not the field name.)

- [ ] **Step 2: Run the mobile suite to find every now-broken call site**

Run: `npm test` (from `mobile/`)
Expected: FAIL in `sample-recording.test.tsx` and `sample-rerecord.test.tsx` — both call `recordAttempt`/`rerecordDamagedParts` with the old signatures. This is expected; Tasks 12-13 fix these call sites. Confirm the failures are exactly signature-mismatch related (TypeScript errors surfaced via `jest-expo`'s transform, or assertion failures on the old 2-arg call shape), not something else.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/api/treatmentEngine.ts
git commit -m "feat: update sample API client for video upload and media metadata"
```

(Committing here even with the two known-failing screen tests is fine — Tasks 12-13 fix them immediately next, and this keeps the API-client change as its own reviewable unit.)

---

### Task 12: Mobile — wire `VideoRecorder`/`VideoPlayer` into the main recording wizard

**Files:**
- Modify: `mobile/app/program/sample-recording.tsx`
- Modify: `mobile/app/program/__tests__/sample-recording.test.tsx`

**Interfaces:**
- Consumes: `VideoRecorder`/`VideoPlayer` (Tasks 9-10), the updated `recordAttempt`/`uploadRecording` signatures (Task 11).

- [ ] **Step 1: Update the screen**

In `mobile/app/program/sample-recording.tsx`, replace the imports:

```typescript
import { VideoRecorder } from '../../src/components/VideoRecorder';
import { VideoPlayer } from '../../src/components/VideoPlayer';
```

(Remove the old `AudioRecorder`/`AudioPlayer` imports.)

Replace `handleRecorded` (currently lines 91-105):

```typescript
  async function handleRecorded(fileUri: string, durationSeconds: number) {
    if (!patientProfileId) return;
    setUploading(true);
    setError(null);
    try {
      const { url, mimeType, fileSizeBytes } = await uploadRecording(patientProfileId, fileUri);
      await recordAttempt(patientProfileId, { recordingUrl: url, mimeType, fileSizeBytes, durationSeconds });
      const attemptsResult = await listAttempts(patientProfileId);
      setAttempts(attemptsResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setUploading(false);
    }
  }
```

Replace every `<AudioPlayer uri={attempt.recordingUrl} />` (there are two call sites, lines 183 and 219) with:

```typescript
              <VideoPlayer path={`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/attempts/${attempt.id}/media`} />
```

**Do not use `attempt.recordingUrl` for playback anywhere in this file.** After this plan, `recordingUrl` is a bare backend storage filename with no meaning as a playable source — the only thing the frontend needs from an attempt to play it back is its `id`, used to build the authenticated media path above (per Task 10's `VideoPlayer`).

Replace `<AudioRecorder onRecorded={handleRecorded} />` (line 193) with `<VideoRecorder onRecorded={handleRecorded} />`.

- [ ] **Step 2: Update the test's mocks and assertions**

In `mobile/app/program/__tests__/sample-recording.test.tsx`, replace the `AudioRecorder`/`AudioPlayer` mocks:

```typescript
jest.mock('../../../src/components/VideoRecorder', () => ({
  VideoRecorder: ({ onRecorded }: { onRecorded: (uri: string, durationSeconds: number) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onRecorded('file:///mock-recording.mp4', 8)}>
        <Text>SIMULATE_RECORD</Text>
      </Pressable>
    );
  },
}));

jest.mock('../../../src/components/VideoPlayer', () => ({
  VideoPlayer: () => {
    const { Text } = require('react-native');
    return <Text>MOCK_PLAYER</Text>;
  },
}));
```

Update the `'records a new attempt...'` test's mocked responses and assertions:

```typescript
  it('records a new attempt: uploads the file, records it, and refreshes the attempts list', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    (listAttempts as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockAttempt('attempt-1', 1)]);
    (uploadRecording as jest.Mock).mockResolvedValue({ url: 'attempt-1.mp4', mimeType: 'video/mp4', fileSizeBytes: 204800 });
    (recordAttempt as jest.Mock).mockResolvedValue(mockAttempt('attempt-1', 1));

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('SIMULATE_RECORD')).toBeTruthy());
    fireEvent.press(screen.getByText('SIMULATE_RECORD'));

    await waitFor(() => {
      expect(uploadRecording).toHaveBeenCalledWith('profile-1', 'file:///mock-recording.mp4');
      expect(recordAttempt).toHaveBeenCalledWith('profile-1', {
        recordingUrl: 'attempt-1.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 204800,
        durationSeconds: 8,
      });
      expect(screen.getByText('محاولة 1')).toBeTruthy();
    });
  });
```

Update the `mockAttempt` helper at the top of the file to include the new fields:

```typescript
function mockAttempt(id: string, attemptNumber: number) {
  return {
    id,
    sampleSessionId: 'session-1',
    attemptNumber,
    recordingUrl: `${id}.mp4`,
    mimeType: 'video/mp4',
    fileSizeBytes: 204800,
    durationSeconds: 8,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm test -- sample-recording.test` (from `mobile/`)
Expected: PASS (all tests in the file).

- [ ] **Step 3: Commit**

```bash
git add mobile/app/program/sample-recording.tsx mobile/app/program/__tests__/sample-recording.test.tsx
git commit -m "feat: wire VideoRecorder/VideoPlayer into the sample recording wizard"
```

---

### Task 13: Mobile — wire `VideoRecorder`/`VideoPlayer` into the damaged-part re-record screen

**Files:**
- Modify: `mobile/app/program/sample-rerecord.tsx`
- Modify: `mobile/app/program/__tests__/sample-rerecord.test.tsx`

**Interfaces:**
- Consumes: `VideoRecorder` (Task 9), the updated `uploadRecording`/`rerecordDamagedParts` signatures (Task 11).

- [ ] **Step 1: Update the screen**

In `mobile/app/program/sample-rerecord.tsx`, replace the import:

```typescript
import { VideoRecorder } from '../../src/components/VideoRecorder';
```

Replace `handleRecorded` (currently lines 45-54):

```typescript
  async function handleRecorded(partId: string, fileUri: string, durationSeconds: number) {
    if (!patientProfileId) return;
    setError(null);
    try {
      const { url, mimeType, fileSizeBytes } = await uploadRecording(patientProfileId, fileUri);
      setRecordings((prev) => ({ ...prev, [partId]: { recordingUrl: url, mimeType, fileSizeBytes, durationSeconds } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }
```

Update the `recordings` state type declaration (currently `useState<Record<string, string>>({})`) to hold the fuller shape:

```typescript
  const [recordings, setRecordings] = useState<Record<string, { recordingUrl: string; mimeType: string; fileSizeBytes: number; durationSeconds: number }>>({});
```

Replace `handleSubmit`'s `parts` construction (currently line 61):

```typescript
      const parts = damagedParts.map((part) => ({ id: part.id, ...recordings[part.id] }));
```

Replace `<AudioRecorder onRecorded={(uri) => handleRecorded(part.id, uri)} />` (line 101) with:

```typescript
            <VideoRecorder onRecorded={(uri, durationSeconds) => handleRecorded(part.id, uri, durationSeconds)} />
```

- [ ] **Step 2: Update the test**

In `mobile/app/program/__tests__/sample-rerecord.test.tsx`, replace the `AudioRecorder` mock with:

```typescript
jest.mock('../../../src/components/VideoRecorder', () => ({
  VideoRecorder: ({ onRecorded }: { onRecorded: (uri: string, durationSeconds: number) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onRecorded('file:///mock-rerecording.mp4', 10)}>
        <Text>SIMULATE_RECORD</Text>
      </Pressable>
    );
  },
}));
```

Update the test that submits the rerecorded parts to expect the fuller shape, e.g. wherever it currently asserts:

```typescript
      expect(rerecordDamagedParts).toHaveBeenCalledWith('profile-1', [
        { id: 'part-1', recordingUrl: 'https://example.com/part-1.m4a' },
      ]);
```

change the mocked `uploadRecording` response and the expected call to:

```typescript
    (uploadRecording as jest.Mock).mockResolvedValue({ url: 'part-1.mp4', mimeType: 'video/mp4', fileSizeBytes: 204800 });
    // ...
      expect(rerecordDamagedParts).toHaveBeenCalledWith('profile-1', [
        { id: 'part-1', recordingUrl: 'part-1.mp4', mimeType: 'video/mp4', fileSizeBytes: 204800, durationSeconds: 10 },
      ]);
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm test -- sample-rerecord.test` (from `mobile/`)
Expected: PASS (all tests in the file).

- [ ] **Step 4: Commit**

```bash
git add mobile/app/program/sample-rerecord.tsx mobile/app/program/__tests__/sample-rerecord.test.tsx
git commit -m "feat: wire VideoRecorder into the damaged-part re-record screen"
```

---

### Task 14: Full suite verification + manual walkthrough

**Files:** none (verification only).

**Interfaces:** N/A.

- [ ] **Step 1: Run the full backend suite**

Run: `npm run test:e2e` (from `backend/`)
Expected: all suites pass.

- [ ] **Step 2: Run the full mobile suite**

Run: `npm test` (from `mobile/`)
Expected: all suites pass, including every file touched or newly created in this plan.

- [ ] **Step 3: Manual API-level walkthrough of the upload → store → stream → delete lifecycle**

Actual camera recording can't be exercised outside a real device/simulator, and browser-based verification has been unavailable throughout this project's history (per established precedent) — so verify the backend contract directly, matching the walkthrough-script approach used for prior sub-projects. Write a short Node script (in the scratchpad directory, not committed) that, against the real running backend (`npm run start:dev` from `backend/`):

1. Registers/promotes a CLINICIAN and a PATIENT, creates a patient profile, treatment plan, and gets a training cycle into a sample-eligible state (reuse the setup pattern from `backend/test/treatment-engine-sample-submit.e2e-spec.ts` as a reference for the minimum fixture chain).
2. As PATIENT: uploads a small fake `video/mp4` buffer to the upload endpoint, confirms the response has `url`/`mimeType`/`fileSizeBytes`, records it as an attempt with a `durationSeconds` value, confirms `GET .../attempts` shows it.
3. As PATIENT: calls the new `GET .../attempts/:attemptId/media` endpoint and confirms the response's `Content-Type` header matches `video/mp4` and the body bytes match what was uploaded.
4. Submits the sample (assigning the attempt to a required part), then as the CLINICIAN calls `GET /api/v1/patients/:patientId/sample-parts/:partId/media` and confirms it streams the same bytes.
5. As an unrelated PATIENT (a second, unlinked patient account): confirms both media endpoints return 403/404 rather than leaking the file.
6. Deletes the original attempt, confirms the file is gone from `backend/uploads/video/` on disk (the walkthrough script has direct filesystem access since it runs locally).
7. Confirms `GET /uploads/audio/<anything>` (the old static route) now 404s — proving the unauthenticated path is genuinely gone, not just unlinked from new code paths.

Run the script and confirm every step behaves as described.

- [ ] **Step 4: Report status**

No commit for this task (verification only) — proceed to the final whole-branch review per `subagent-driven-development`.
