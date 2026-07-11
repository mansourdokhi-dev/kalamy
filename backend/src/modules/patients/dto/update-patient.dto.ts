import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdatePatientSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  address: z.string().optional(),
  referralSource: z.string().optional(),
  clinicalInfo: z
    .object({
      referralReason: z.string().optional(),
      initialDiagnosis: z.string().optional(),
      medicalHistory: z.string().optional(),
      medications: z.string().optional(),
      allergies: z.string().optional(),
      familyHistory: z.string().optional(),
    })
    .optional(),
});

export class UpdatePatientDto extends createZodDto(UpdatePatientSchema) {}
