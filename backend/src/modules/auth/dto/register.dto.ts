import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RegisterSchema = z.object({
  fullName: z.string().min(1).max(100),
  mobile: z.string().regex(/^\+?[0-9]{9,15}$/, 'Invalid mobile number'),
  email: z.email().optional(),
  password: z.string().min(8).max(128),
  role: z.enum(['PATIENT', 'CAREGIVER']),
});

export class RegisterDto extends createZodDto(RegisterSchema) {}
