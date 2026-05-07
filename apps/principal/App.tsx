import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  deepLinkFor,
  isBumpKind,
  setupForegroundListener,
  setupResponseListener,
} from './src/lib/push';
import { RootNavigator, navigationRef } from './src/nav/RootNavigator';
import { useAuthStore } from './src/state/auth.store';
import { useBumpsStore } from './src/state/bumps.store';
import { useNotificationsStore } from './src/state/notifications.store';
import { usePushStore } from './src/state/push.store';

function navigateForResponse(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data as Record<string, unknown> | undefined;
  if (!data) return;
  const kind = data.kind;
  if (typeof kind !== 'string') return;
  const link = deepLinkFor(kind as Parameters<typeof deepLinkFor>[0], data);
  if (!navigationRef.isReady()) return;
  if (link.kind === 'bump') {
    navigationRef.navigate('BumpsInbox');
  } else if (link.kind === 'transaction') {
    navigationRef.navigate('TransactionDetail', { transactionId: link.transactionId });
  }
}

export default function App(): JSX.Element {
  const authStatus = useAuthStore((s) => s.status);
  const bootstrapPush = usePushStore((s) => s.bootstrap);
  const refreshBumps = useBumpsStore((s) => s.refresh);
  const refreshNotifications = useNotificationsStore((s) => s.refresh);
  const fgSubRef = useRef<Notifications.Subscription | null>(null);
  const responseSubRef = useRef<Notifications.Subscription | null>(null);

  // RootNavigator handles auth bootstrap. We only react to logged-in to wire push.
  useEffect(() => {
    if (authStatus !== 'logged_in') return;
    void bootstrapPush();

    // Foreground push: refresh the relevant store.
    fgSubRef.current = setupForegroundListener((n) => {
      // I3: skip refreshes that arrive after logout has cleared tokens — would 401.
      if (useAuthStore.getState().status !== 'logged_in') return;
      const kind = (n.request.content.data as Record<string, unknown> | undefined)?.kind;
      if (isBumpKind(kind)) void refreshBumps();
      else void refreshNotifications();
    });

    // Background tap: navigate to deep-link target.
    responseSubRef.current = setupResponseListener((response) => {
      // I3: skip if logout is in flight — nav target would be the auth stack.
      if (useAuthStore.getState().status !== 'logged_in') return;
      navigateForResponse(response);
    });

    // Cold-start tap: process the response that launched the app, if any.
    // I3-consistency: re-check authStatus on the async resolution path; logout could
    // have fired between this useEffect running and the promise resolving.
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (!r) return;
      if (useAuthStore.getState().status !== 'logged_in') return;
      navigateForResponse(r);
    });

    return () => {
      fgSubRef.current?.remove();
      responseSubRef.current?.remove();
      fgSubRef.current = null;
      responseSubRef.current = null;
    };
  }, [authStatus, bootstrapPush, refreshBumps, refreshNotifications]);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
