import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const app = createServer();

describe('GET /me/household feesCoveredKobo', () => {
  beforeEach(truncateAll);

  it('returns the lifetime sum of absorbed inflow fees', async () => {
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
      anchorVirtualAccount: 'VA-covered',
      anchorBankCode: '058',
      anchorAccountId: 'anchor-covered',
    });
    await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      kind: 'topup',
      amountKobo: kobo(1_000_000n),
      idempotencyKey: factories.idempotencyKey(),
      inflowFeeAbsorbedKobo: kobo(5_000n),
    });

    const res = await app.request('/me/household', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.masterWallet.feesCoveredKobo).toBe('5000');
  });

  it('is principal-only (agent gets 403)', async () => {
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const res = await app.request('/me/household', {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(403);
  });
});
