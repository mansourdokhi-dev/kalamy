import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const QuestionTypeSchema = z.enum(['TEXT', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'SCALE']);

export const CreateTemplateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  questions: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(1000),
        type: QuestionTypeSchema,
        options: z.array(z.string().trim().min(1)).max(20).optional(),
        required: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export class CreateTemplateDto extends createZodDto(CreateTemplateSchema) {}
