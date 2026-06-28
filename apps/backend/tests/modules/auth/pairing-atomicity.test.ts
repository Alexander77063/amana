import { beforeEach, describe, expect, it } from 'vitest';
import { pairingService } from '../../../src/modules/auth/pairing.service';
import { householdMembersRepo } from '../../../src/modules/identity/household-members.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('pairing consume is an atomic single-use claim', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('binds at most one agent when the same code is consumed concurrently', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const agentA = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const agentB = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const token = await pairingService.issue(testDb, {
      principalUserId: principal.id,
      householdId: hh.id,
    });

    const [rA, rB] = await Promise.all([
      pairingService.consume(testDb, { code: token.code, agentUserId: agentA.id }),
      pairingService.consume(testDb, { code: token.code, agentUserId: agentB.id }),
    ]);

    const consumed = [rA, rB].filter((r) => r.kind === 'consumed');
    expect(consumed).toHaveLength(1);

    const members = await householdMembersRepo.listByHousehold(testDb, hh.id);
    const agentMembers = members.filter((m) => m.userId === agentA.id || m.userId === agentB.id);
    expect(agentMembers).toHaveLength(1);
  });

  it('a second sequential consume of the same code is rejected', async () => {
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
    const token = await pairingService.issue(testDb, {
      principalUserId: principal.id,
      householdId: hh.id,
    });

    const first = await pairingService.consume(testDb, { code: token.code, agentUserId: agent.id });
    expect(first.kind).toBe('consumed');
    const second = await pairingService.consume(testDb, {
      code: token.code,
      agentUserId: agent.id,
    });
    expect(second.kind).toBe('not_found');
  });
});
