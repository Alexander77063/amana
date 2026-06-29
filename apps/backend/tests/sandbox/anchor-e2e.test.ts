import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';
import { simulateWebhook } from './helpers/anchor-sim';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

async function apiRequest(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

type MasterWalletResp = {
  id: string;
  anchorVirtualAccount: string;
  anchorBankCode: string;
};

/**
 * Seed a principal, authenticate via OTP bypass, and create a household — which does
 * a REAL Anchor createCustomer + provisionVirtualAccount. Returns everything the
 * payment-loop steps need. Asserts the real provisioning along the way.
 */
async function provisionPrincipal(): Promise<{
  principalId: string;
  accessToken: string;
  householdId: string;
  masterWallet: MasterWalletResp;
  anchorAccountId: string;
  anchorCustomerId: string;
}> {
  const phone = factories.phone();
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone,
    nin: factories.nin(),
    bvn: factories.bvn(),
    kycTier: '1',
  });

  const otpReq = await apiRequest('POST', '/auth/otp/request', {
    body: { phone, purpose: 'login' },
  });
  expect(otpReq.status).toBe(200);

  const otpVerify = await apiRequest('POST', '/auth/otp/verify', {
    body: { phone, code: process.env.DEV_OTP_BYPASS_CODE ?? '000000' },
  });
  expect(otpVerify.status).toBe(200);
  const { accessToken } = otpVerify.body as { accessToken: string };

  const hhRes = await apiRequest('POST', '/households', {
    token: accessToken,
    body: { name: 'Sandbox Family' },
  });
  expect(hhRes.status).toBe(201);
  const { household, masterWallet } = hhRes.body as {
    household: { id: string };
    masterWallet: MasterWalletResp;
  };

  // Real virtual account was provisioned (10-digit NUBAN, non-placeholder account id).
  expect(masterWallet.anchorVirtualAccount).toMatch(/^\d{10}$/);
  expect(masterWallet.anchorBankCode).toBeTruthy();

  const updatedUser = await usersRepo.findById(testDb, principal.id);
  expect(updatedUser?.anchorCustomerId).toBeTruthy();

  const mw = await masterWalletsRepo.findByHousehold(testDb, household.id);
  expect(mw?.anchorAccountId).not.toMatch(/^placeholder-anchor-/);

  return {
    principalId: principal.id,
    accessToken,
    householdId: household.id,
    masterWallet,
    anchorAccountId: mw?.anchorAccountId as string,
    anchorCustomerId: updatedUser?.anchorCustomerId as string,
  };
}

/** Simulate an inbound NIP credit to the master's virtual account → topup settled. */
async function simulateTopup(anchorAccountId: string, amountKobo: string): Promise<string> {
  const nibssId = `sandbox-sess-${randomUUID()}`;
  const evt = await simulateWebhook({
    id: `sandbox-topup-${randomUUID()}`,
    type: 'virtual_account.credited',
    createdAt: new Date().toISOString(),
    data: {
      virtualAccountId: anchorAccountId,
      amountKobo,
      senderBankCode: '058',
      senderAccountNumber: factories.bankAccount(),
      senderAccountName: 'SANDBOX SENDER',
      nibssSessionId: nibssId,
    },
  });
  expect(evt.status).toBe(200);
  return nibssId;
}

describe.skipIf(!process.env.ANCHOR_API_KEY)('Anchor sandbox — full payment loop', () => {
  it('provisions a real virtual account, settles a topup, and processes KYC upgrade', async () => {
    await truncateAll();
    const ctx = await provisionPrincipal();

    // Topup via simulated inbound-credit webhook → settled in our ledger.
    const nibssId = await simulateTopup(ctx.anchorAccountId, '1000000');
    const topupTxn = await transactionsRepo.findByIdempotencyKey(testDb, `topup:${nibssId}`);
    expect(topupTxn).toBeDefined();
    expect(topupTxn?.status).toBe('settled');

    // kyc.approved webhook → tier bumped to 2.
    const kycEvt = await simulateWebhook({
      id: `sandbox-kyc-${randomUUID()}`,
      type: 'kyc.approved',
      createdAt: new Date().toISOString(),
      data: { customerId: ctx.anchorCustomerId, newKycLevel: 'TIER_2' },
    });
    expect(kycEvt.status).toBe(200);

    const tierUpdated = await usersRepo.findById(testDb, ctx.principalId);
    expect(tierUpdated?.kycTier).toBe('2');
  }, 60_000);

  it('sends a REAL outbound NIP transfer (principal-direct) and settles it', async () => {
    await truncateAll();
    const ctx = await provisionPrincipal();

    // Back the spend with ledger funds (limits-only model means send does not gate on a
    // ledger balance, but we top up so the household has economic backing end-to-end).
    await simulateTopup(ctx.anchorAccountId, '5000000');

    // Principal-direct spend (subWalletId: null → no sub-wallet, no rule evaluation).
    // Vendor + amount are env-overridable so the operator can point at whatever account
    // Anchor's sandbox accepts as a transfer destination.
    const idempotencyKey = `sandbox-spend-${randomUUID()}`;
    const intent = await apiRequest('POST', '/transactions/intent', {
      token: ctx.accessToken,
      body: {
        masterWalletId: ctx.masterWallet.id,
        subWalletId: null,
        amountKobo: process.env.SANDBOX_SPEND_KOBO ?? '200000', // ₦2,000
        idempotencyKey,
        vendorBankCode: process.env.SANDBOX_VENDOR_BANK_CODE ?? '058',
        vendorAccountNumber: process.env.SANDBOX_VENDOR_ACCOUNT ?? '0123456789',
        vendorResolvedName: process.env.SANDBOX_VENDOR_NAME ?? 'SANDBOX VENDOR',
        category: null,
        agentNote: null,
      },
    });
    expect(intent.status).toBe(201);
    const { transactionId } = intent.body as { transactionId: string };

    // Direct spend evaluates to allow immediately (no rules) → in_flight.
    const evalRes = await apiRequest('POST', `/transactions/${transactionId}/evaluate`, {
      token: ctx.accessToken,
    });
    expect(evalRes.status).toBe(200);
    expect((evalRes.body as { kind: string }).kind).toBe('allow');

    // The real Anchor /transfers call.
    const sendRes = await apiRequest('POST', `/transactions/${transactionId}/send`, {
      token: ctx.accessToken,
    });
    expect(sendRes.status).toBe(202);
    const send = sendRes.body as { anchorTransferId: string | null; status: string };
    // Anchor accepted the transfer. PENDING is the normal async outcome; COMPLETED also fine.
    // FAILED means Anchor rejected synchronously — most likely the sandbox account is unfunded
    // or the destination is invalid; fund/override per docs/runbook/go-live-checklist.md.
    expect(
      send.status,
      `Anchor /transfers rejected the spend (status=${send.status}). If insufficient-balance, fund the sandbox master account or override SANDBOX_VENDOR_*.`,
    ).not.toBe('FAILED');
    expect(send.anchorTransferId).toBeTruthy();

    // Drive settlement deterministically via the transfer.completed webhook
    // (handler matches on data.reference === transaction.idempotencyKey).
    const completed = await simulateWebhook({
      id: `sandbox-complete-${randomUUID()}`,
      type: 'transfer.completed',
      createdAt: new Date().toISOString(),
      data: { reference: idempotencyKey, nibssSessionId: `sandbox-settle-${randomUUID()}` },
    });
    expect(completed.status).toBe(200);

    const settled = await transactionsRepo.findById(testDb, transactionId);
    expect(settled?.status).toBe('settled');
  }, 60_000);
});
