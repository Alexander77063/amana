import * as Sentry from '@sentry/node';
import { env } from '../env';
import { logger } from './logger';

export function initSentry(): void {
  if (!env.SENTRY_DSN) {
    logger.info('Sentry disabled (no SENTRY_DSN configured)');
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
  logger.info({ environment: env.NODE_ENV }, 'Sentry initialised');
}

export { Sentry };
