import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TransferReviewSchema = z.object({
  toUserId: z.string().uuid(),
  reason: z.string().min(1),
});

export class TransferReviewDto extends createZodDto(TransferReviewSchema) {}
