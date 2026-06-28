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
  ANCHOR_WEBHOOK_SECRET: z.string().min(1).optional(),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),
  ANCHOR_API_BASE_URL: z.string().url().default('https://api.sandbox.getanchor.co'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  TERMII_API_KEY: z.string().optional(),
  TERMII_BASE_URL: z.string().default('https://api.ng.termii.com'),
  TERMII_SENDER_ID: z.string().default('Amana'),
  DEV_OTP_BYPASS_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ISSUER: z.string().default('amana'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PAIRING_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24),
  MEDIA_BUCKET: z.string().min(1).default('amana-media-af-south-1'),
  AWS_REGION: z.string().min(1).default('af-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  // Rate limiting (in-memory, per-instance) on the auth/pairing surface.
  RATE_LIMIT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  RATE_LIMIT_OTP_PER_PHONE: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_OTP_PER_IP: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_AUTH_PER_IP: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_PAIRING_PER_IP: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const merged: NodeJS.ProcessEnv = { ...source };
  if (merged.NODE_ENV !== 'production' && !merged.JWT_SECRET) {
    merged.JWT_SECRET = 'dev-only-secret-do-not-use-in-prod-please-32+chars';
  }
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.DEV_OTP_BYPASS_CODE) {
    throw new Error('DEV_OTP_BYPASS_CODE must not be set in production (universal OTP backdoor)');
  }
  return parsed.data;
}

export const env: Env = loadEnv();
