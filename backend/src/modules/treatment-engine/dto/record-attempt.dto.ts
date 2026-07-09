import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RecordAttemptSchema = z.object({
  recordingUrl: z.url(),
});

export class RecordAttemptDto extends createZodDto(RecordAttemptSchema) {}
