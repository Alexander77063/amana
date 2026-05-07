import { z } from 'zod';

export const SubWalletSnoozeInputSchema = z
  .object({
    until: z.string().datetime().nullable(),
  })
  .refine((v) => v.until === null || new Date(v.until).getTime() > Date.now(), {
    message: 'until must be in the future',
  });
