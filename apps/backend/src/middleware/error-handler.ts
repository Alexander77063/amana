import type { ErrorHandler } from 'hono';
import { ConflictError, ForbiddenError, LimitExceededError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { Sentry } from '../lib/sentry';

export const errorHandler: ErrorHandler = (err, c) => {
  // Expected authorization denials → 403, no logging/Sentry noise.
  if (err instanceof ForbiddenError) {
    return c.json({ error: 'forbidden' }, 403);
  }
  if (err instanceof ConflictError) {
    return c.json({ error: 'conflict', detail: err.message }, 409);
  }
  if (err instanceof LimitExceededError) {
    return c.json({ error: 'limit_exceeded', detail: err.message }, 409);
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: 'not_found', detail: err.message }, 404);
  }
  const requestId = c.get('requestId') as string | undefined;
  logger.error({ err, requestId, path: c.req.path }, 'unhandled error');
  Sentry.captureException(err, { tags: { requestId } });
  return c.json({ error: 'internal_error', requestId }, 500);
};
