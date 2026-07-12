import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RecordAttemptSchema = z.object({
  recordingUrl: z.string().min(1),
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  durationSeconds: z.number().int().positive().optional(),
});

export class RecordAttemptDto extends createZodDto(RecordAttemptSchema) {}
