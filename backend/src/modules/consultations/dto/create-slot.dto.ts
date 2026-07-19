import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateSlotSchema = z.object({
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(240).optional(),
});

export class CreateSlotDto extends createZodDto(CreateSlotSchema) {}
