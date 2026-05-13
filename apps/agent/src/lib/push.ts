import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

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
