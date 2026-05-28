import { Body, Button, Card, Heading, Screen, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { api } from '../lib/api';
import type { PairingStackParamList } from '../nav/PairingStack';
import { useAgentStore } from '../state/agent.store';

type Props = NativeStackScreenProps<PairingStackParamList, 'PairingMethod'> & {
  onPaired: () => void;
};

export function PairingMethodScreen({ navigation, route }: Props): JSX.Element {
  const theme = useTheme();
  const pendingToken = route.params?.pendingToken;

  useEffect(() => {
    if (!pendingToken) return;
    const complete = async () => {
      try {
        await api.pairing.complete(pendingToken);
        const me = await api.me.getSubWallet();
        useAgentStore.getState().setSubWallet(me.subWallet);
        navigation.replace('PairingSuccess', {
          subWalletName: me.subWallet.name,
          principalPhone: me.principal.phone,
        });
      } catch {
        // Invalid token — let user choose another pairing method
      }
    };
    void complete();
  }, [pendingToken, navigation]);

  return (
    <Screen title="Pair with Principal">
      <View style={{ gap: 12, marginTop: 8 }}>
        <Card style={{ gap: 8 }}>
          <Heading size="md">Scan QR code</Heading>
          <Body muted>Principal shows a QR — you scan it.</Body>
          <Button label="SCAN QR" onPress={() => navigation.navigate('QRScan')} />
        </Card>

        {Platform.OS === 'android' && (
          <Card style={{ gap: 8 }}>
            <Heading size="md">NFC tap</Heading>
            <Body muted>Touch phones together. Android only.</Body>
            <Button label="USE NFC" onPress={() => navigation.navigate('NFCPair')} />
          </Card>
        )}

        <Card style={{ gap: 8 }}>
          <Heading size="md">SMS link</Heading>
          <Body muted>
            Ask your principal to share a link. Tap it and this screen will complete automatically.
          </Body>
        </Card>
      </View>
    </Screen>
  );
}
