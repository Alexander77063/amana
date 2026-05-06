import type { NotificationDeepLink, NotificationKind } from '@amana/types';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// Foreground display behavior — show banner, no sound, no badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Returns an Expo push token, or null if:
 * - running on a simulator (Device.isDevice === false)
 * - no projectId is configured (e.g., bare local dev without EAS)
 * - the token request itself errors (network / OS)
 */
export async function getExpoPushTokenOrNull(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
  try {
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return t.data;
  } catch {
    return null;
  }
}

export function setupForegroundListener(
  handler: (n: Notifications.Notification) => void,
): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener(handler);
}

export function setupResponseListener(
  handler: (r: Notifications.NotificationResponse) => void,
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(handler);
}

/** True for any push payload whose `data.kind` indicates a bump-related event. */
export function isBumpKind(kind: unknown): kind is 'bump_requested' | 'bump_decided' {
  return kind === 'bump_requested' || kind === 'bump_decided';
}

/**
 * Map a notification's `kind` + `payloadJson` into a deep-link target the inbox
 * tap handler can navigate on. `kind: 'none'` means tap → mark-read only.
 *
 * v1 only deep-links bump notifications. Transaction notifications return
 * `'none'` because the payload doesn't carry `subWalletId`; that requires a
 * backend template patch which is deferred (see spec out-of-scope).
 */
export function deepLinkFor(kind: NotificationKind, payloadJson: unknown): NotificationDeepLink {
  const p = (payloadJson ?? {}) as Record<string, unknown>;
  if (
    (kind === 'bump_requested' || kind === 'bump_decided') &&
    typeof p.bumpRequestId === 'string'
  ) {
    return { kind: 'bump', bumpRequestId: p.bumpRequestId };
  }
  return { kind: 'none' };
}
