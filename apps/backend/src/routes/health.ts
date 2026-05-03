import { Hono } from 'hono';

const VERSION = '0.0.0';

export const healthRoute = new Hono().get('/', (c) =>
  c.json({ status: 'ok' as const, version: VERSION }),
);
