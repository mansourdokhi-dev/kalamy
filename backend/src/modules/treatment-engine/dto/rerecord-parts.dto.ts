import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RerecordPartsSchema = z.object({
  parts: z
    .array(
      z.object({
        id: z.string().uuid(),
        recordingUrl: z.url(),
      }),
    )
    .min(1),
});

export class RerecordPartsDto extends createZodDto(RerecordPartsSchema) {}
