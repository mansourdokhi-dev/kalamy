import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SubmitResponseSchema = z.object({
  templateId: z.string().uuid(),
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        value: z.string().trim().max(4000),
      }),
    )
    .min(1),
});

export class SubmitResponseDto extends createZodDto(SubmitResponseSchema) {}
