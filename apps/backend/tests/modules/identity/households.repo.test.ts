import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { householdMembersRepo } from '../../../src/modules/identity/household-members.repo';

describe('households + household_members', () => {
  beforeEach(async () => { await truncateAll(); });

  it('insert + findByPrincipal', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, {
      principalUserId: principal.id,
      name: 'Adegbola household',
    });
    const found = await householdsRepo.findByPrincipal(testDb, principal.id);
    expect(found?.id).toBe(hh.id);
    expect(found?.name).toBe('Adegbola household');
  });

  it('add member + list', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const hh = await householdsRepo.insert(testDb, {
      principalUserId: principal.id, name: 'HH',
    });
    await householdMembersRepo.add(testDb, hh.id, principal.id);
    await householdMembersRepo.add(testDb, hh.id, agent.id);
    const members = await householdMembersRepo.listByHousehold(testDb, hh.id);
    expect(members).toHaveLength(2);
  });

  it('setStatus suspends a member', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    await householdMembersRepo.add(testDb, hh.id, agent.id);
    await householdMembersRepo.setStatus(testDb, hh.id, agent.id, 'suspended');
    const members = await householdMembersRepo.listByHousehold(testDb, hh.id);
    expect(members[0]?.status).toBe('suspended');
  });
});
