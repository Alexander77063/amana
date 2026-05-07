import { z } from 'zod';

// Shared Zod schemas — populated in Sub-plan 2 onwards.
// Bootstrap export so the package builds cleanly.
export const PingSchema = z.object({ ping: z.literal('pong') });
export type Ping = z.infer<typeof PingSchema>;

export * from './notification';
export * from './sub-wallet';
