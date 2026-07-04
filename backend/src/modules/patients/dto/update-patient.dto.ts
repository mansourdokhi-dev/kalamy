import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdatePatientSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  address: z.string().optional(),
  referralSource: z.string().optional(),
});

export class UpdatePatientDto extends createZodDto(UpdatePatientSchema) {}
