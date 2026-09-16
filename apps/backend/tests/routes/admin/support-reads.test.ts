import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ruleSetsRepo } from '../../../src/modules/rules/rule-sets.repo';
import { rulesRepo } from '../../../src/modules/rules/rules.repo';
import { supportVerificationsRepo } from '../../../src/modules/support';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { createServer } from '../../../src/server';
import { signedInAdmin } from '../../helpers/admin-session';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const app = createServer();

const FULL_ACCOUNT = '9988776655';

async function seedHousehold() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, {
    principalUserId: principal.id,
    name: 'Adegbola',
  });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: FULL_ACCOUNT,
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-support',
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
  return { principal, agent, household: hh, masterWallet: mw.master, subWallet: sw.sub };
}

async function verifiedSessionFor(adminUserId: string, userId: string, sessionEnd?: Date) {
  const row = await supportVerificationsRepo.create(testDb, {
    adminUserId,
    phoneE164: factories.phone(),
    userId,
    rail: 'push',
    matchNumber: 42,
    codeHash: null,
    expiresAt: new Date(Date.now() + 180_000),
  });
  await supportVerificationsRepo.markVerified(
    testDb,
    row.id,
    sessionEnd ?? new Date(Date.now() + 900_000),
  );
  return row;
}

describe('support reads', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('masks the account and returns nothing that identifies the customer', async () => {
    const { cookie, adminUserId } = await signedInAdmin('rd1@amana-ng.com', ['support']);
    const { principal } = await seedHousehold();
    const row = await verifiedSessionFor(adminUserId, principal.id);

    const res = await app.request(`/admin/support/verifications/${row.id}/overview`, {
      headers: { cookie },
    });
    const raw = await res.text();

    expect(res.status).toBe(200);
    // Asserted against the RAW body, not a parsed object: a field nested somewhere unexpected is
    // still a leak, and parsing would hide it.
    for (const forbidden of ['bvn', 'nin', 'fullName', 'address', 'dateOfBirth', FULL_ACCOUNT]) {
      expect(raw).not.toContain(forbidden);
    }
    expect(JSON.parse(raw).maskedAccount).toBe('••••6655');
  });

  it('refuses the read once the session has expired', async () => {
    const { cookie, adminUserId } = await signedInAdmin('rd2@amana-ng.com', ['support']);
    const { principal } = await seedHousehold();
    const row = await verifiedSessionFor(adminUserId, principal.id, new Date(Date.now() - 1000));

    const res = await app.request(`/admin/support/verifications/${row.id}/overview`, {
      headers: { cookie },
    });

    expect(res.status).toBe(403);
  });

  it('refuses a different operator holding the same verification id', async () => {
    const owner = await signedInAdmin('rd3@amana-ng.com', ['support']);
    const other = await signedInAdmin('rd4@amana-ng.com', ['support']);
    const { principal } = await seedHousehold();
    const row = await verifiedSessionFor(owner.adminUserId, principal.id);

    const res = await app.request(`/admin/support/verifications/${row.id}/overview`, {
      headers: { cookie: other.cookie },
    });

    expect(res.status).toBe(403);
  });

  it('refuses an operator without support.read', async () => {
    const { cookie, adminUserId } = await signedInAdmin('rd6@amana-ng.com', ['ops']);
    const { principal } = await seedHousehold();
    // The ops operator cannot start one, so seed the row directly against them.
    const row = await verifiedSessionFor(adminUserId, principal.id);

    const res = await app.request(`/admin/support/verifications/${row.id}/overview`, {
      headers: { cookie },
    });

    expect(res.status).toBe(403);
  });

  it('writes an audit row naming the operator and the verification', async () => {
    const { cookie, adminUserId } = await signedInAdmin('rd5@amana-ng.com', ['support']);
    const { principal } = await seedHousehold();
    const row = await verifiedSessionFor(adminUserId, principal.id);

    await app.request(`/admin/support/verifications/${row.id}/transactions`, {
      headers: { cookie },
    });

    const { auditRepo } = await import('../../../src/modules/audit');
    const entries = await auditRepo.listBySubject(testDb, row.id);
    const read = entries.find((e) => e.action === 'support.read.transactions');

    expect(read?.actorAdminUserId).toBe(adminUserId);
  });

  // The one that would be easy to get wrong: an allowlist rule's config holds vendor ACCOUNT
  // NUMBERS. Echoing configJson would leak exactly what this feature exists to withhold.
  it('summarises rules without echoing an allowlist’s account numbers', async () => {
    const { cookie, adminUserId } = await signedInAdmin('rd7@amana-ng.com', ['support']);
    const { principal, subWallet } = await seedHousehold();
    // Rule sets hang off a SUB-WALLET, not a household.
    const set = await ruleSetsRepo.insert(testDb, {
      subWalletId: subWallet.id,
      version: 1,
      createdByUserId: principal.id,
    });
    await rulesRepo.insertMany(testDb, set.id, [
      {
        kind: 'allowlist',
        priority: 10,
        config: {
          accounts: [
            { bankCode: '058', accountNumber: '0123456789' },
            { bankCode: '058', accountNumber: '0987654321' },
          ],
        },
      },
    ]);
    const row = await verifiedSessionFor(adminUserId, principal.id);

    const res = await app.request(`/admin/support/verifications/${row.id}/rules`, {
      headers: { cookie },
    });
    const raw = await res.text();

    expect(res.status).toBe(200);
    expect(raw).not.toContain('0123456789');
    expect(raw).not.toContain('0987654321');
    expect(JSON.parse(raw).rules[0].kind).toBe('allowlist');
  });

  // A top-up carries NO sub-wallet, so scoping a principal's reads by sub-wallet ids hides every
  // one of them — and "my transfer hasn't arrived" is the commonest reason anyone phones support.
  it('shows a principal their top-ups, which belong to no sub-wallet', async () => {
    const { cookie, adminUserId } = await signedInAdmin('rd9@amana-ng.com', ['support']);
    const { principal, masterWallet } = await seedHousehold();
    await transactionsRepo.insert(testDb, {
      masterWalletId: masterWallet.id,
      kind: 'topup',
      amountKobo: 500000n,
      idempotencyKey: factories.idempotencyKey(),
    });
    const row = await verifiedSessionFor(adminUserId, principal.id);

    const res = await app.request(`/admin/support/verifications/${row.id}/transactions`, {
      headers: { cookie },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].kind).toBe('topup');
  });

  it('lists the household sub-wallets on the overview', async () => {
    const { cookie, adminUserId } = await signedInAdmin('rd8@amana-ng.com', ['support']);
    const { principal } = await seedHousehold();
    const row = await verifiedSessionFor(adminUserId, principal.id);

    const res = await app.request(`/admin/support/verifications/${row.id}/overview`, {
      headers: { cookie },
    });
    const body = await res.json();

    expect(body.subWallets).toHaveLength(1);
    expect(body.subWallets[0].name).toBe('Driver');
    expect(body.subWallets[0].status).toBe('active');
  });
});
