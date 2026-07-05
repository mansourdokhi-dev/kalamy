import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateAssessmentSchema = z.object({
  type: z.enum(['INITIAL', 'PERIODIC', 'FINAL']),
});

export class CreateAssessmentDto extends createZodDto(CreateAssessmentSchema) {}
