# Sample Video Capture — Design Spec

## Context

This project was discovered mid-brainstorm for staff-web sub-project 3 ("Sample review & progress"). While designing the clinician's sample-review screen, it emerged that the actual clinical sample a patient submits must be audio-and-visual (to see facial/mouth movement and secondary behaviors while speaking), but the currently-shipped system — backend, and the mobile app's already-merged "mobile-sample-recording" sub-project — captures **audio only**. There is no camera/video capability anywhere in the mobile app today, and the backend's upload/storage path is hard-coded to `audio/*` with a 10MB limit.

This project must land **before** staff-web sub-project 3 resumes, since there's no point building a video-review screen with no video data to review. Staff-web sub-project 3 is paused pending this project.

## Scope decisions from brainstorming

- **Video replaces audio, it doesn't run alongside it.** A single video recording (which has its own embedded audio track, same as any phone video) satisfies "audio and visual together" — there is no need for two separate synchronized files. Every "part" of a submitted sample becomes a video clip instead of an audio clip.
- **Both recording flows get updated**: the main 3-step sample-recording wizard (`mobile/app/program/sample-recording.tsx`) and the damaged-part re-record screen (`mobile/app/program/sample-rerecord.tsx`) — both currently built around `AudioRecorder`/`AudioPlayer` and both need to move to video.
- **Storage: local disk now, cloud-ready architecture.** A storage abstraction (interface for save/read/delete) is introduced with a single local-disk implementation for now — matching the existing (audio) pattern and adding no new recurring cost. The abstraction is designed so a cloud-storage implementation (S3-compatible) can be added later as a second implementation, swapped in via configuration, without touching any calling code. This is deliberately *not* implementing cloud storage now — only making the future switch cheap.
- **The authenticated-media-serving security fix (already agreed for the broader audio vulnerability) applies to video from day one.** The current unauthenticated static file route (`app.useStaticAssets` in `main.ts`) is removed entirely, not just supplemented. Both mobile's playback (patient reviewing their own recordings) and the future staff-web review screen will fetch media through an authenticated endpoint.
- **Soft-deleted recordings get their underlying file removed from disk immediately.** Today, deleting a `SampleAttempt` only sets `deletedAt` in the database — the audio file stays on disk forever. This was a minor, cheap-to-ignore inefficiency for small audio files; it becomes a real storage-growth problem at video file sizes (10–50x larger). Going forward, deleting an attempt physically removes its media file from disk while keeping the database row for audit/history (matching the "never truly delete clinical records" convention already used elsewhere in this project).
- **Video library: `expo-camera`.** The mobile app is on Expo SDK 57 with no camera library installed at all. `expo-camera` is Expo's first-party, SDK-version-locked module — safer than a community-maintained alternative like `react-native-vision-camera`, which has its own separate compatibility matrix against Expo/React Native versions. `mobile/AGENTS.md` explicitly warns that Expo 57 is new enough that its docs must be checked directly rather than assumed from prior SDK knowledge — the implementation plan will need to verify `expo-camera`'s exact v57 API before writing code.

## Architecture

### Backend (`backend/src/modules/treatment-engine/`)

**Data model** (`backend/prisma/schema.prisma`): `SampleAttempt` and `SampleSamplePart` currently have only a bare `recordingUrl: String` field. Both gain companion metadata: `mimeType: String`, `fileSizeBytes: Int`, `durationSeconds: Int?` (nullable — duration may not always be reliably extractable client-side). The `recordingUrl` field name is kept as-is (already generic enough to mean "the URL to fetch this recording's media from"), but going forward it always points at a video file.

**Storage abstraction**: a new `MediaStorageService` interface (or equivalent NestJS injectable) with methods to save an uploaded file and return a stored reference, read a file back as a stream, and delete a file. One implementation, `LocalDiskMediaStorageService`, backs it for now — writing to `process.cwd()/uploads/video/<uuid>.<ext>` (renamed from `uploads/audio/` since content is now video). All other backend code (the upload endpoint, the new media-serving endpoint, the delete-attempt logic) depends only on the interface, never on `fs`/`diskStorage` directly.

**Upload endpoint** (`samples.controller.ts`'s `POST .../sample-session/upload`): Multer's `fileFilter` changes from `audio/*`-only to `video/*`-only; the `fileSize` limit is raised substantially (the implementation plan will pick a concrete ceiling based on the chosen recording quality/duration defaults below — likely in the 50–100MB range) to accommodate video instead of the current 10MB.

**Media-serving endpoint(s)** (new): replacing the unauthenticated static route entirely.
- `GET /api/v1/patients/:patientId/sample-attempts/:attemptId/media` — gated by `SessionGuard`/`PermissionsGuard`/`PREPARE_SAMPLE`, plus `PatientAccessService.assertCanAccess` — for a patient/caregiver previewing their own in-progress attempts (mirrors who can currently call `GET .../attempts`).
- `GET /api/v1/patients/:patientId/sample-parts/:partId/media` — gated by `VIEW_CYCLE` (already granted to all 5 roles) plus the same access check — for anyone (patient, caregiver, or staff) who can view the cycle to watch a submitted, assigned part. This is the endpoint the future staff-web review screen will use.

Both stream the file (correct `Content-Type` from the stored `mimeType`) via the storage abstraction rather than a redirect to a public path.

**Delete-attempt logic** (`samples.service.ts`'s attempt-delete path): after setting `deletedAt`, also calls the storage abstraction's delete method for that attempt's file.

### Mobile (`mobile/`)

**`app.json`**: add camera permission (Arabic description string, matching the existing microphone permission pattern) alongside a config plugin for `expo-camera`.

**New `VideoRecorder` component** replacing `AudioRecorder` (`mobile/src/components/`): same props shape (`{ onRecorded, disabled? }`), same responsibility boundary (record/stop, hand off a local file URI) — internals swap from `expo-audio`'s recorder hooks to `expo-camera`'s video-recording API. Requests both camera and microphone permissions before recording (denial shows the same inline-error pattern the current component uses for microphone-only). Keeps a duration cap (same ballpark as today, ~3 minutes per session) and a fixed recording-quality preset chosen for a reasonable file-size/clarity balance (moderate resolution — enough to see facial/mouth movement clearly, not maximum device resolution).

**New `VideoPlayer` component** replacing `AudioPlayer`: same single-prop (`{ uri }`) shape, swaps `expo-audio`'s player hooks for `expo-camera`'s (or Expo's dedicated video-playback API, whichever the plan verifies is current for v57) equivalent, rendering an actual video surface (not just a play/pause + timestamp row, since there's now a picture to show) plus the same play/pause control.

**`sample-recording.tsx`** (3-step wizard) and **`sample-rerecord.tsx`** (damaged-part flow): both swap their `AudioRecorder`/`AudioPlayer` usages for `VideoRecorder`/`VideoPlayer`. No change to the surrounding step logic, attempt-assignment flow, or self-report scoring — only the recording/playback primitives change.

**Upload API client** (`mobile/src/api/treatmentEngine.ts`'s `uploadRecording`): the hard-coded `type: 'audio/m4a'` becomes the actual video mime type the recorder produces (the plan will confirm the exact container format `expo-camera` outputs on iOS/Android — likely `.mp4`), and the multipart field name/filename extension follow suit.

## Out of scope for this project

- The staff-web "Sample Review" screen itself (that's staff-web sub-project 3, resuming once this project merges).
- Actually moving to cloud storage — only the abstraction that makes it possible later.
- The deferred "Specialist Review v2" concerns (review queue, locking, SLA timers, escalation, direct intervention) — unrelated to video capture, already deferred separately.
- Re-processing or transcoding already-nonexistent historical audio samples — there's no production patient data yet, so no migration path for old recordings is needed.

## Testing

Backend: e2e tests (Jest + Supertest against real Postgres, matching every other module in this codebase) for the upload endpoint's new size/mimetype validation, the two new media-serving endpoints' permission checks, and the delete-attempt-removes-file behavior (asserting the file is actually gone from disk, not just the DB row). Mobile: the existing project convention for component tests, understanding that actual camera hardware can't be exercised in tests — `VideoRecorder`/`VideoPlayer` tests will mock `expo-camera` the same way current tests mock `expo-audio`.
