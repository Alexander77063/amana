import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { reconciliationService } from '../../../src/modules/transactions/reconciliation.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedStuckTxn(createdAtIso: string) {
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
  // Top up
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
  // Create spend, force into in_flight, write reservation postings, BACKDATE created_at to make it look stuck
  const txn = await txnIntentService.create(testDb, {
    actorUserId: agent.id,
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n),
    idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: '058',
    vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M',
    category: null,
    agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  // Reservation postings (so settlement / reverse don't fail)
  await ledgerService.writeDoubleEntry(testDb, txn.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(5_000n), creditKobo: kobo(0n) },
    {
      ledgerAccountId: mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(5_000n),
    },
  ]);
  // Backdate
  await testDb.execute(
    sql`UPDATE transactions SET created_at = ${createdAtIso}::timestamptz WHERE id = ${txn.id}`,
  );
  return { txnId: txn.id, idempotencyKey: txn.idempotencyKey };
}

function makeAdapter(fetchImpl: typeof fetch): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });
}

describe('reconciliationService.sweep', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('settles stuck txns when Anchor reports COMPLETED', async () => {
    const { txnId, idempotencyKey } = await seedStuckTxn('2026-05-03T11:50:00Z');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'tr-1',
          status: 'COMPLETED',
          reference: idempotencyKey,
          nibssSessionId: '777',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await reconciliationService.sweep(
      testDb,
      makeAdapter(fetchSpy),
      new Date('2026-05-03T12:00:00Z'),
    );
    expect(result.settled).toBe(1);
    const finalTxn = await transactionsRepo.findById(testDb, txnId);
    expect(finalTxn?.status).toBe('settled');
  });

  it('reverses stuck txns when Anchor reports FAILED', async () => {
    const { txnId, idempotencyKey } = await seedStuckTxn('2026-05-03T11:50:00Z');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'tr-1',
          status: 'FAILED',
          reference: idempotencyKey,
          failureReason: 'recipient closed',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await reconciliationService.sweep(
      testDb,
      makeAdapter(fetchSpy),
      new Date('2026-05-03T12:00:00Z'),
    );
    expect(result.reversed).toBe(1);
    const finalTxn = await transactionsRepo.findById(testDb, txnId);
    expect(finalTxn?.status).toBe('failed');
  });

  it('counts unknown when Anchor returns 404 for the reference', async () => {
    await seedStuckTxn('2026-05-03T11:50:00Z');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"error":"not_found"}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await reconciliationService.sweep(
      testDb,
      makeAdapter(fetchSpy),
      new Date('2026-05-03T12:00:00Z'),
    );
    expect(result.unknown).toBe(1);
  });

  it('skips fresh in_flight txns (under 5 minutes old)', async () => {
    await seedStuckTxn(new Date('2026-05-03T11:58:00Z').toISOString());
    const fetchSpy = vi.fn();
    const result = await reconciliationService.sweep(
      testDb,
      makeAdapter(fetchSpy),
      new Date('2026-05-03T12:00:00Z'),
    );
    expect(result.inspected).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
