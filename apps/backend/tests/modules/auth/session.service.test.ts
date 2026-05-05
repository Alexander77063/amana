import { beforeEach, describe, expect, it } from 'vitest';
import { authSessionsRepo } from '../../../src/modules/auth/auth-sessions.repo';
import { sessionService } from '../../../src/modules/auth/session.service';
import { verifyAccessToken } from '../../../src/modules/auth/tokens';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('sessionService', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('issue returns access + refresh + sessionId; access JWT carries claims', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const tokens = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    expect(tokens.accessToken).toMatch(/\./);
    expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const claims = await verifyAccessToken(tokens.accessToken);
    expect(claims.sub).toBe(u.id);
    expect(claims.role).toBe('principal');
    expect(claims.sid).toBe(tokens.sessionId);
  });

  it('refresh rotates: new tokens, old session revoked', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const first = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    const result = await sessionService.refresh(testDb, first.refreshToken, 'principal', u.id);
    if (result.kind !== 'rotated') throw new Error(`expected rotated, got ${result.kind}`);
    expect(result.tokens.refreshToken).not.toBe(first.refreshToken);
    expect(result.tokens.sessionId).not.toBe(first.sessionId);
    const oldSession = await authSessionsRepo.findById(testDb, first.sessionId);
    expect(oldSession?.revokedAt).not.toBeNull();
  });

  it('refresh with bogus token returns invalid', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    const r = await sessionService.refresh(testDb, 'not-a-real-refresh-token', 'principal', u.id);
    expect(r.kind).toBe('invalid');
  });

  it('refresh after revoke returns invalid', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const first = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    await sessionService.revoke(testDb, first.sessionId);
    const r = await sessionService.refresh(testDb, first.refreshToken, 'principal', u.id);
    expect(r.kind).toBe('invalid');
  });
});
