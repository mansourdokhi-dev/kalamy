import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { recordingUrlSchema } from './recording-url.schema';

export const RerecordPartsSchema = z.object({
  parts: z
    .array(
      z.object({
        id: z.string().uuid(),
        recordingUrl: recordingUrlSchema,
        mimeType: z.string().min(1),
        fileSizeBytes: z.number().int().positive(),
        durationSeconds: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});

export class RerecordPartsDto extends createZodDto(RerecordPartsSchema) {}
