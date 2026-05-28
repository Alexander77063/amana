import { Badge, Body, Card, Screen, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import NfcManager, { Ndef, NfcEvents } from 'react-native-nfc-manager';
import { api } from '../lib/api';
import type { PairingStackParamList } from '../nav/PairingStack';
import { useAgentStore } from '../state/agent.store';

type Props = NativeStackScreenProps<PairingStackParamList, 'NFCPair'> & { onPaired: () => void };

export function NFCPairScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const [phase, setPhase] = useState<'waiting' | 'reading' | 'error'>('waiting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const startNfc = async () => {
      try {
        await NfcManager.start();
        NfcManager.setEventListener(NfcEvents.DiscoverTag, async (tag: unknown) => {
          if (!alive) return;
          setPhase('reading');
          try {
            const t = tag as { ndefMessage?: Array<{ payload: number[] }> };
            const payload = t.ndefMessage?.[0]?.payload;
            if (!payload) throw new Error('No NDEF payload in tag');
            const token = Ndef.text.decodePayload(new Uint8Array(payload));
            await api.pairing.complete(token);
            const me = await api.me.getSubWallet();
            useAgentStore.getState().setSubWallet(me.subWallet);
            if (alive) {
              navigation.replace('PairingSuccess', {
                subWalletName: me.subWallet.name,
                principalPhone: me.principal.phone,
              });
            }
          } catch (e: unknown) {
            if (alive) {
              setPhase('error');
              setErrorMsg(e instanceof Error ? e.message : 'NFC read failed. Try again.');
            }
          }
        });
        await NfcManager.registerTagEvent();
      } catch {
        if (alive) {
          setPhase('error');
          setErrorMsg('NFC is not available on this device.');
        }
      }
    };

    void startNfc();

    return () => {
      alive = false;
      void NfcManager.unregisterTagEvent();
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    };
  }, [navigation]);

  return (
    <Screen title="NFC Pairing">
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Card style={{ alignItems: 'center', gap: 12, width: '100%' }}>
          {phase === 'waiting' && (
            <>
              <Badge label="WAITING" variant="neutral" />
              <Body strong>Hold phones together</Body>
              <Body muted style={{ textAlign: 'center' }}>
                Touch the backs of both Android phones. The principal's app will emit the pairing
                token via NFC.
              </Body>
              <ActivityIndicator size="large" style={{ marginTop: 8 }} />
            </>
          )}
          {phase === 'reading' && (
            <>
              <Badge label="READING" variant="warning" />
              <ActivityIndicator size="large" />
            </>
          )}
          {phase === 'error' && (
            <>
              <Badge label="ERROR" variant="error" />
              <Body style={{ textAlign: 'center', color: theme.colors.debit }}>
                {errorMsg ?? 'NFC error'}
              </Body>
            </>
          )}
        </Card>
      </View>
    </Screen>
  );
}
