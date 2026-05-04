// apps/backend/src/middleware/jwt-auth.ts
import type { MiddlewareHandler } from 'hono';
import { db } from '../db/client';
import { authSessionsRepo } from '../modules/auth/auth-sessions.repo';
import { verifyAccessToken } from '../modules/auth/tokens';

export type Actor = { userId: string; role: 'principal' | 'agent'; sessionId: string };
export type ActorVariables = { actor: Actor };

export const jwtAuth = (): MiddlewareHandler<{ Variables: ActorVariables }> => async (c, next) => {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'missing_bearer' }, 401);
  }
  const token = header.slice('Bearer '.length).trim();
  let claims: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const session = await authSessionsRepo.findById(db, claims.sid);
  if (!session) return c.json({ error: 'session_not_found' }, 401);
  if (session.revokedAt) return c.json({ error: 'session_revoked' }, 401);
  if (session.expiresAt < new Date()) return c.json({ error: 'session_expired' }, 401);

  authSessionsRepo.touchLastUsed(db, session.id, new Date()).catch(() => {});

  c.set('actor', {
    userId: claims.sub,
    role: claims.role,
    sessionId: claims.sid,
  } satisfies Actor);
  await next();
};
