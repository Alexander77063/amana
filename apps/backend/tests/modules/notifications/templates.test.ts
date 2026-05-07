import { describe, expect, it } from 'vitest';
import {
  anomalyAlert,
  bumpDecided,
  bumpRequested,
  refundReceived,
  txnFailed,
  txnSettled,
} from '../../../src/modules/notifications/templates';

describe('notification templates', () => {
  it('bumpRequested renders the canonical copy', () => {
    expect(
      bumpRequested({
        bumpRequestId: 'b1',
        transactionId: 't1',
        amountKobo: 520050n,
        vendorResolvedName: 'MUSA ABDULLAHI',
        agentDisplayName: 'Driver',
      }),
    ).toEqual({
      title: 'Approve a bump?',
      body: 'Driver wants to spend ₦5,200.50 at MUSA ABDULLAHI.',
      data: { kind: 'bump_requested', bumpRequestId: 'b1', transactionId: 't1' },
    });
  });

  it('bumpDecided renders approval and denial copy', () => {
    const approved = bumpDecided({
      bumpRequestId: 'b1',
      transactionId: 't1',
      amountKobo: 100_000n,
      vendorResolvedName: 'M',
      decision: 'approve_once',
    });
    expect(approved.title).toBe('Bump approved');
    expect(approved.body).toBe('₦1,000 to M approved.');
    const denied = bumpDecided({
      bumpRequestId: 'b1',
      transactionId: 't1',
      amountKobo: 100_000n,
      vendorResolvedName: 'M',
      decision: 'deny',
    });
    expect(denied.title).toBe('Bump declined');
  });

  it('txnSettled renders amount + vendor', () => {
    const r = txnSettled({
      transactionId: 't1',
      subWalletId: 'sw1',
      amountKobo: 250_000n,
      vendorResolvedName: 'MUSA',
      nibssSessionId: '12345',
    });
    expect(r.title).toBe('Payment sent');
    expect(r.body).toBe('₦2,500 to MUSA settled.');
    expect(r.data.nibssSessionId).toBe('12345');
  });

  it('txnFailed includes reason when present', () => {
    expect(
      txnFailed({
        transactionId: 't1',
        subWalletId: 'sw1',
        amountKobo: 5_000n,
        vendorResolvedName: 'M',
        reason: 'beneficiary closed',
      }).body,
    ).toBe("₦50 to M couldn't be sent: beneficiary closed.");
    expect(
      txnFailed({
        transactionId: 't1',
        subWalletId: 'sw1',
        amountKobo: 5_000n,
        vendorResolvedName: 'M',
        reason: null,
      }).body,
    ).toBe("₦50 to M couldn't be sent.");
  });

  it('anomalyAlert formats score as percentage', () => {
    expect(
      anomalyAlert({
        transactionId: 't1',
        subWalletId: 'sw1',
        amountKobo: 100_000n,
        vendorResolvedName: 'M',
        anomalyScore: 0.87,
      }).body,
    ).toBe('₦1,000 to M scored 87/100 for unusual pattern.');
  });

  it('refundReceived references the original txn', () => {
    const r = refundReceived({
      refundTransactionId: 'r1',
      originalTransactionId: 't1',
      subWalletId: 'sw1',
      amountKobo: 50_000n,
      vendorResolvedName: 'M',
    });
    expect(r.body).toBe('₦500 refunded from M.');
    expect(r.data.originalTransactionId).toBe('t1');
  });
});

describe('templates — subWalletId in data field (6b-6)', () => {
  describe('txnSettled', () => {
    it('embeds subWalletId when present', () => {
      const r = txnSettled({
        transactionId: 'txn-1',
        subWalletId: 'sw-1',
        amountKobo: 12_300n,
        vendorResolvedName: 'Mama Tola',
        nibssSessionId: '100005031234',
      });
      expect(r.data).toEqual({
        kind: 'txn_settled',
        transactionId: 'txn-1',
        subWalletId: 'sw-1',
        nibssSessionId: '100005031234',
      });
    });

    it('embeds subWalletId === null for direct-spend', () => {
      const r = txnSettled({
        transactionId: 'txn-2',
        subWalletId: null,
        amountKobo: 5000n,
        vendorResolvedName: 'Foo Vendor',
        nibssSessionId: null,
      });
      expect(r.data.subWalletId).toBeNull();
    });
  });

  describe('txnFailed', () => {
    it('embeds subWalletId when present', () => {
      const r = txnFailed({
        transactionId: 'txn-3',
        subWalletId: 'sw-2',
        amountKobo: 1000n,
        vendorResolvedName: 'V',
        reason: 'INSUFFICIENT_FUNDS',
      });
      expect(r.data).toMatchObject({
        kind: 'txn_failed',
        transactionId: 'txn-3',
        subWalletId: 'sw-2',
      });
    });

    it('embeds subWalletId === null for direct-spend', () => {
      const r = txnFailed({
        transactionId: 'txn-4',
        subWalletId: null,
        amountKobo: 1000n,
        vendorResolvedName: 'V',
        reason: null,
      });
      expect(r.data.subWalletId).toBeNull();
    });
  });

  describe('anomalyAlert', () => {
    it('embeds subWalletId when present', () => {
      const r = anomalyAlert({
        transactionId: 'txn-5',
        subWalletId: 'sw-3',
        amountKobo: 50_000n,
        vendorResolvedName: 'V',
        anomalyScore: 0.91,
      });
      expect(r.data).toMatchObject({
        kind: 'anomaly_alert',
        transactionId: 'txn-5',
        subWalletId: 'sw-3',
      });
    });

    it('embeds subWalletId === null for direct-spend', () => {
      const r = anomalyAlert({
        transactionId: 'txn-6',
        subWalletId: null,
        amountKobo: 50_000n,
        vendorResolvedName: 'V',
        anomalyScore: 0.92,
      });
      expect(r.data.subWalletId).toBeNull();
    });
  });

  describe('refundReceived', () => {
    it('embeds subWalletId when present (deep-link target = refundTransactionId)', () => {
      const r = refundReceived({
        refundTransactionId: 'txn-r-1',
        originalTransactionId: 'txn-orig-1',
        subWalletId: 'sw-4',
        amountKobo: 9000n,
        vendorResolvedName: 'V',
      });
      expect(r.data).toMatchObject({
        kind: 'refund_received',
        refundTransactionId: 'txn-r-1',
        originalTransactionId: 'txn-orig-1',
        subWalletId: 'sw-4',
      });
    });

    it('embeds subWalletId === null for direct-spend', () => {
      const r = refundReceived({
        refundTransactionId: 'txn-r-2',
        originalTransactionId: 'txn-orig-2',
        subWalletId: null,
        amountKobo: 9000n,
        vendorResolvedName: 'V',
      });
      expect(r.data.subWalletId).toBeNull();
    });
  });
});
