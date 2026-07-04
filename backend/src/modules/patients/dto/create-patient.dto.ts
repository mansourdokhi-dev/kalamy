import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreatePatientSchema = z.object({
  userId: z.uuid(),
  fullName: z.string().min(1).max(100),
  gender: z.enum(['MALE', 'FEMALE']),
  dateOfBirth: z.iso.date(),
  nationalId: z.string().min(5).max(20),
  address: z.string().optional(),
  referralSource: z.string().optional(),
  guardianUserId: z.uuid().optional(),
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

export class CreatePatientDto extends createZodDto(CreatePatientSchema) {}
