import pino, { type Logger } from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Fields that must never reach the logs. Redaction runs before any transport,
 * so it applies in both dev (pretty) and prod. Top-level + one-level-nested
 * (`*.x`) paths cover how these are passed today.
 */
export const redactConfig = {
  paths: [
    'phone',
    '*.phone',
    'bvn',
    '*.bvn',
    'nin',
    '*.nin',
    'refreshToken',
    '*.refreshToken',
    'accessToken',
    '*.accessToken',
    'pairingCode',
    '*.pairingCode',
    'authorization',
    '*.authorization',
    'req.headers.authorization',
    // A NUBAN identifies a person's bank account and travels with `bankCode`, which is logged
    // beside it. Added after a review found `routes/vendors.ts` passing it as a named field on the
    // enquiry-failure path: the commit that stopped a phone being interpolated into a log MESSAGE
    // moved identifiers to named FIELDS, which is right, but only `phone` was on this list — so
    // closing one leak opened its neighbour. If you add an identifier to a log call, add it here in
    // the same change.
    'accountNumber',
    '*.accountNumber',
  ],
  censor: '[redacted]',
};

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
    : undefined,
  base: { service: 'amana-backend' },
  redact: redactConfig,
});
