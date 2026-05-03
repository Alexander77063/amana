import type { ErrorHandler } from 'hono';
import { logger } from '../lib/logger';
import { Sentry } from '../lib/sentry';

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') as string | undefined;
  logger.error({ err, requestId, path: c.req.path }, 'unhandled error');
  Sentry.captureException(err, { tags: { requestId } });
  return c.json({ error: 'internal_error', requestId }, 500);
};
