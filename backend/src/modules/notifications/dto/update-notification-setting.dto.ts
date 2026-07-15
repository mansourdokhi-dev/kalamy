import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateNotificationSettingSchema = z.object({
  valueMs: z.number().int().positive(),
});

export class UpdateNotificationSettingDto extends createZodDto(UpdateNotificationSettingSchema) {}
