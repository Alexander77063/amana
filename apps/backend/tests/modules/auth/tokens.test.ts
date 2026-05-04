import { describe, expect, it } from 'vitest';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../../src/modules/auth/tokens';

describe('tokens', () => {
  it('access token round-trip carries sub + role + sid', async () => {
    const { token, expiresAt } = await signAccessToken({
      userId: '11111111-1111-1111-1111-111111111111',
      role: 'principal',
      sessionId: '22222222-2222-2222-2222-222222222222',
    });
    expect(token.split('.').length).toBe(3);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe('11111111-1111-1111-1111-111111111111');
    expect(claims.role).toBe('principal');
    expect(claims.sid).toBe('22222222-2222-2222-2222-222222222222');
    expect(claims.iss).toBe('amana');
  });

  it('verifyAccessToken rejects garbage', async () => {
    await expect(verifyAccessToken('not.a.jwt')).rejects.toThrow();
    await expect(verifyAccessToken('a.b.c')).rejects.toThrow();
  });

  it('refresh token: 43-char base64url, hash + verify roundtrip', async () => {
    const refresh = generateRefreshToken();
    expect(refresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = await hashRefreshToken(refresh);
    expect(await verifyRefreshToken(refresh, hash)).toBe(true);
    expect(await verifyRefreshToken('wrong-token', hash)).toBe(false);
  });
});
