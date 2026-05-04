// apps/backend/tests/modules/auth/pairing.service.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { pairingService } from '../../../src/modules/auth/pairing.service';
import { householdMembersRepo } from '../../../src/modules/identity/household-members.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('pairingService', () => {
  beforeEach(async () => { await truncateAll(); });

  it('issue returns a token with the expected scope', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, {
      principalUserId: principal.id, name: 'HH',
    });
    const t = await pairingService.issue(testDb, {
      principalUserId: principal.id, householdId: hh.id,
    });
    expect(t.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(t.principalUserId).toBe(principal.id);
    expect(t.householdId).toBe(hh.id);
  });

  it('consume links agent to household + marks token consumed', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, {
      principalUserId: principal.id, name: 'HH',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const t = await pairingService.issue(testDb, {
      principalUserId: principal.id, householdId: hh.id,
    });
    const r = await pairingService.consume(testDb, { code: t.code, agentUserId: agent.id });
    expect(r.kind).toBe('consumed');
    if (r.kind === 'consumed') {
      expect(r.householdId).toBe(hh.id);
    }
    const members = await householdMembersRepo.listByHousehold(testDb, hh.id);
    expect(members.some((m) => m.userId === agent.id)).toBe(true);
  });

  it('consume with bad code returns not_found', async () => {
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const r = await pairingService.consume(testDb, { code: 'nope', agentUserId: agent.id });
    expect(r.kind).toBe('not_found');
  });

  it('idempotent: consuming twice (different agents) for same household is fine', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, {
      principalUserId: principal.id, name: 'HH',
    });
    const agent1 = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const agent2 = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const t1 = await pairingService.issue(testDb, {
      principalUserId: principal.id, householdId: hh.id,
    });
    await pairingService.consume(testDb, { code: t1.code, agentUserId: agent1.id });
    const t2 = await pairingService.issue(testDb, {
      principalUserId: principal.id, householdId: hh.id,
    });
    const r2 = await pairingService.consume(testDb, { code: t2.code, agentUserId: agent2.id });
    expect(r2.kind).toBe('consumed');
    const members = await householdMembersRepo.listByHousehold(testDb, hh.id);
    expect(members.length).toBe(2);
  });
});
