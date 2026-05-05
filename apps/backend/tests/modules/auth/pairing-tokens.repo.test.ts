import { beforeEach, describe, expect, it } from 'vitest';
import { pairingTokensRepo } from '../../../src/modules/auth/pairing-tokens.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('pairingTokensRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('insert + findActiveByCode', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const t = await pairingTokensRepo.insert(testDb, {
      principalUserId: principal.id,
      householdId: hh.id,
      code: 'PAIR-CODE-123',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const f = await pairingTokensRepo.findActiveByCode(testDb, 'PAIR-CODE-123', new Date());
    expect(f?.id).toBe(t.id);
  });

  it('expired token is not active', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    await pairingTokensRepo.insert(testDb, {
      principalUserId: principal.id,
      householdId: hh.id,
      code: 'EXPIRED',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const f = await pairingTokensRepo.findActiveByCode(testDb, 'EXPIRED', new Date());
    expect(f).toBeUndefined();
  });

  it('markConsumed sets consumed_at + consumed_by_user_id', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const t = await pairingTokensRepo.insert(testDb, {
      principalUserId: principal.id,
      householdId: hh.id,
      code: 'CODE',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await pairingTokensRepo.markConsumed(testDb, t.id, agent.id, new Date());
    const f = await pairingTokensRepo.findActiveByCode(testDb, 'CODE', new Date());
    expect(f).toBeUndefined();
  });
});
