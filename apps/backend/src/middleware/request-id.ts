import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

const HEADER = 'x-request-id';

export const requestId = (): MiddlewareHandler => async (c, next) => {
  const incoming = c.req.header(HEADER);
  const id = incoming && incoming.length > 0 ? incoming : randomUUID();
  c.set('requestId', id);
  c.header(HEADER, id);
  await next();
};
