import { describe, expect, it } from 'vitest';
import { deepLinkFor } from './deep-link';

describe('deepLinkFor', () => {
  it('returns bump deep-link for bump_requested with bumpRequestId', () => {
    expect(deepLinkFor('bump_requested', { bumpRequestId: 'br-1' })).toEqual({
      kind: 'bump',
      bumpRequestId: 'br-1',
    });
  });

  it('returns bump deep-link for bump_decided with bumpRequestId', () => {
    expect(deepLinkFor('bump_decided', { bumpRequestId: 'br-2' })).toEqual({
      kind: 'bump',
      bumpRequestId: 'br-2',
    });
  });

  it('returns transaction deep-link for txn_settled with transactionId + subWalletId', () => {
    expect(deepLinkFor('txn_settled', { transactionId: 'txn-1', subWalletId: 'sw-1' })).toEqual({
      kind: 'transaction',
      transactionId: 'txn-1',
      subWalletId: 'sw-1',
    });
  });

  it('returns transaction deep-link for txn_failed', () => {
    expect(deepLinkFor('txn_failed', { transactionId: 'txn-2', subWalletId: 'sw-2' })).toEqual({
      kind: 'transaction',
      transactionId: 'txn-2',
      subWalletId: 'sw-2',
    });
  });

  it('returns transaction deep-link for anomaly_alert', () => {
    expect(deepLinkFor('anomaly_alert', { transactionId: 'txn-3', subWalletId: 'sw-3' })).toEqual({
      kind: 'transaction',
      transactionId: 'txn-3',
      subWalletId: 'sw-3',
    });
  });

  it('returns transaction deep-link for refund_received (using refundTransactionId)', () => {
    expect(
      deepLinkFor('refund_received', {
        refundTransactionId: 'txn-r-1',
        originalTransactionId: 'txn-orig-1',
        subWalletId: 'sw-4',
      }),
    ).toEqual({ kind: 'transaction', transactionId: 'txn-r-1', subWalletId: 'sw-4' });
  });

  it('accepts subWalletId === null for direct-spend transactions', () => {
    expect(deepLinkFor('txn_settled', { transactionId: 'txn-4', subWalletId: null })).toEqual({
      kind: 'transaction',
      transactionId: 'txn-4',
      subWalletId: null,
    });
  });

  it('returns none when transactionId is missing', () => {
    expect(deepLinkFor('txn_settled', { subWalletId: 'sw-x' })).toEqual({ kind: 'none' });
  });

  it('returns none for bump kind without bumpRequestId', () => {
    expect(deepLinkFor('bump_requested', {})).toEqual({ kind: 'none' });
  });
});
