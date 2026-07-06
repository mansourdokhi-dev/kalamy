import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReviewSessionSchema = z.object({
  decision: z.enum(['APPROVE', 'REPEAT']),
  reviewNotes: z.string().optional(),
  clinicianOpinionScore: z.number().int().min(0).max(10).optional(),
});

export class ReviewSessionDto extends createZodDto(ReviewSessionSchema) {}
