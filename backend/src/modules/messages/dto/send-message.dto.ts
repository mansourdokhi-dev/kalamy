import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export class SendMessageDto extends createZodDto(SendMessageSchema) {}
