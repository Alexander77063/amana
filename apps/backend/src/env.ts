import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://amana:amana_dev_only@localhost:5432/amana_dev'),
  SENTRY_DSN: z.string().url().optional(),
  ANCHOR_API_KEY: z.string().min(1).optional(),
  ANCHOR_API_BASE_URL: z.string().url().default('https://api.sandbox.getanchor.co'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
