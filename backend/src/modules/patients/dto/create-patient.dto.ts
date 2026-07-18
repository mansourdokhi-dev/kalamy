import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreatePatientSchema = z.object({
  userId: z.uuid(),
  fullName: z.string().min(1).max(100),
  gender: z.enum(['MALE', 'FEMALE']),
  dateOfBirth: z.iso.date(),
  nationalId: z.string().min(5).max(20),
  address: z.string().max(300).optional(),
  referralSource: z.string().max(200).optional(),
  guardianUserId: z.uuid().optional(),
  clinicalInfo: z
    .object({
      referralReason: z.string().max(2000).optional(),
      initialDiagnosis: z.string().max(2000).optional(),
      medicalHistory: z.string().max(5000).optional(),
      medications: z.string().max(2000).optional(),
      allergies: z.string().max(2000).optional(),
      familyHistory: z.string().max(2000).optional(),
    })
    .optional(),
});

export class CreatePatientDto extends createZodDto(CreatePatientSchema) {}
