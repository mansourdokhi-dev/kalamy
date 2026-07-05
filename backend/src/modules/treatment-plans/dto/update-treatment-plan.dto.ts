import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateTreatmentPlanSchema = z.object({
  goals: z.string().min(1).optional(),
  reviewDate: z.iso.date().optional(),
});

export class UpdateTreatmentPlanDto extends createZodDto(UpdateTreatmentPlanSchema) {}
