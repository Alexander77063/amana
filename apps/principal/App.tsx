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
  const data = response.notification.request.content.data as
    | Record<string, unknown>
    | undefined;
  if (!data) return;
  const kind = data.kind;
  if (typeof kind !== 'string') return;
  // Reuse the inbox deep-link mapper.
  const link = deepLinkFor(kind as Parameters<typeof deepLinkFor>[0], data);
  if (link.kind === 'bump' && navigationRef.isReady()) {
    navigationRef.navigate('BumpsInbox');
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
      const kind = (n.request.content.data as Record<string, unknown> | undefined)?.kind;
      if (isBumpKind(kind)) void refreshBumps();
      else void refreshNotifications();
    });

    // Background tap: navigate to deep-link target.
    responseSubRef.current = setupResponseListener(navigateForResponse);

    // Cold-start tap: process the response that launched the app, if any.
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) navigateForResponse(r);
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
