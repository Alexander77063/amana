import type { TransactionDetail } from '@amana/types';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { flush, render, textContent } from '../../test/render';

const h = vi.hoisted(() => ({
  getById: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { transaction: { getById: h.getById } },
}));

import { TransactionDetailScreen } from './TransactionDetailScreen';

function baseTxn(overrides: Partial<TransactionDetail>): TransactionDetail {
  return {
    id: 't1',
    kind: 'topup',
    status: 'settled',
    amountKobo: '1000000',
    inflowFeeAbsorbedKobo: '5000',
    vendorResolvedName: null,
    vendorAccountMasked: null,
    vendorBankCode: null,
    category: null,
    subWallet: null,
    initiatedBy: { userId: 'p1', displayName: '+2348011112222', role: 'principal' },
    initiatedAt: '2026-07-01T10:00:00.000Z',
    settledAt: '2026-07-01T10:00:05.000Z',
    nibssSessionId: null,
    errorMessage: null,
    agentNote: null,
    anomalyScore: null,
    geolocation: null,
    ...overrides,
  };
}

function props(): ComponentProps<typeof TransactionDetailScreen> {
  return {
    navigation: { navigate: vi.fn(), goBack: vi.fn() },
    route: { params: { transactionId: 't1' }, key: 'k', name: 'TransactionDetail' },
  } as unknown as ComponentProps<typeof TransactionDetailScreen>;
}

async function renderResolved(txn: TransactionDetail) {
  h.getById.mockResolvedValue({ transaction: txn });
  const rendered = render(<TransactionDetailScreen {...props()} />);
  await flush();
  return rendered;
}

describe('TransactionDetailScreen — fee cover line', () => {
  it('shows "Bank fee covered" with the formatted fee for a top-up', async () => {
    const { root } = await renderResolved(
      baseTxn({ kind: 'topup', inflowFeeAbsorbedKobo: '5000' }),
    );
    expect(textContent(root)).toContain('Bank fee covered: ₦50.00 ✓');
  });

  it('hides the line for a top-up with zero absorbed fee', async () => {
    const { root } = await renderResolved(baseTxn({ kind: 'topup', inflowFeeAbsorbedKobo: '0' }));
    expect(textContent(root)).not.toContain('Bank fee covered');
  });

  it('hides the line for a spend', async () => {
    const { root } = await renderResolved(
      baseTxn({ kind: 'spend', inflowFeeAbsorbedKobo: null, vendorResolvedName: 'MTN' }),
    );
    expect(textContent(root)).not.toContain('Bank fee covered');
  });
});
