import { describe, expect, it } from 'vitest';
import {
	PLACEHOLDER_BANK_CODE,
	placeholderAnchorAccountForHousehold,
} from '../../src/lib/placeholder-anchor';

describe('placeholderAnchorAccountForHousehold', () => {
	it('returns a 10-digit virtual account', () => {
		const a = placeholderAnchorAccountForHousehold('11111111-1111-1111-1111-111111111111');
		expect(a.anchorVirtualAccount).toMatch(/^\d{10}$/);
		expect(a.anchorBankCode).toBe(PLACEHOLDER_BANK_CODE);
	});

	it('is deterministic for the same household ID', () => {
		const id = '22222222-2222-2222-2222-222222222222';
		const a = placeholderAnchorAccountForHousehold(id);
		const b = placeholderAnchorAccountForHousehold(id);
		expect(a).toEqual(b);
	});

	it('produces different accounts for different households', () => {
		const a = placeholderAnchorAccountForHousehold('11111111-1111-1111-1111-111111111111');
		const b = placeholderAnchorAccountForHousehold('33333333-3333-3333-3333-333333333333');
		expect(a.anchorVirtualAccount).not.toBe(b.anchorVirtualAccount);
	});
});
