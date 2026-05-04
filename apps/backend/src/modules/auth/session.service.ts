import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { authSessionsRepo } from './auth-sessions.repo';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyRefreshToken,
} from './tokens';
import type { IssuedTokens } from './types';

type DbOrTx = PostgresJsDatabase;

export type IssueInput = {
  userId: string;
  role: 'principal' | 'agent';
  now?: Date;
};

export type RefreshResult = { kind: 'rotated'; tokens: IssuedTokens } | { kind: 'invalid' };

export const sessionService = {
  async issue(db: DbOrTx, input: IssueInput): Promise<IssuedTokens> {
    const now = input.now ?? new Date();
    const refresh = generateRefreshToken();
    const refreshHash = await hashRefreshToken(refresh);
    const refreshExpires = new Date(now.getTime() + env.JWT_REFRESH_TTL_SECONDS * 1000);
    const session = await authSessionsRepo.insert(db, {
      userId: input.userId,
      refreshTokenHash: refreshHash,
      expiresAt: refreshExpires,
    });
    const access = await signAccessToken({
      userId: input.userId,
      role: input.role,
      sessionId: session.id,
      now,
    });
    return {
      accessToken: access.token,
      refreshToken: refresh,
      accessExpiresAt: access.expiresAt,
      refreshExpiresAt: refreshExpires,
      sessionId: session.id,
    };
  },

  async refresh(
    db: DbOrTx,
    refreshToken: string,
    role: 'principal' | 'agent',
    userId: string,
    now: Date = new Date(),
  ): Promise<RefreshResult> {
    const candidates = await authSessionsRepo.listActive(db, userId, now);
    for (const candidate of candidates) {
      const matches = await verifyRefreshToken(refreshToken, candidate.refreshTokenHash);
      if (!matches) continue;
      const newRefresh = generateRefreshToken();
      const newHash = await hashRefreshToken(newRefresh);
      const newExpires = new Date(now.getTime() + env.JWT_REFRESH_TTL_SECONDS * 1000);
      const fresh = await authSessionsRepo.rotate(
        db,
        candidate.id,
        { userId, refreshTokenHash: newHash, expiresAt: newExpires },
        now,
      );
      const access = await signAccessToken({
        userId,
        role,
        sessionId: fresh.id,
        now,
      });
      return {
        kind: 'rotated' as const,
        tokens: {
          accessToken: access.token,
          refreshToken: newRefresh,
          accessExpiresAt: access.expiresAt,
          refreshExpiresAt: newExpires,
          sessionId: fresh.id,
        },
      };
    }
    return { kind: 'invalid' as const };
  },

  async revoke(db: DbOrTx, sessionId: string, now: Date = new Date()): Promise<void> {
    await authSessionsRepo.revoke(db, sessionId, now);
  },
};
