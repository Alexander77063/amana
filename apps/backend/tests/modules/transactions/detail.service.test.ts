import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { transactionDetailService } from '../../../src/modules/transactions/detail.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

beforeEach(async () => {
  await truncateAll();
});

async function setup() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const household = await householdsRepo.insert(testDb, {
    principalUserId: principal.id,
    name: 'Adeyemi',
  });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: household.id,
    anchorVirtualAccount: '0000000001',
    anchorBankCode: '050',
    anchorAccountId: 'a-1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: "Tunde's allowance",
  });
  return { principal, agent, household, mw, sw };
}

describe('transactionDetailService.getByIdForPrincipal', () => {
  it('returns null when txn does not exist', async () => {
    const { principal } = await setup();
    const result = await transactionDetailService.getByIdForPrincipal(
      testDb,
      '00000000-0000-0000-0000-000000000000',
      principal.id,
    );
    expect(result).toBeNull();
  });

  it('returns null when txn exists but belongs to another household (no existence leak)', async () => {
    const { principal: alice } = await setup();
    // Build a parallel household with its own principal & txn.
    const bobUser = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const bobAgent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const bobHh = await householdsRepo.insert(testDb, {
      principalUserId: bobUser.id,
      name: 'Bob',
    });
    const bobMw = await masterWalletsRepo.provision(testDb, {
      householdId: bobHh.id,
      anchorVirtualAccount: '0000000002',
      anchorBankCode: '050',
      anchorAccountId: 'b-1',
    });
    const bobSw = await subWalletsRepo.provision(testDb, {
      masterWalletId: bobMw.master.id,
      agentUserId: bobAgent.id,
      name: "Bob's wallet",
    });
    const bobTxn = await transactionsRepo.insert(testDb, {
      masterWalletId: bobMw.master.id,
      subWalletId: bobSw.sub.id,
      kind: 'spend',
      amountKobo: 100n as never,
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0000000000',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    // Alice tries to read Bob's txn — should be null (no existence leak).
    const result = await transactionDetailService.getByIdForPrincipal(testDb, bobTxn.id, alice.id);
    expect(result).toBeNull();
  });

  it('returns sub-wallet, agent role, and masked vendor account for an agent-initiated settled txn', async () => {
    const { principal, sw, agent, mw } = await setup();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: 12_300n as never,
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'Mama Tola Foodstuffs',
      agentNote: 'Groceries for the week',
    });
    await testDb.execute(
      sql`UPDATE transactions SET status='settled', settled_at=NOW(), nibss_session_id='100005031234567890' WHERE id = ${txn.id}`,
    );

    const r = await transactionDetailService.getByIdForPrincipal(testDb, txn.id, principal.id);
    expect(r).not.toBeNull();
    expect(r!.id).toBe(txn.id);
    expect(r!.kind).toBe('spend');
    expect(r!.status).toBe('settled');
    expect(r!.amountKobo).toBe('12300');
    expect(r!.vendorAccountMasked).toBe('***6789');
    expect(r!.vendorResolvedName).toBe('Mama Tola Foodstuffs');
    expect(r!.subWallet).toEqual({ id: sw.sub.id, name: "Tunde's allowance" });
    expect(r!.initiatedBy.userId).toBe(agent.id);
    expect(r!.initiatedBy.role).toBe('agent');
    expect(r!.initiatedBy.displayName).toBe("Tunde's allowance");
    expect(r!.nibssSessionId).toBe('100005031234567890');
    expect(r!.agentNote).toBe('Groceries for the week');
    expect(r!.settledAt).not.toBeNull();
    expect(r!.errorMessage).toBeNull();
    expect(r!.anomalyScore).toBeNull();
    expect(r!.geolocation).toBeNull();
  });

  it('returns subWallet=null and principal role for a direct-spend txn', async () => {
    const { principal, mw } = await setup();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: null,
      kind: 'spend',
      amountKobo: 1000n as never,
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '1234567890',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    const r = await transactionDetailService.getByIdForPrincipal(testDb, txn.id, principal.id);
    expect(r).not.toBeNull();
    expect(r!.subWallet).toBeNull();
    expect(r!.initiatedBy.userId).toBe(principal.id);
    expect(r!.initiatedBy.role).toBe('principal');
    expect(r!.initiatedBy.displayName).toBe(principal.phone);
  });

  it('returns errorMessage for a failed txn', async () => {
    const { principal, mw, sw } = await setup();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: 500n as never,
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    await testDb.execute(
      sql`UPDATE transactions SET status='failed', error_message='INSUFFICIENT_FUNDS' WHERE id = ${txn.id}`,
    );
    const r = await transactionDetailService.getByIdForPrincipal(testDb, txn.id, principal.id);
    expect(r!.status).toBe('failed');
    expect(r!.errorMessage).toBe('INSUFFICIENT_FUNDS');
  });

  it('returns anomaly score as a plain number (not the Drizzle decimal string)', async () => {
    const { principal, mw, sw } = await setup();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: 5000n as never,
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    await testDb.execute(sql`UPDATE transactions SET anomaly_score = 0.91 WHERE id = ${txn.id}`);
    const r = await transactionDetailService.getByIdForPrincipal(testDb, txn.id, principal.id);
    expect(typeof r!.anomalyScore).toBe('number');
    expect(r!.anomalyScore).toBeCloseTo(0.91, 2);
  });

  it('decodes geolocation to {lat, lng} when present', async () => {
    const { principal, mw, sw } = await setup();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: 100n as never,
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    await testDb.execute(sql`
      UPDATE transactions
      SET geolocation = ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)
      WHERE id = ${txn.id}
    `);
    const r = await transactionDetailService.getByIdForPrincipal(testDb, txn.id, principal.id);
    expect(r!.geolocation).not.toBeNull();
    expect(r!.geolocation!.lng).toBeCloseTo(3.3792, 4);
    expect(r!.geolocation!.lat).toBeCloseTo(6.5244, 4);
  });
});
