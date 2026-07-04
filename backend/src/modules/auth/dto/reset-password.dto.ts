import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ResetPasswordSchema = z.object({
  mobile: z.string().min(1),
  code: z.string().length(6),
  newPassword: z.string().min(8),
});

export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
