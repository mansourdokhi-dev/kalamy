import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateNotificationPreferenceSchema = z.object({
  enabled: z.boolean(),
});

export class UpdateNotificationPreferenceDto extends createZodDto(UpdateNotificationPreferenceSchema) {}
