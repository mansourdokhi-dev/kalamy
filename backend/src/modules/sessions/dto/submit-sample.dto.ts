import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SubmitSampleSchema = z.object({
  sampleVideoUrl: z.url(),
});

export class SubmitSampleDto extends createZodDto(SubmitSampleSchema) {}
