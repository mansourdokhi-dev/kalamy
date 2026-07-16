import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { recordingUrlSchema } from './recording-url.schema';

export const RecordAttemptSchema = z.object({
  recordingUrl: recordingUrlSchema,
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  durationSeconds: z.number().int().positive().optional(),
});

export class RecordAttemptDto extends createZodDto(RecordAttemptSchema) {}
