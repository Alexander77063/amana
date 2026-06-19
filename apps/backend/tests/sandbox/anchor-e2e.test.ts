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

describe.skipIf(!process.env.ANCHOR_API_KEY)('Anchor sandbox — full payment loop', () => {
  it('provisions a real virtual account and processes KYC upgrade', async () => {
    await truncateAll();

    // Step 1 — Seed a principal directly (bypass OTP for speed)
    const phone = factories.phone();
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone,
      nin: factories.nin(),
      bvn: factories.bvn(),
      kycTier: '1',
    });

    // Step 2 — Get an access token via OTP bypass
    const otpReq = await apiRequest('POST', '/auth/otp/request', {
      body: { phone, purpose: 'login' },
    });
    expect(otpReq.status).toBe(200);

    const otpVerify = await apiRequest('POST', '/auth/otp/verify', {
      body: { phone, code: process.env.DEV_OTP_BYPASS_CODE ?? '000000' },
    });
    expect(otpVerify.status).toBe(200);
    const { accessToken } = otpVerify.body as { accessToken: string };

    // Step 3 — Create household (real Anchor createCustomer + provisionVirtualAccount)
    const hhRes = await apiRequest('POST', '/households', {
      token: accessToken,
      body: { name: 'Sandbox Family' },
    });
    expect(hhRes.status).toBe(201);
    const { household, masterWallet } = hhRes.body as {
      household: { id: string };
      masterWallet: { anchorVirtualAccount: string; anchorBankCode: string };
    };

    // Verify real virtual account was provisioned
    expect(masterWallet.anchorVirtualAccount).toMatch(/^\d{10}$/);
    expect(masterWallet.anchorBankCode).toBeTruthy();

    const updatedUser = await usersRepo.findById(testDb, principal.id);
    expect(updatedUser?.anchorCustomerId).toBeTruthy();

    const mw = await masterWalletsRepo.findByHousehold(testDb, household.id);
    expect(mw?.anchorAccountId).not.toMatch(/^placeholder-anchor-/);

    // Step 4 — Simulate a topup via webhook
    const nibssId = `sandbox-sess-${randomUUID()}`;
    const topupEvt = await simulateWebhook({
      id: `sandbox-topup-${randomUUID()}`,
      type: 'virtual_account.credited',
      createdAt: new Date().toISOString(),
      data: {
        virtualAccountId: mw?.anchorAccountId,
        amountKobo: '1000000',
        senderBankCode: '058',
        senderAccountNumber: factories.bankAccount(),
        senderAccountName: 'SANDBOX SENDER',
        nibssSessionId: nibssId,
      },
    });
    expect(topupEvt.status).toBe(200);

    const topupTxn = await transactionsRepo.findByIdempotencyKey(testDb, `topup:${nibssId}`);
    expect(topupTxn).toBeDefined();
    expect(topupTxn?.status).toBe('settled');

    // Step 5 — Simulate kyc.approved webhook and verify tier update
    const kycEvt = await simulateWebhook({
      id: `sandbox-kyc-${randomUUID()}`,
      type: 'kyc.approved',
      createdAt: new Date().toISOString(),
      data: {
        customerId: updatedUser?.anchorCustomerId,
        newKycLevel: 'TIER_2',
      },
    });
    expect(kycEvt.status).toBe(200);

    const tierUpdated = await usersRepo.findById(testDb, principal.id);
    expect(tierUpdated?.kycTier).toBe('2');
  }, 60_000);
});
