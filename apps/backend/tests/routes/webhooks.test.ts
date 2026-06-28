import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { txnIntentService } from '../../src/modules/transactions/txn-intent.service';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const SECRET = 'whsec_test';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

describe('POST /webhooks/anchor', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
  });

  it('200 + audit-log entry on a correctly-signed event', async () => {
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-1',
      type: 'transfer.completed',
      createdAt: '2026-05-03T00:00:00Z',
      data: { transferId: 't-1', reference: 'k-1', status: 'COMPLETED', nibssSessionId: '12345' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    const audit = await testDb.execute<{ subject_id: string; action: string }>(sql`
      SELECT subject_id, action FROM audit_log WHERE subject_kind = 'anchor_webhook'
    `);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('anchor.webhook.transfer.completed');
  });

  it('401 + no audit entry on bad signature', async () => {
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-2',
      type: 'transfer.completed',
      createdAt: '2026-05-03T00:00:00Z',
      data: {},
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': 'wrong' },
      body,
    });
    expect(res.status).toBe(401);
    const audit = await testDb.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM audit_log`,
    );
    expect(audit[0]?.count).toBe('0');
  });

  it('503 when ANCHOR_WEBHOOK_SECRET is not configured', async () => {
    // biome-ignore lint/performance/noDelete: must fully unset env var; undefined assignment leaves "undefined" string
    delete process.env.ANCHOR_WEBHOOK_SECRET;
    const app = createServer();
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': 'whatever' },
      body: '{}',
    });
    expect(res.status).toBe(503);
  });

  it('replay of the same event id is a no-op (idempotent on event.id)', async () => {
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-3',
      type: 'transfer.completed',
      createdAt: '2026-05-03T00:00:00Z',
      data: { transferId: 't-x', reference: 'k-x', status: 'COMPLETED' },
    });
    const headers = { 'content-type': 'application/json', 'x-anchor-signature': sign(body) };
    await app.request('/webhooks/anchor', { method: 'POST', headers, body });
    await app.request('/webhooks/anchor', { method: 'POST', headers, body });
    const audit = await testDb.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM audit_log WHERE action LIKE 'anchor.webhook.%'
    `);
    expect(audit[0]?.count).toBe('1'); // exactly one entry, not two
  });
});

async function seedInFlightTxn() {
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
    anchorVirtualAccount: 'VA-9999',
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-9999',
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
  // Top up master wallet so sub-wallet has spendable balance
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
  // Reservation (in-flight spend)
  const txn = await txnIntentService.create(testDb, {
    actorUserId: agent.id,
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n),
    idempotencyKey: 'k-spend-1',
    vendorBankCode: '058',
    vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M',
    category: null,
    agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  await ledgerService.writeDoubleEntry(testDb, txn.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(5_000n), creditKobo: kobo(0n) },
    {
      ledgerAccountId: mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(5_000n),
    },
  ]);
  return { txnId: txn.id, virtualAccount: 'anchor-acct-9999', subLA: sw.ledgerAccountId };
}

describe('POST /webhooks/anchor — dispatch', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
  });

  it('transfer.completed → settles the matching txn', async () => {
    const { txnId } = await seedInFlightTxn();
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-tc-1',
      type: 'transfer.completed',
      createdAt: '2026-05-03T12:00:30Z',
      data: {
        transferId: 'tr-1',
        reference: 'k-spend-1',
        status: 'COMPLETED',
        nibssSessionId: 'sess-1',
      },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    expect(res.status).toBe(200);
    const settled = await transactionsRepo.findById(testDb, txnId);
    expect(settled?.status).toBe('settled');
  });

  it('transfer.failed → reverses the matching txn', async () => {
    const { txnId, subLA } = await seedInFlightTxn();
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-tf-1',
      type: 'transfer.failed',
      createdAt: '2026-05-03T12:00:30Z',
      data: {
        transferId: 'tr-1',
        reference: 'k-spend-1',
        status: 'FAILED',
        failureReason: 'closed',
      },
    });
    await app.request('/webhooks/anchor', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    const failed = await transactionsRepo.findById(testDb, txnId);
    expect(failed?.status).toBe('failed');
    // Sub balance was 100K (topup) - 5K (reservation) = 95K net debit.
    // After reversal the 5K is credited back → net debit = 100K again.
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(100_000n);
  });

  it('kyc.approved TIER_2 → updates user kycTier to 2', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
      bvn: factories.bvn(),
    });
    await usersRepo.setAnchorCustomerId(testDb, user.id, 'anchor-cust-kyc-1');
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-kyc-1',
      type: 'kyc.approved',
      createdAt: new Date().toISOString(),
      data: { customerId: 'anchor-cust-kyc-1', newKycLevel: 'TIER_2' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    const updated = await usersRepo.findById(testDb, user.id);
    expect(updated?.kycTier).toBe('2');
  });

  it('kyc.approved TIER_3 → updates user kycTier to 3', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    await usersRepo.setAnchorCustomerId(testDb, user.id, 'anchor-cust-kyc-2');
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-kyc-2',
      type: 'kyc.approved',
      createdAt: new Date().toISOString(),
      data: { customerId: 'anchor-cust-kyc-2', newKycLevel: 'TIER_3' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    const updated = await usersRepo.findById(testDb, user.id);
    expect(updated?.kycTier).toBe('3');
  });

  it('kyc.rejected → 200 ack, kycTier unchanged', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
      bvn: factories.bvn(),
    });
    await usersRepo.setAnchorCustomerId(testDb, user.id, 'anchor-cust-kyc-3');
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-kyc-3',
      type: 'kyc.rejected',
      createdAt: new Date().toISOString(),
      data: { customerId: 'anchor-cust-kyc-3', reason: 'BVN mismatch' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    const updated = await usersRepo.findById(testDb, user.id);
    expect(updated?.kycTier).toBe('1');
  });

  it('kyc.approved with unknown customerId → 200 ack, no crash', async () => {
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-kyc-4',
      type: 'kyc.approved',
      createdAt: new Date().toISOString(),
      data: { customerId: 'anchor-cust-unknown', newKycLevel: 'TIER_2' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
      body,
    });
    expect(res.status).toBe(200);
  });

  it('virtual_account.credited → topup booked', async () => {
    const { virtualAccount } = await seedInFlightTxn();
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-vc-1',
      type: 'virtual_account.credited',
      createdAt: '2026-05-03T12:00:30Z',
      data: {
        virtualAccountId: virtualAccount,
        amountKobo: '50000',
        senderBankCode: '058',
        senderAccountNumber: '0001112223',
        senderAccountName: 'SENDER',
        nibssSessionId: 'sess-topup-1',
      },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    expect(res.status).toBe(200);
    // Verify a topup transaction exists with the expected idempotency key
    const topup = await transactionsRepo.findByIdempotencyKey(testDb, 'topup:sess-topup-1');
    expect(topup).toBeDefined();
    expect(topup?.amountKobo).toBe(50_000n);
    expect(topup?.status).toBe('settled');
  });
});
