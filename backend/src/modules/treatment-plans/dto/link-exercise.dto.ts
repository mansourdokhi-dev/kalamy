import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LinkExerciseSchema = z.object({
  exerciseId: z.uuid(),
  frequencyPerWeek: z.number().int().min(1).max(21),
  sequence: z.number().int().min(1),
});

export class LinkExerciseDto extends createZodDto(LinkExerciseSchema) {}
