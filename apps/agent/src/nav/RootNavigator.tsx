import { NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../lib/api';
import { secureTokenStore } from '../lib/secure-token-store';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { PairingStack } from './PairingStack';

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
      subWalletMemory.set(me.subWallet);
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

  if (appState === 'booting') return <SplashScreen />;

  return (
    <NavigationContainer>
      {appState === 'logged_out' && <AuthStack onLoggedIn={onLoggedIn} />}
      {appState === 'unpaired' && (
        <PairingStack onPaired={onPaired} pendingToken={pendingToken} />
      )}
      {appState === 'paired' && <MainTabs />}
    </NavigationContainer>
  );
}
