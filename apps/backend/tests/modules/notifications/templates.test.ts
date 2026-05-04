import { describe, expect, it } from 'vitest';
import {
  bumpRequested,
  bumpDecided,
  txnSettled,
  txnFailed,
  anomalyAlert,
  refundReceived,
} from '../../../src/modules/notifications/templates';

describe('notification templates', () => {
  it('bumpRequested renders the canonical copy', () => {
    expect(bumpRequested({
      bumpRequestId: 'b1', transactionId: 't1',
      amountKobo: 520050n, vendorResolvedName: 'MUSA ABDULLAHI', agentDisplayName: 'Driver',
    })).toEqual({
      title: 'Approve a bump?',
      body: 'Driver wants to spend ₦5,200.50 at MUSA ABDULLAHI.',
      data: { kind: 'bump_requested', bumpRequestId: 'b1', transactionId: 't1' },
    });
  });

  it('bumpDecided renders approval and denial copy', () => {
    const approved = bumpDecided({
      bumpRequestId: 'b1', transactionId: 't1', amountKobo: 100_000n,
      vendorResolvedName: 'M', decision: 'approve_once',
    });
    expect(approved.title).toBe('Bump approved');
    expect(approved.body).toBe('₦1,000 to M approved.');
    const denied = bumpDecided({
      bumpRequestId: 'b1', transactionId: 't1', amountKobo: 100_000n,
      vendorResolvedName: 'M', decision: 'deny',
    });
    expect(denied.title).toBe('Bump declined');
  });

  it('txnSettled renders amount + vendor', () => {
    const r = txnSettled({
      transactionId: 't1', amountKobo: 250_000n,
      vendorResolvedName: 'MUSA', nibssSessionId: '12345',
    });
    expect(r.title).toBe('Payment sent');
    expect(r.body).toBe('₦2,500 to MUSA settled.');
    expect(r.data.nibssSessionId).toBe('12345');
  });

  it('txnFailed includes reason when present', () => {
    expect(txnFailed({
      transactionId: 't1', amountKobo: 5_000n,
      vendorResolvedName: 'M', reason: 'beneficiary closed',
    }).body).toBe('₦50 to M couldn\'t be sent: beneficiary closed.');
    expect(txnFailed({
      transactionId: 't1', amountKobo: 5_000n,
      vendorResolvedName: 'M', reason: null,
    }).body).toBe('₦50 to M couldn\'t be sent.');
  });

  it('anomalyAlert formats score as percentage', () => {
    expect(anomalyAlert({
      transactionId: 't1', amountKobo: 100_000n, vendorResolvedName: 'M',
      anomalyScore: 0.87,
    }).body).toBe('₦1,000 to M scored 87/100 for unusual pattern.');
  });

  it('refundReceived references the original txn', () => {
    const r = refundReceived({
      refundTransactionId: 'r1', originalTransactionId: 't1',
      amountKobo: 50_000n, vendorResolvedName: 'M',
    });
    expect(r.body).toBe('₦500 refunded from M.');
    expect(r.data.originalTransactionId).toBe('t1');
  });
});
