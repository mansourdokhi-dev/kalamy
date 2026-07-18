import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateExerciseSchema = z.object({
  title: z.string().min(1).max(150),
  category: z.string().min(1).max(50),
  phaseLevel: z.number().int().min(1).max(5),
  instructions: z.string().min(1).max(5000),
  mediaUrl: z.url().optional(),
  durationMinutes: z.number().int().min(1),
});

export class CreateExerciseDto extends createZodDto(CreateExerciseSchema) {}
