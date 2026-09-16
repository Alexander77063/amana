import { NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../lib/api';
import { setupResponseListener } from '../lib/push';
import { secureTokenStore } from '../lib/secure-token-store';
import { useAgentStore } from '../state/agent.store';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { PairingStack } from './PairingStack';
import { navigationRef } from './navigationRef';

type AppState = 'booting' | 'logged_out' | 'unpaired' | 'paired';

function SplashScreen(): JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Loading…</Text>
    </View>
  );
}

export function RootNavigator(): JSX.Element {
  const [appState, setAppState] = useState<AppState>('booting');
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  const checkPairing = useCallback(async () => {
    try {
      const me = await api.me.getSubWallet();
      useAgentStore.getState().setSubWallet(me.subWallet);
      setAppState('paired');
    } catch {
      setAppState('unpaired');
    }
  }, []);

  const onLoggedIn = useCallback(() => {
    void checkPairing();
  }, [checkPairing]);

  const onPaired = useCallback(() => {
    void checkPairing();
  }, [checkPairing]);

  useEffect(() => {
    const boot = async () => {
      const auth = await secureTokenStore.read();
      if (!auth) {
        setAppState('logged_out');
        return;
      }
      await checkPairing();
    };
    void boot();
  }, [checkPairing]);

  // SMS deep-link: amana://pair?token=…
  useEffect(() => {
    const handle = (url: string) => {
      const parsed = Linking.parse(url);
      if (parsed.path === 'pair' && typeof parsed.queryParams?.token === 'string') {
        setPendingToken(parsed.queryParams.token);
      }
    };
    Linking.getInitialURL().then((url) => {
      if (url) handle(url);
    });
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  // A tapped support-verification push had nowhere to go: this app registered the screen but wired
  // no response listener at all, so the whole push rail was dead. `SupportApprove` lives inside the
  // Settings tab's stack, so the navigate has to name both.
  useEffect(() => {
    const sub = setupResponseListener((response) => {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      if (data?.kind !== 'support_verification') return;
      const verificationId = data.verificationId;
      const options = data.options;
      if (typeof verificationId !== 'string' || !Array.isArray(options)) return;
      if (!navigationRef.isReady()) return;
      navigationRef.navigate('Settings', {
        screen: 'SupportApprove',
        params: {
          verificationId,
          options: options.filter((n): n is number => typeof n === 'number'),
        },
      });
    });
    return () => sub.remove();
  }, []);

  if (appState === 'booting') return <SplashScreen />;

  return (
    <NavigationContainer ref={navigationRef}>
      {appState === 'logged_out' && <AuthStack onLoggedIn={onLoggedIn} />}
      {appState === 'unpaired' && <PairingStack onPaired={onPaired} pendingToken={pendingToken} />}
      {appState === 'paired' && <MainTabs />}
    </NavigationContainer>
  );
}
