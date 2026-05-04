import type { MiddlewareHandler } from 'hono';

export type Actor = { userId: string; role: 'principal' | 'agent' };

const ROLES = new Set<Actor['role']>(['principal', 'agent']);

export const actor = (): MiddlewareHandler => async (c, next) => {
  const userId = c.req.header('x-actor-user-id');
  const role = c.req.header('x-actor-role');
  if (!userId || !role) {
    return c.json({ error: 'missing_actor_headers' }, 401);
  }
  if (!ROLES.has(role as Actor['role'])) {
    return c.json({ error: 'invalid_role' }, 401);
  }
  c.set('actor', { userId, role: role as Actor['role'] } satisfies Actor);
  await next();
};
