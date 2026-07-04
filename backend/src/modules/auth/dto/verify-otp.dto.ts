import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const VerifyOtpSchema = z.object({
  mobile: z.string().min(1),
  code: z.string().length(6),
});

export class VerifyOtpDto extends createZodDto(VerifyOtpSchema) {}
