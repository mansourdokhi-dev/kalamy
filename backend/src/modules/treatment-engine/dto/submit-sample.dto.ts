import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SubmitSampleSchema = z.object({
  parts: z
    .array(
      z.object({
        partType: z.string().min(1),
        label: z.string().min(1),
        order: z.number().int().positive(),
        sourceAttemptId: z.string().uuid(),
      }),
    )
    .min(1),
  selfSeverityCurrent: z.number().int().min(1).max(9),
  selfSeverityExpectedNext: z.number().int().min(1).max(9),
  camperdownPerformanceRating: z.number().int().min(1).max(9),
  clientOpinionScore: z.number().int().min(1).max(9),
});

export class SubmitSampleDto extends createZodDto(SubmitSampleSchema) {}
