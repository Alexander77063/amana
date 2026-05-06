import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { bumpRequestsRepo } from '../../../src/modules/bumps/bump-requests.repo';
import { bumpWorkflowService } from '../../../src/modules/bumps/bump-workflow.service';
import { oneShotTokensRepo } from '../../../src/modules/bumps/one-shot-tokens.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedTxn() {
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
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    kind: 'spend',
    amountKobo: kobo(50_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  return {
    principalId: principal.id,
    agentId: agent.id,
    subWalletId: sw.sub.id,
    txnId: txn.id,
  };
}

describe('bump_requests + one_shot_tokens (schema)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('bump_requests has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bump_requests' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id',
      'transaction_id',
      'sub_wallet_id',
      'requested_by_user_id',
      'amount_kobo',
      'vendor_resolved_name',
      'agent_note',
      'status',
      'expires_at',
      'decided_by_user_id',
      'decided_at',
      'created_at',
    ]);
  });

  it('one_shot_tokens has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'one_shot_tokens' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'token',
      'bump_request_id',
      'consumed_at',
      'expires_at',
      'created_at',
    ]);
  });
});

describe('bumpRequestsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('insert + findById', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpRequestsRepo.insert(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      expiresAt: new Date('2026-05-03T13:00:00Z'),
    });
    const fetched = await bumpRequestsRepo.findById(testDb, created.id);
    expect(fetched?.status).toBe('pending');
  });

  it('setDecision updates status + decidedBy/At', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpRequestsRepo.insert(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      expiresAt: new Date('2026-05-03T13:00:00Z'),
    });
    const decidedAt = new Date('2026-05-03T12:30:00Z');
    await bumpRequestsRepo.setDecision(testDb, created.id, 'approved_once', principalId, decidedAt);
    const fetched = await bumpRequestsRepo.findById(testDb, created.id);
    expect(fetched?.status).toBe('approved_once');
    expect(fetched?.decidedByUserId).toBe(principalId);
    expect(fetched?.decidedAt?.toISOString()).toBe(decidedAt.toISOString());
  });

  it('listExpired finds pending requests past expiresAt', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    await bumpRequestsRepo.insert(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      expiresAt: new Date('2026-05-03T11:00:00Z'),
    });
    const expired = await bumpRequestsRepo.listExpired(testDb, new Date('2026-05-03T12:00:00Z'));
    expect(expired).toHaveLength(1);
  });
});

describe('oneShotTokensRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('insert + tryConsume succeeds the first time, fails the second', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    const bump = await bumpRequestsRepo.insert(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      expiresAt: new Date('2026-05-03T13:00:00Z'),
    });
    await oneShotTokensRepo.insert(testDb, {
      token: 'tok-1',
      bumpRequestId: bump.id,
      expiresAt: new Date('2026-05-03T13:00:00Z'),
    });
    const first = await oneShotTokensRepo.tryConsume(
      testDb,
      'tok-1',
      new Date('2026-05-03T12:30:00Z'),
    );
    expect(first).toBeDefined();
    const second = await oneShotTokensRepo.tryConsume(
      testDb,
      'tok-1',
      new Date('2026-05-03T12:31:00Z'),
    );
    expect(second).toBeUndefined();
  });
});

async function seedBumpAt(now: Date) {
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
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    kind: 'spend',
    amountKobo: kobo(50_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  const created = await bumpWorkflowService.create(testDb, {
    transactionId: txn.id,
    subWalletId: sw.sub.id,
    requestedByUserId: agent.id,
    amountKobo: kobo(50_000n),
    vendorResolvedName: 'M',
    now,
  });
  return { principal, agent, bumpId: created.bumpRequest.id };
}

describe('bumpRequestsRepo.findForPrincipal', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns pending bumps for the principal', async () => {
    const now = new Date();
    const { principal, bumpId } = await seedBumpAt(now);
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: principal.id,
      now,
    });
    expect(r.pending.map((b) => b.id)).toContain(bumpId);
    expect(r.history).toHaveLength(0);
  });

  it('moves a decided bump from pending to history', async () => {
    const now = new Date();
    const { principal, bumpId } = await seedBumpAt(now);
    await bumpWorkflowService.decide(testDb, {
      bumpRequestId: bumpId,
      decidedByUserId: principal.id,
      decision: 'deny',
      now,
    });
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: principal.id,
      now,
    });
    expect(r.pending).toHaveLength(0);
    expect(r.history.map((b) => b.id)).toContain(bumpId);
    expect(r.history[0]?.status).toBe('denied');
  });

  it('excludes bumps decided more than 30 days ago from history', async () => {
    const now = new Date();
    const { principal, bumpId } = await seedBumpAt(now);
    await bumpWorkflowService.decide(testDb, {
      bumpRequestId: bumpId,
      decidedByUserId: principal.id,
      decision: 'deny',
      now,
    });
    // The DB sets decidedAt to the wall-clock time of the decide call, which is
    // always "now" — back-date it directly so we can verify the cutoff.
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60_000);
    const fortyDaysAgoIso = fortyDaysAgo.toISOString();
    await testDb.execute(sql`
      UPDATE bump_requests
      SET decided_at = ${fortyDaysAgoIso}::timestamptz, created_at = ${fortyDaysAgoIso}::timestamptz
      WHERE id = ${bumpId}
    `);
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: principal.id,
      now,
    });
    expect(r.history).toHaveLength(0);
  });

  it('returns empty lists for a principal whose household has no bumps', async () => {
    const lonelyPrincipal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: lonelyPrincipal.id,
      now: new Date(),
    });
    expect(r.pending).toHaveLength(0);
    expect(r.history).toHaveLength(0);
  });

  it("does not leak bumps from another principal's household", async () => {
    const now = new Date();
    await seedBumpAt(now); // principal A
    const principalB = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: principalB.id,
      now,
    });
    expect(r.pending).toHaveLength(0);
    expect(r.history).toHaveLength(0);
  });

  it('hides pending bumps whose expiry has passed but have not been swept yet', async () => {
    const now = new Date();
    const { principal, bumpId } = await seedBumpAt(now);
    // Force the bump's expiresAt into the past WITHOUT changing its status.
    // Models the race window between expiry and the bump-ttl-sweep cron.
    const oneMinuteAgo = new Date(now.getTime() - 60_000);
    await testDb.execute(sql`
      UPDATE bump_requests
      SET expires_at = ${oneMinuteAgo.toISOString()}::timestamptz
      WHERE id = ${bumpId}
    `);
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: principal.id,
      now,
    });
    expect(r.pending).toHaveLength(0);
    expect(r.history).toHaveLength(0);
  });
});
