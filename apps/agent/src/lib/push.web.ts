import type * as Notifications from 'expo-notifications';

// Web twin of push.ts, resolved by Metro only for Platform.OS === 'web'. See the principal
// app's push.web.ts for the full rationale: subscribing via
// `addNotificationResponseReceivedListener` internally calls
// `getLastNotificationResponseAsync`, which throws "not available on web", and that throw
// escapes during post-login bootstrap.
//
// `deepLinkFor` is pure logic, so it is re-implemented identically rather than stubbed.

export type AgentDeepLink = { kind: 'transaction'; transactionId: string } | { kind: 'none' };

export type AgentPushKind = 'txn_settled' | 'txn_failed' | 'bump_decided';

export function deepLinkFor(kind: string, payload: unknown): AgentDeepLink {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (
    (kind === 'txn_settled' || kind === 'txn_failed' || kind === 'bump_decided') &&
    typeof p.transactionId === 'string'
  ) {
    return { kind: 'transaction', transactionId: p.transactionId };
  }
  return { kind: 'none' };
}

const noopSubscription: Notifications.Subscription = { remove: () => {} };

/** No push token in a browser — callers already handle null (simulator, no projectId). */
export async function getExpoPushTokenOrNull(): Promise<string | null> {
  return null;
}

export function setupForegroundListener(
  _handler: (n: Notifications.Notification) => void,
): Notifications.Subscription {
  return noopSubscription;
}

export function setupResponseListener(
  _handler: (r: Notifications.NotificationResponse) => void,
): Notifications.Subscription {
  return noopSubscription;
}
