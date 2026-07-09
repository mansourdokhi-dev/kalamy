import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const StartCycleSchema = z.object({
  treatmentPlanId: z.string().uuid(),
});

export class StartCycleDto extends createZodDto(StartCycleSchema) {}
