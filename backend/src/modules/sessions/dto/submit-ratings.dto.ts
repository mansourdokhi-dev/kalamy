import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SubmitRatingsSchema = z.object({
  selfSeverityCurrent: z.number().int().min(0).max(8).optional(),
  selfSeverityExpectedNext: z.number().int().min(0).max(8).optional(),
  camperdownPerformanceRating: z.number().int().min(1).max(9).optional(),
  clientOpinionScore: z.number().int().min(0).max(10).optional(),
});

export class SubmitRatingsDto extends createZodDto(SubmitRatingsSchema) {}
