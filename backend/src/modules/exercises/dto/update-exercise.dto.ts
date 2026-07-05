import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateExerciseSchema = z.object({
  title: z.string().min(1).max(150).optional(),
  category: z.string().min(1).max(50).optional(),
  phaseLevel: z.number().int().min(1).max(5).optional(),
  instructions: z.string().min(1).optional(),
  mediaUrl: z.url().optional(),
  durationMinutes: z.number().int().min(1).optional(),
});

export class UpdateExerciseDto extends createZodDto(UpdateExerciseSchema) {}
