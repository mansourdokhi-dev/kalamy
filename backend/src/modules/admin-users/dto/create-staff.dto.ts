import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateStaffSchema = z.object({
  fullName: z.string().min(1).max(100),
  mobile: z.string().regex(/^\+?[0-9]{9,15}$/, 'Invalid mobile number'),
  email: z.email().optional(),
  password: z.string().min(8),
  role: z.enum(['CLINICIAN', 'SUPERVISOR', 'ADMIN']),
});

export class CreateStaffDto extends createZodDto(CreateStaffSchema) {}
