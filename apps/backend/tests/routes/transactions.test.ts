import type { TransactionDetail } from '@amana/types';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedFundedSubWallet() {
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
  return {
    masterId: mw.master.id,
    subWalletId: sw.sub.id,
    agentId: agent.id,
    agentUser: agent,
    principalId: principal.id,
  };
}

describe('POST /transactions/intent + evaluate', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('intent creates a DRAFT, evaluate moves to in_flight when no rules block', async () => {
    const { masterId, subWalletId, agentUser } = await seedFundedSubWallet();
    const app = createServer();
    const agentHeaders = await bearerHeaders(agentUser);
    const intentRes = await app.request('/transactions/intent', {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({
        masterWalletId: masterId,
        subWalletId,
        amountKobo: '5000',
        idempotencyKey: factories.idempotencyKey(),
        vendorBankCode: '058',
        vendorAccountNumber: '0123456789',
        vendorResolvedName: 'M',
        category: null,
        agentNote: null,
      }),
    });
    expect(intentRes.status).toBe(201);
    const intent = (await intentRes.json()) as { transactionId: string; status: string };
    expect(intent.status).toBe('draft');

    const evalRes = await app.request(`/transactions/${intent.transactionId}/evaluate`, {
      method: 'POST',
      headers: agentHeaders,
    });
    expect(evalRes.status).toBe(200);
    const evalBody = (await evalRes.json()) as { kind: string; status: string };
    expect(evalBody.kind).toBe('allow');
    expect(evalBody.status).toBe('in_flight');
  });

  it('rejects intent without bearer (401)', async () => {
    const { masterId, subWalletId } = await seedFundedSubWallet();
    const app = createServer();
    const res = await app.request('/transactions/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        masterWalletId: masterId,
        subWalletId,
        amountKobo: '5000',
        idempotencyKey: factories.idempotencyKey(),
        vendorBankCode: '058',
        vendorAccountNumber: '0123456789',
        vendorResolvedName: 'M',
        category: null,
        agentNote: null,
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_bearer' });
  });
});

async function scaffoldHousehold() {
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
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'A' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '0000000001',
    anchorBankCode: '050',
    anchorAccountId: 'a-1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: "Tunde's allowance",
  });
  return { principal, agent, hh, mw, sw };
}

describe('GET /transactions/:id', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('200 — returns enriched detail for a settled agent-initiated txn', async () => {
    const { principal, agent, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(12_300n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'Mama Tola',
      agentNote: 'Groceries',
    });
    await testDb.execute(
      sql`UPDATE transactions SET status='settled', settled_at=NOW(), nibss_session_id='100005031234567890' WHERE id = ${txn.id}`,
    );

    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}`, {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: TransactionDetail };
    expect(body.transaction.id).toBe(txn.id);
    expect(body.transaction.amountKobo).toBe('12300');
    expect(body.transaction.subWallet).toEqual({ id: sw.sub.id, name: "Tunde's allowance" });
    expect(body.transaction.initiatedBy.role).toBe('agent');
    expect(body.transaction.initiatedBy.userId).toBe(agent.id);
    expect(body.transaction.vendorAccountMasked).toBe('***6789');
    expect(body.transaction.nibssSessionId).toBe('100005031234567890');
  });

  it('200 — failed txn surfaces errorMessage, no settledAt', async () => {
    const { principal, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(500n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    await testDb.execute(
      sql`UPDATE transactions SET status='failed', error_message='INSUFFICIENT_FUNDS' WHERE id = ${txn.id}`,
    );

    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}`, {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: TransactionDetail };
    expect(body.transaction.status).toBe('failed');
    expect(body.transaction.errorMessage).toBe('INSUFFICIENT_FUNDS');
    expect(body.transaction.settledAt).toBeNull();
  });

  it('200 — bump_pending status comes through verbatim (mobile renders the CTA)', async () => {
    const { principal, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(100_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    await testDb.execute(sql`UPDATE transactions SET status='bump_pending' WHERE id = ${txn.id}`);
    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}`, {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: TransactionDetail };
    expect(body.transaction.status).toBe('bump_pending');
  });

  it('200 — reversed status comes through; v1 has no reversedAt field', async () => {
    const { principal, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(100n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    await testDb.execute(sql`UPDATE transactions SET status='reversed' WHERE id = ${txn.id}`);
    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}`, {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: TransactionDetail };
    expect(body.transaction.status).toBe('reversed');
  });

  it('200 — direct-spend txn returns subWallet=null and principal role', async () => {
    const { principal, mw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: null,
      kind: 'spend',
      amountKobo: kobo(1000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}`, {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: TransactionDetail };
    expect(body.transaction.subWallet).toBeNull();
    expect(body.transaction.initiatedBy.role).toBe('principal');
  });

  it('200 — vendor account is masked to last 4 on the wire', async () => {
    const { principal, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(100n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '9876543210',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}`, {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: TransactionDetail };
    expect(body.transaction.vendorAccountMasked).toBe('***3210');
  });

  it('200 — geolocation surfaces as {lat, lng} when captured', async () => {
    const { principal, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(100n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    await testDb.execute(sql`
      UPDATE transactions SET geolocation = ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326) WHERE id = ${txn.id}
    `);
    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}`, {
      headers: await bearerHeaders(principal),
    });
    const body = (await res.json()) as { transaction: TransactionDetail };
    expect(body.transaction.geolocation).not.toBeNull();
    expect(body.transaction.geolocation?.lng).toBeCloseTo(3.3792, 4);
    expect(body.transaction.geolocation?.lat).toBeCloseTo(6.5244, 4);
  });

  it('200 — anomaly score returns as plain number even below 0.85 threshold', async () => {
    const { principal, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(100n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    await testDb.execute(sql`UPDATE transactions SET anomaly_score = 0.42 WHERE id = ${txn.id}`);
    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}`, {
      headers: await bearerHeaders(principal),
    });
    const body = (await res.json()) as { transaction: TransactionDetail };
    expect(typeof body.transaction.anomalyScore).toBe('number');
    expect(body.transaction.anomalyScore).toBeCloseTo(0.42, 2);
  });

  it('403 — agent caller gets principal_only', async () => {
    const { agent, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(100n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('principal_only');
  });

  it('404 — unknown txn id returns not_found', async () => {
    const { principal } = await scaffoldHousehold();
    const app = createServer();
    const res = await app.request('/transactions/00000000-0000-0000-0000-000000000000', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('404 — txn exists but belongs to another household (no existence leak)', async () => {
    const { principal: alice } = await scaffoldHousehold();
    // Bob's household + txn.
    const bob = await usersRepo.insert(testDb, {
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
    const bobHh = await householdsRepo.insert(testDb, { principalUserId: bob.id, name: 'Bob' });
    const bobMw = await masterWalletsRepo.provision(testDb, {
      householdId: bobHh.id,
      anchorVirtualAccount: '0000000002',
      anchorBankCode: '050',
      anchorAccountId: 'b-1',
    });
    const bobSw = await subWalletsRepo.provision(testDb, {
      masterWalletId: bobMw.master.id,
      agentUserId: bobAgent.id,
      name: 'B',
    });
    const bobTxn = await transactionsRepo.insert(testDb, {
      masterWalletId: bobMw.master.id,
      subWalletId: bobSw.sub.id,
      kind: 'spend',
      amountKobo: kobo(100n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });
    const app = createServer();
    const res = await app.request(`/transactions/${bobTxn.id}`, {
      headers: await bearerHeaders(alice),
    });
    // CRITICAL: same code as unknown id, so callers can't probe other households' existence.
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });
});
