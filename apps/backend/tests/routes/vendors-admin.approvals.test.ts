// apps/backend/tests/routes/vendors-admin.approvals.test.ts
//
// Sub-plan A1 Task 4B. `approve-claim` mints a public code and assigns a business identity —
// it hands ownership of a bank account to whoever the operator names — so it now takes two admins.
//
// Only that one action is gated, and the reasoning is the same principle Task 3 settled on:
// **gate the direction that CREATES power, never the direction that removes it.**
//   - `suspend` is the anti-fraud kill switch. A quorum to stop a fraudulent vendor means the
//     fraud continues while a second operator is found.
//   - `consents/revoke` is the merchant's only withdrawal channel, and NDPA 2023 requires
//     withdrawal to be as easy as granting. Two-person control makes it strictly harder.
// Both therefore stay immediate, and there are tests below asserting they still are.
import { beforeEach, describe, expect, it } from 'vitest';
import { adminApprovalService } from '../../src/modules/admin/admin-approval.service';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { createServer } from '../../src/server';
import { signedInAdmin } from '../helpers/admin-session';
import { factories } from '../helpers/factories';
import { stubOidcProvider } from '../helpers/oidc-stub';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const app = createServer({ adminOidcProvider: stubOidcProvider() });

let maker: { cookie: string; adminUserId: string };
let checker: { cookie: string; adminUserId: string };

async function aPromotedVendor() {
  return vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'SHOP',
    promotedHouseholdCount: 6,
    now: NOW,
  });
}

function post(path: string, body: unknown, cookie: string) {
  return app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await truncateAll();
  maker = await signedInAdmin('ops1@amana-ng.com', ['ops']);
  checker = await signedInAdmin('ops2@amana-ng.com', ['ops']);
});

describe('approve-claim is maker-checked', () => {
  it('proposing does not claim the vendor', async () => {
    const vendor = await aPromotedVendor();
    if (!vendor) throw new Error('expected a promoted vendor');

    const res = await post(
      `/vendors-admin/vendors/${vendor.id}/approve-claim`,
      { phone: '+2348011112222', category: 'food' },
      maker.cookie,
    );

    expect(res.status).toBe(202);
    const { approvalId, status } = await res.json();
    expect(status).toBe('pending');
    // The whole point: an operator alone cannot assign a business identity.
    const after = await vendorsRepo.findById(testDb, vendor.id);
    expect(after?.status).not.toBe('claimed');
    expect(after?.publicCode ?? null).toBeNull();
    expect(approvalId).toBeTruthy();
  });

  it('a second ops admin approving it performs the claim', async () => {
    const vendor = await aPromotedVendor();
    if (!vendor) throw new Error('expected a promoted vendor');
    const proposed = await post(
      `/vendors-admin/vendors/${vendor.id}/approve-claim`,
      { phone: '+2348011112222', category: 'food' },
      maker.cookie,
    );
    const { approvalId } = await proposed.json();

    const decided = await post(`/admin/approvals/${approvalId}/approve`, {}, checker.cookie);
    expect(decided.status).toBe(200);

    const after = await vendorsRepo.findById(testDb, vendor.id);
    expect(after?.status).toBe('claimed');
    expect(after?.publicCode).toMatch(/^AMNV/);
    // The response carries the minted code, because the checker is the one who needs to read it
    // back to the merchant.
    expect((await decided.json()).publicCode).toBe(after?.publicCode);
  });

  it('refuses to let the maker approve their own claim proposal', async () => {
    const vendor = await aPromotedVendor();
    if (!vendor) throw new Error('expected a promoted vendor');
    const proposed = await post(
      `/vendors-admin/vendors/${vendor.id}/approve-claim`,
      { phone: '+2348011112222', category: 'food' },
      maker.cookie,
    );
    const { approvalId } = await proposed.json();

    const res = await post(`/admin/approvals/${approvalId}/approve`, {}, maker.cookie);
    expect(res.status).toBe(403);
    expect((await vendorsRepo.findById(testDb, vendor.id))?.status).not.toBe('claimed');
  });

  it('refuses a checker who cannot work the vendor registry', async () => {
    // Two people is only a control if both could have done it alone.
    const vendor = await aPromotedVendor();
    if (!vendor) throw new Error('expected a promoted vendor');
    const proposed = await post(
      `/vendors-admin/vendors/${vendor.id}/approve-claim`,
      { phone: '+2348011112222', category: 'food' },
      maker.cookie,
    );
    const { approvalId } = await proposed.json();

    const outsider = await signedInAdmin('iam@amana-ng.com', ['admin']);
    const res = await post(`/admin/approvals/${approvalId}/approve`, {}, outsider.cookie);
    expect(res.status).toBe(403);
  });

  it('re-checks at approval time that the vendor is still claimable', async () => {
    // Days can pass. If the vendor was suspended in the meantime, approving a stale proposal must
    // not quietly hand it to someone anyway.
    const vendor = await aPromotedVendor();
    if (!vendor) throw new Error('expected a promoted vendor');
    const proposed = await post(
      `/vendors-admin/vendors/${vendor.id}/approve-claim`,
      { phone: '+2348011112222', category: 'food' },
      maker.cookie,
    );
    const { approvalId } = await proposed.json();

    await post(`/vendors-admin/vendors/${vendor.id}/suspend`, {}, maker.cookie);

    const res = await post(`/admin/approvals/${approvalId}/approve`, {}, checker.cookie);
    expect(res.status).toBe(409);
  });

  it('does NOT extend the bootstrap self-approve exemption to vendor claims', async () => {
    // The exemption exists for one reason: without it the IAM bootstrap deadlocks, because the
    // config-seeded account is the only admin who could ever grant the first role. That reasoning
    // does not transfer to the vendor registry, where there is no deadlock to break — so the
    // break-glass account must NOT be able to hand itself a business identity alone.
    const boot = await signedInAdmin('david@amana-ng.com', ['ops']);
    const vendor = await aPromotedVendor();
    if (!vendor) throw new Error('expected a promoted vendor');

    const res = await post(
      `/vendors-admin/vendors/${vendor.id}/approve-claim`,
      { phone: '+2348011112222', category: 'food' },
      boot.cookie,
    );
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe('pending');
    expect((await vendorsRepo.findById(testDb, vendor.id))?.status).not.toBe('claimed');
  });

  it('records the proposal as a vendor_approve_claim approval', async () => {
    const vendor = await aPromotedVendor();
    if (!vendor) throw new Error('expected a promoted vendor');
    const proposed = await post(
      `/vendors-admin/vendors/${vendor.id}/approve-claim`,
      { phone: '+2348011112222', category: 'food' },
      maker.cookie,
    );
    const { approvalId } = await proposed.json();

    const row = await adminApprovalService.findById(testDb, approvalId);
    expect(row?.kind).toBe('vendor_approve_claim');
    expect(row?.makerAdminUserId).toBe(maker.adminUserId);
  });
});

describe('the destructive-but-protective actions stay immediate', () => {
  it('suspend takes effect with one admin — it is the anti-fraud kill switch', async () => {
    // Deliberately NOT maker-checked. Requiring a quorum to stop a fraudulent vendor means the
    // fraud keeps running while a second operator is found. Gate the direction that creates
    // power, not the one that removes it.
    const vendor = await aPromotedVendor();
    if (!vendor) throw new Error('expected a promoted vendor');

    const res = await post(`/vendors-admin/vendors/${vendor.id}/suspend`, {}, maker.cookie);
    expect(res.status).toBe(200);
    expect((await vendorsRepo.findById(testDb, vendor.id))?.status).toBe('suspended');
  });

  it('consent revocation takes effect with one admin — NDPA withdrawal must stay easy', async () => {
    // This endpoint is the merchant's ONLY withdrawal channel (there is no merchant-facing
    // session on this rail). NDPA 2023 requires withdrawal to be as easy as granting; a
    // two-person gate would make it strictly harder, and would leave a phoned-in withdrawal
    // pending until a second operator was available.
    const vendor = await aPromotedVendor();
    if (!vendor) throw new Error('expected a promoted vendor');

    const res = await post(
      `/vendors-admin/vendors/${vendor.id}/consents/revoke`,
      { purpose: 'lender_introduction' },
      maker.cookie,
    );
    expect(res.status).toBe(200);
  });
});
