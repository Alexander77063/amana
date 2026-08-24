import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// Re-export pure-logic helpers so existing call sites (App.tsx, inbox screen)
// don't need to change their imports. Tests should import directly from `./deep-link`.
export { deepLinkFor, isBumpKind } from './deep-link';

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

/**
 * The notification response that cold-started the app, if any.
 *
 * Wrapped here (rather than called straight from App.tsx) so the platform twin can answer
 * for web, and so a rejection can never escape as an unhandled promise — the caller fires
 * this during post-login bootstrap, where an uncaught throw takes the whole screen down.
 */
export async function getLastNotificationResponseOrNull(): Promise<Notifications.NotificationResponse | null> {
  try {
    return (await Notifications.getLastNotificationResponseAsync()) ?? null;
  } catch {
    return null;
  }
}
