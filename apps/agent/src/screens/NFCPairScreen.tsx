import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import NfcManager, { Ndef, NfcEvents } from 'react-native-nfc-manager';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'NFCPair'> & { onPaired: () => void };

export function NFCPairScreen({ navigation }: Props): JSX.Element {
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
            subWalletMemory.set(me.subWallet);
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
    <View style={styles.container}>
      {phase === 'waiting' && (
        <>
          <Text style={styles.title}>Hold phones together</Text>
          <Text style={styles.sub}>
            Touch the backs of both Android phones. The principal&apos;s app will emit the pairing
            token via NFC.
          </Text>
          <ActivityIndicator size="large" style={{ marginTop: 24 }} />
        </>
      )}
      {phase === 'reading' && <ActivityIndicator size="large" />}
      {phase === 'error' && <Text style={styles.err}>{errorMsg}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '600', textAlign: 'center' },
  sub: { color: '#666', textAlign: 'center' },
  err: { color: '#b00020', textAlign: 'center' },
});
