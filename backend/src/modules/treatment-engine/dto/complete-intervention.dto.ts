import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CompleteInterventionSchema = z.object({
  outcomeNotes: z.string().min(1),
});

export class CompleteInterventionDto extends createZodDto(CompleteInterventionSchema) {}
