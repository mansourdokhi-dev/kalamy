import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ForgotPasswordSchema = z.object({
  mobile: z.string().min(1),
});

export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}
