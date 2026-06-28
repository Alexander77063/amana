import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { lifecycleService } from '../../../src/modules/transactions/lifecycle.service';
import { nipOutService } from '../../../src/modules/transactions/nip-out.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

vi.mock('expo-server-sdk', () => {
  const ExpoMock = vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: vi.fn().mockResolvedValue([{ status: 'ok', id: 'tk-1' }]),
    chunkPushNotifications: (m: unknown[]) => [m],
  }));
  (ExpoMock as unknown as Record<string, unknown>).isExpoPushToken = () => true;
  return { Expo: ExpoMock };
});

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
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    kind: 'topup',
    amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    {
      ledgerAccountId: mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(100_000n),
    },
  ]);
  // Daily limit of 50K.
  await ruleSetService.publishNewVersion(testDb, {
    subWalletId: sw.sub.id,
    createdByUserId: principal.id,
    rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50_000n } }],
  });
  return { agentId: agent.id, masterId: mw.master.id, subWalletId: sw.sub.id, householdId: hh.id };
}

function makeAdapter(): AnchorAdapter {
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'tr', status: 'PENDING', reference: 'r' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    }),
  );
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
}

async function spend(actorUserId: string, masterId: string, subWalletId: string, amount: bigint) {
  return txnIntentService.create(testDb, {
    actorUserId,
    masterWalletId: masterId,
    subWalletId,
    amountKobo: kobo(amount),
    idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: '058',
    vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M',
    category: null,
    agentNote: null,
  });
}

describe('spend-limit window counts sent (in-flight) spends, not only settled', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('a sent-but-unsettled spend counts toward the daily limit', async () => {
    const { agentId, masterId, subWalletId, householdId } = await seed();
    const now = new Date('2026-05-03T12:00:00Z');

    // Spend 1: 40K — evaluate (allow) then SEND so it is sent but not settled.
    const t1 = await spend(agentId, masterId, subWalletId, 40_000n);
    const e1 = await lifecycleService.evaluate(testDb, {
      transactionId: t1.id,
      initiatingUserId: agentId,
      now,
    });
    expect(e1.kind).toBe('allow');
    await nipOutService.send(testDb, makeAdapter(), {
      transactionId: t1.id,
      actorUserId: agentId,
      householdRef: householdId,
      now,
    });
    // Still in_flight (settlement is async) — settled_at is null.
    expect((await transactionsRepo.findById(testDb, t1.id))?.status).toBe('in_flight');

    // Spend 2: 20K — would push the window to 60K > 50K. Must require a bump.
    const t2 = await spend(agentId, masterId, subWalletId, 20_000n);
    const e2 = await lifecycleService.evaluate(testDb, {
      transactionId: t2.id,
      initiatingUserId: agentId,
      now: new Date('2026-05-03T12:01:00Z'),
    });
    expect(e2.kind).toBe('bump_pending');
  });
});
