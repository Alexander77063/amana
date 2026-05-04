import { beforeEach, describe, expect, it } from 'vitest';
import { otpChallengesRepo } from '../../../src/modules/auth/otp-challenges.repo';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('otpChallengesRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('insert + findActiveByPhone returns the row', async () => {
    const expires = new Date(Date.now() + 60_000);
    const ch = await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678', codeHash: 'h1', purpose: 'login', expiresAt: expires,
    });
    const found = await otpChallengesRepo.findActiveByPhone(testDb, '+2348012345678', new Date());
    expect(found?.id).toBe(ch.id);
  });

  it('expired challenge is not active', async () => {
    await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678', codeHash: 'h1', purpose: 'login',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const found = await otpChallengesRepo.findActiveByPhone(testDb, '+2348012345678', new Date());
    expect(found).toBeUndefined();
  });

  it('invalidateActiveForPhone clears prior pending so a new insert succeeds', async () => {
    await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678', codeHash: 'h1', purpose: 'login',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await otpChallengesRepo.invalidateActiveForPhone(testDb, '+2348012345678', new Date());
    const ch2 = await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678', codeHash: 'h2', purpose: 'login',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const found = await otpChallengesRepo.findActiveByPhone(testDb, '+2348012345678', new Date());
    expect(found?.id).toBe(ch2.id);
  });

  it('incrementAttempts returns the new count', async () => {
    const ch = await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678', codeHash: 'h1', purpose: 'login',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await otpChallengesRepo.incrementAttempts(testDb, ch.id)).toBe(1);
    expect(await otpChallengesRepo.incrementAttempts(testDb, ch.id)).toBe(2);
  });

  it('markConsumed sets consumed_at and removes from active', async () => {
    const ch = await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678', codeHash: 'h1', purpose: 'login',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await otpChallengesRepo.markConsumed(testDb, ch.id, new Date());
    const found = await otpChallengesRepo.findActiveByPhone(testDb, '+2348012345678', new Date());
    expect(found).toBeUndefined();
  });
});
