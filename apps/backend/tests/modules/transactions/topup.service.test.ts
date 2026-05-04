import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { topupService } from '../../../src/modules/transactions/topup.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedMaster() {
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
    anchorVirtualAccount: '9999000099',
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-9999',
  });
  return { masterId: mw.master.id, masterLA: mw.ledgerAccountIds.master, va: 'anchor-acct-9999' };
}

describe('topupService.handle', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('books the credit + master LA gains the amount', async () => {
    const { masterLA, va } = await seedMaster();
    const result = await topupService.handle(testDb, {
      virtualAccountId: va,
      amountKobo: kobo(50_000n),
      nibssSessionId: '111222333',
      senderBankCode: '058',
      senderAccountNumber: '0001112223',
      senderAccountName: 'SENDER',
      receivedAt: new Date('2026-05-03T12:00:00Z'),
    });
    expect(result.kind).toBe('created');
    const bal = await postingsRepo.accountBalance(testDb, masterLA);
    expect(bal).toBe(50_000n);
  });

  it('idempotent on nibss session id (replay returns duplicate)', async () => {
    const { masterLA, va } = await seedMaster();
    await topupService.handle(testDb, {
      virtualAccountId: va,
      amountKobo: kobo(50_000n),
      nibssSessionId: 'abc',
      senderBankCode: '058',
      senderAccountNumber: '0001112223',
      senderAccountName: 'SENDER',
      receivedAt: new Date('2026-05-03T12:00:00Z'),
    });
    const second = await topupService.handle(testDb, {
      virtualAccountId: va,
      amountKobo: kobo(50_000n),
      nibssSessionId: 'abc',
      senderBankCode: '058',
      senderAccountNumber: '0001112223',
      senderAccountName: 'SENDER',
      receivedAt: new Date('2026-05-03T12:00:30Z'),
    });
    expect(second.kind).toBe('duplicate');
    // Master balance is still 50K, not 100K.
    expect(await postingsRepo.accountBalance(testDb, masterLA)).toBe(50_000n);
  });

  it('returns unknown_account when no master_wallet matches the virtual account', async () => {
    const result = await topupService.handle(testDb, {
      virtualAccountId: 'nope-no-match',
      amountKobo: kobo(1n),
      nibssSessionId: 'x',
      senderBankCode: '058',
      senderAccountNumber: '0',
      senderAccountName: 'X',
      receivedAt: new Date(),
    });
    expect(result.kind).toBe('unknown_account');
  });
});
