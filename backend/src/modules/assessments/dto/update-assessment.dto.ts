import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateAssessmentSchema = z.object({
  medicalHistory: z.string().optional(),
  difficultSituations: z.string().optional(),
  anxietyLevel: z.string().optional(),
  initialGoals: z.string().optional(),
  clinicianNotes: z.string().optional(),
  ssi4Frequency: z.number().int().min(0).optional(),
  ssi4Duration: z.number().int().min(0).optional(),
  ssi4PhysicalConcomitants: z.number().int().min(0).optional(),
  ssi4Total: z.number().int().min(0).optional(),
});

export class UpdateAssessmentDto extends createZodDto(UpdateAssessmentSchema) {}
