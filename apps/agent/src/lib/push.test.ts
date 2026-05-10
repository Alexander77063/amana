import { describe, expect, it, vi } from 'vitest';

// Mock expo modules before importing push.ts
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-device', () => ({ isDevice: false }));
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  addNotificationReceivedListener: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(),
}));

import { deepLinkFor } from './push';

describe('deepLinkFor', () => {
  it('txn_settled → transaction deep link', () => {
    const r = deepLinkFor('txn_settled', { transactionId: 'txn-1' });
    expect(r).toEqual({ kind: 'transaction', transactionId: 'txn-1' });
  });

  it('txn_failed → transaction deep link', () => {
    const r = deepLinkFor('txn_failed', { transactionId: 'txn-2' });
    expect(r).toEqual({ kind: 'transaction', transactionId: 'txn-2' });
  });

  it('bump_decided → transaction deep link (agent uses transactionId from push)', () => {
    const r = deepLinkFor('bump_decided', { transactionId: 'txn-3' });
    expect(r).toEqual({ kind: 'transaction', transactionId: 'txn-3' });
  });

  it('unknown kind → none', () => {
    const r = deepLinkFor('something_else', {});
    expect(r).toEqual({ kind: 'none' });
  });
});
