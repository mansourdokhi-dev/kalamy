import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateExerciseStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'ARCHIVED']),
});

export class UpdateExerciseStatusDto extends createZodDto(UpdateExerciseStatusSchema) {}
