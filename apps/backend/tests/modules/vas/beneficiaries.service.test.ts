import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../src/lib/errors';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { beneficiariesService } from '../../../src/modules/vas/beneficiaries.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seed() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-test',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'Driver',
  });
  return { principal, agent, mw, sw };
}

async function makeOtherPrincipal() {
  return usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
}

describe('assertRecipientAllowed', () => {
  beforeEach(truncateAll);

  it('allows airtime to the agent’s own phone without a beneficiary', async () => {
    const { agent, sw } = await seed();
    await expect(
      beneficiariesService.assertRecipientAllowed(testDb, {
        subWalletId: sw.sub.id,
        agentUserId: agent.id,
        category: 'airtime',
        recipient: agent.phone,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects airtime to an un-approved other number', async () => {
    const { agent, sw } = await seed();
    await expect(
      beneficiariesService.assertRecipientAllowed(testDb, {
        subWalletId: sw.sub.id,
        agentUserId: agent.id,
        category: 'airtime',
        recipient: '+2348099999999',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows an approved beneficiary', async () => {
    const { principal, agent, sw } = await seed();
    await beneficiariesService.add(testDb, {
      actorUserId: principal.id,
      subWalletId: sw.sub.id,
      kind: 'phone',
      value: '+2348099999999',
      label: 'Mum',
    });
    await expect(
      beneficiariesService.assertRecipientAllowed(testDb, {
        subWalletId: sw.sub.id,
        agentUserId: agent.id,
        category: 'airtime',
        recipient: '+2348099999999',
      }),
    ).resolves.toBeUndefined();
  });

  it('normalizes recipient formats so an approved beneficiary matches any format', async () => {
    const { principal, agent, sw } = await seed();
    // Approve in +234 form...
    await beneficiariesService.add(testDb, {
      actorUserId: principal.id,
      subWalletId: sw.sub.id,
      kind: 'phone',
      value: '+2348099999999',
      label: 'Mum',
    });
    // ...and spend to the same number in local 0801… form → still allowed.
    await expect(
      beneficiariesService.assertRecipientAllowed(testDb, {
        subWalletId: sw.sub.id,
        agentUserId: agent.id,
        category: 'airtime',
        recipient: '08099999999',
      }),
    ).resolves.toBeUndefined();
  });

  it('requires an approved meter for electricity (no own-meter concept)', async () => {
    const { agent, sw } = await seed();
    await expect(
      beneficiariesService.assertRecipientAllowed(testDb, {
        subWalletId: sw.sub.id,
        agentUserId: agent.id,
        category: 'electricity',
        recipient: '01234567890',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('skips the allowlist for principal-direct purchases (subWalletId null)', async () => {
    await expect(
      beneficiariesService.assertRecipientAllowed(testDb, {
        subWalletId: null,
        agentUserId: null,
        category: 'electricity',
        recipient: '01234567890',
      }),
    ).resolves.toBeUndefined();
  });

  it('add is rejected for a non-owning principal', async () => {
    const { sw } = await seed();
    const other = await makeOtherPrincipal();
    await expect(
      beneficiariesService.add(testDb, {
        actorUserId: other.id,
        subWalletId: sw.sub.id,
        kind: 'phone',
        value: '+2348012345678',
        label: 'x',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('add is rejected for the owning agent (principal-only)', async () => {
    const { agent, sw } = await seed();
    await expect(
      beneficiariesService.add(testDb, {
        actorUserId: agent.id,
        subWalletId: sw.sub.id,
        kind: 'phone',
        value: '+2348012345678',
        label: 'x',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
