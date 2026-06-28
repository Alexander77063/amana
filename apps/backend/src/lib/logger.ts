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
