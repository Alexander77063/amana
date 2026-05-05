import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { bumpRequestsRepo } from '../../../src/modules/bumps/bump-requests.repo';
import { bumpWorkflowService } from '../../../src/modules/bumps/bump-workflow.service';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

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
    await testDb.execute(sql`
      UPDATE bump_requests
      SET decided_at = ${fortyDaysAgo}, created_at = ${fortyDaysAgo}
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

  it('does not leak bumps from another principal\'s household', async () => {
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
});
