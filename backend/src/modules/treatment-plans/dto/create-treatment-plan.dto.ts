import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateTreatmentPlanSchema = z.object({
  assessmentId: z.uuid(),
  goals: z.string().min(1),
  reviewDate: z.iso.date(),
});

export class CreateTreatmentPlanDto extends createZodDto(CreateTreatmentPlanSchema) {}
