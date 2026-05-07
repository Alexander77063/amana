import type { NotificationDeepLink, NotificationKind } from '@amana/types';

/** True for any push payload whose `data.kind` indicates a bump-related event. */
export function isBumpKind(kind: unknown): kind is 'bump_requested' | 'bump_decided' {
  return kind === 'bump_requested' || kind === 'bump_decided';
}

/**
 * Map a notification's `kind` + `payloadJson` into a deep-link target the inbox
 * tap handler can navigate on. `kind: 'none'` means tap → mark-read only.
 *
 * Bump kinds → BumpsInbox. Txn kinds → TransactionDetail.
 * `refund_received` deep-links to the refund txn (the new credit entry the user
 * actually wants to see), not the originating spend.
 *
 * Pure-logic and free of `expo-notifications` imports — keeps it vitest-runnable.
 */
export function deepLinkFor(kind: NotificationKind, payloadJson: unknown): NotificationDeepLink {
  const p = (payloadJson ?? {}) as Record<string, unknown>;

  if (
    (kind === 'bump_requested' || kind === 'bump_decided') &&
    typeof p.bumpRequestId === 'string'
  ) {
    return { kind: 'bump', bumpRequestId: p.bumpRequestId };
  }

  let txnId: string | null = null;
  if (kind === 'txn_settled' || kind === 'txn_failed' || kind === 'anomaly_alert') {
    if (typeof p.transactionId === 'string') txnId = p.transactionId;
  } else if (kind === 'refund_received') {
    if (typeof p.refundTransactionId === 'string') txnId = p.refundTransactionId;
  }

  if (txnId !== null) {
    const subWalletId = typeof p.subWalletId === 'string' ? p.subWalletId : null;
    return { kind: 'transaction', transactionId: txnId, subWalletId };
  }

  return { kind: 'none' };
}
