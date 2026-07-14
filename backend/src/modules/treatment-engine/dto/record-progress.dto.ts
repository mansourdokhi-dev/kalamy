import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RecordProgressSchema = z.object({
  unitsCompleted: z.number().int().nonnegative(),
});

export class RecordProgressDto extends createZodDto(RecordProgressSchema) {}
