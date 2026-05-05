import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { balanceService } from '../../../src/modules/wallet/balance.service';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('balanceService.accountBalanceForSubWallet', () => {
	beforeEach(async () => {
		await truncateAll();
	});

	it('returns 0 for a fresh sub-wallet', async () => {
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
			anchorVirtualAccount: '0123456789',
			anchorBankCode: '058',
			anchorAccountId: 'a-1',
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
			name: 'A',
		});
		expect(await balanceService.accountBalanceForSubWallet(testDb, sw.sub.id)).toBe(0n);
	});

	it('reflects topup posting (debit sub, credit suspense)', async () => {
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
			anchorVirtualAccount: '0123456789',
			anchorBankCode: '058',
			anchorAccountId: 'a-2',
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
			name: 'A',
		});
		const txn = await transactionsRepo.insert(testDb, {
			masterWalletId: mw.master.id,
			kind: 'topup',
			amountKobo: kobo(50_000n),
			idempotencyKey: factories.idempotencyKey(),
		});
		await ledgerService.writeDoubleEntry(testDb, txn.id, [
			{ ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(50_000n), creditKobo: kobo(0n) },
			{
				ledgerAccountId: mw.ledgerAccountIds.suspense,
				debitKobo: kobo(0n),
				creditKobo: kobo(50_000n),
			},
		]);
		expect(await balanceService.accountBalanceForSubWallet(testDb, sw.sub.id)).toBe(50_000n);
	});

	it('throws when sub-wallet has no ledger account', async () => {
		await expect(
			balanceService.accountBalanceForSubWallet(testDb, '00000000-0000-0000-0000-000000000000'),
		).rejects.toThrow(/no sub ledger-account/);
	});
});
