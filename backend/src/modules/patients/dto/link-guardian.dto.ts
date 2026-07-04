import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LinkGuardianSchema = z.object({
  guardianUserId: z.uuid(),
  relationship: z.string().min(1).max(50),
});

export class LinkGuardianDto extends createZodDto(LinkGuardianSchema) {}
