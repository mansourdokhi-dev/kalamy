import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const BookSlotSchema = z.object({
  slotId: z.uuid(),
});

export class BookSlotDto extends createZodDto(BookSlotSchema) {}
