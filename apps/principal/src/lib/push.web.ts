import type * as Notifications from 'expo-notifications';

// Web twin of push.ts, resolved by Metro only for Platform.OS === 'web'.
//
// `expo-notifications` has no usable web implementation here: subscribing via
// `addNotificationResponseReceivedListener` internally calls
// `getLastNotificationResponseAsync`, which throws "not available on web". That throw
// escaped during post-login bootstrap and the app surfaced it as "Couldn't load:
// network_error" — a real request had not failed at all.
//
// Push is a device capability, so on web these are honest no-ops: no token, and
// subscriptions that unsubscribe cleanly.

export { deepLinkFor, isBumpKind } from './deep-link';

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

/** A browser tab is never cold-started by a push tap. */
export async function getLastNotificationResponseOrNull(): Promise<Notifications.NotificationResponse | null> {
  return null;
}
