import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RecordTrainingEventSchema = z.object({
  durationSeconds: z.number().int().positive().optional(),
  unitsCompleted: z.number().int().positive().optional(),
});

export class RecordTrainingEventDto extends createZodDto(RecordTrainingEventSchema) {}
