import { createHash } from 'node:crypto';

export type PlaceholderAnchorAccount = {
	anchorVirtualAccount: string;
	anchorBankCode: string;
	anchorAccountId: string;
};

export const PLACEHOLDER_BANK_CODE = '058';

export function placeholderAnchorAccountForHousehold(
	householdId: string,
): PlaceholderAnchorAccount {
	const digest = createHash('sha256').update(`amana:household:${householdId}`).digest('hex');
	const slice = digest.slice(0, 12);
	const num = Number.parseInt(slice, 16) % 10_000_000_000;
	const anchorVirtualAccount = String(num).padStart(10, '0');
	return {
		anchorVirtualAccount,
		anchorBankCode: PLACEHOLDER_BANK_CODE,
		anchorAccountId: `placeholder-anchor-${householdId}`,
	};
}
