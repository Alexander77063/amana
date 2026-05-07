import { z } from 'zod';

export const QuietHoursSchema = z
  .object({
    enabled: z.boolean(),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(0).max(1439),
  })
  .refine((v) => v.startMinute !== v.endMinute, {
    message: 'startMinute and endMinute must differ',
  });
