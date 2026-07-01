import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { topupService } from '../../../src/modules/transactions/topup.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('topupService records the absorbed inflow fee', () => {
  beforeEach(truncateAll);

  it('stores 0.5%-capped fee on the topup transaction', async () => {
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
      anchorVirtualAccount: 'VA-fee-1',
      anchorBankCode: '058',
      anchorAccountId: 'anchor-fee-1',
    });

    const result = await topupService.handle(testDb, {
      virtualAccountId: 'anchor-fee-1',
      amountKobo: kobo(4_000_000n), // ₦40,000 -> ₦200 fee
      nibssSessionId: factories.nibssSessionId(),
      senderBankCode: '011',
      senderAccountNumber: '0000000001',
      senderAccountName: 'Funder',
      receivedAt: new Date('2026-07-01T00:00:00Z'),
    });

    expect(result.kind).toBe('created');
    const total = await transactionsRepo.sumInflowFeesAbsorbed(testDb, mw.master.id);
    expect(total).toBe(kobo(20_000n)); // ₦200
  });
});
