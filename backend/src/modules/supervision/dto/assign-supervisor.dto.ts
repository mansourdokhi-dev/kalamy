import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AssignSupervisorSchema = z.object({
  supervisorUserId: z.uuid().nullable(),
});

export class AssignSupervisorDto extends createZodDto(AssignSupervisorSchema) {}
