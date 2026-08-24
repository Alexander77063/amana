import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transactions } from '../../../src/db/schema';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { RuleDeniedError } from '../../../src/lib/errors';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { beneficiariesService } from '../../../src/modules/vas/beneficiaries.service';
import { vasPurchaseService } from '../../../src/modules/vas/purchase.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

// A digital purchase spends the same money out of the same wallet as a bank transfer, so the
// principal's category and time-window rules have to apply to it. Before this, a parent who
// allowed only "transport" could still have airtime bought against their wallet.
const adapter = {
  payBill: vi.fn(async () => ({
    id: 'bill_1',
    status: 'PENDING' as const,
    commissionKobo: 0n,
    token: null,
  })),
  validateCustomer: vi.fn(async (_p: string, account: string) => ({
    customerNumber: account,
    customerName: 'Test Customer',
  })),
} as unknown as AnchorAdapter;

async function seed() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    bvn: factories.bvn(),
    kycTier: '2',
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
    anchorAccountId: 'a-1',
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

type Seeded = Awaited<ReturnType<typeof seed>>;

const buy = (s: Seeded, over: Record<string, unknown> = {}) =>
  vasPurchaseService.create(testDb, adapter, {
    actorUserId: s.agent.id,
    masterWalletId: s.mw.master.id,
    subWalletId: s.sw.sub.id,
    category: 'airtime' as const,
    provider: 'mtn',
    recipient: s.agent.phone,
    amountKobo: 5_000n,
    idempotencyKey: factories.idempotencyKey(),
    now: new Date('2026-07-08T12:00:00Z'), // 13:00 Lagos, a Wednesday
    ...over,
  });

const publish = (
  s: Seeded,
  rules: Parameters<typeof ruleSetService.publishNewVersion>[1]['rules'],
) =>
  ruleSetService.publishNewVersion(testDb, {
    subWalletId: s.sw.sub.id,
    createdByUserId: s.principal.id,
    rules,
  });

describe('VAS purchases obey the principal’s spending rules', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('refuses a category the parent has not allowed', async () => {
    const s = await seed();
    await publish(s, [
      {
        kind: 'category',
        priority: 20,
        config: { mode: 'allowlist', categories: ['transport', 'school'] },
      },
    ]);
    await expect(buy(s)).rejects.toBeInstanceOf(RuleDeniedError);
  });

  it('names the rule that stopped it', async () => {
    const s = await seed();
    await publish(s, [
      { kind: 'category', priority: 20, config: { mode: 'allowlist', categories: ['transport'] } },
    ]);
    await expect(buy(s)).rejects.toMatchObject({ reasons: ['CATEGORY_NOT_ALLOWED'] });
  });

  it('allows a category the parent did allow', async () => {
    const s = await seed();
    await publish(s, [
      {
        kind: 'category',
        priority: 20,
        config: { mode: 'allowlist', categories: ['airtime_data'] },
      },
    ]);
    await expect(buy(s)).resolves.toMatchObject({ status: 'in_flight' });
  });

  it('maps electricity to its own category, not to airtime', async () => {
    const s = await seed();
    await publish(s, [
      {
        kind: 'category',
        priority: 20,
        config: { mode: 'allowlist', categories: ['airtime_data'] },
      },
    ]);
    // The recipient allowlist is checked before the rules, so approve the meter first —
    // otherwise this would pass for the wrong reason (ForbiddenError, not RuleDeniedError).
    await beneficiariesService.add(testDb, {
      actorUserId: s.principal.id,
      subWalletId: s.sw.sub.id,
      kind: 'meter',
      value: '12345678901',
      label: 'Home meter',
    });

    // Allowed for airtime, so an electricity purchase must still be refused.
    await expect(
      buy(s, { category: 'electricity', provider: 'ekedc', recipient: '12345678901' }),
    ).rejects.toBeInstanceOf(RuleDeniedError);
  });

  it('refuses a purchase outside the allowed hours', async () => {
    const s = await seed();
    await publish(s, [
      {
        kind: 'time_window',
        priority: 30,
        config: { startHour: 0, endHour: 6, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      },
    ]);
    // 13:00 Lagos is outside a 00:00–06:00 window.
    await expect(buy(s)).rejects.toBeInstanceOf(RuleDeniedError);
  });

  it('writes nothing when a rule refuses — no transaction, no postings', async () => {
    const s = await seed();
    await publish(s, [
      { kind: 'category', priority: 20, config: { mode: 'allowlist', categories: ['transport'] } },
    ]);
    await expect(buy(s)).rejects.toBeInstanceOf(RuleDeniedError);

    const txns = await testDb.select().from(transactions);
    expect(txns).toHaveLength(0);
  });

  it('leaves a wallet with no published rules alone', async () => {
    const s = await seed();
    await expect(buy(s)).resolves.toMatchObject({ status: 'in_flight' });
  });
});
