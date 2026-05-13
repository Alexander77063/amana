import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'PairingMethod'> & {
  onPaired: () => void;
};

export function PairingMethodScreen({ navigation, route }: Props): JSX.Element {
  const pendingToken = route.params?.pendingToken;

  useEffect(() => {
    if (!pendingToken) return;
    const complete = async () => {
      try {
        await api.pairing.complete(pendingToken);
        const me = await api.me.getSubWallet();
        subWalletMemory.set(me.subWallet);
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
    <View style={styles.container}>
      <Text style={styles.title}>Pair your wallet</Text>
      <Text style={styles.sub}>
        Choose how to connect with your principal&apos;s Amana account.
      </Text>

      <Pressable style={styles.option} onPress={() => navigation.navigate('QRScan')}>
        <Text style={styles.optTitle}>Scan QR code</Text>
        <Text style={styles.optSub}>Principal shows a QR — you scan it.</Text>
      </Pressable>

      {Platform.OS === 'android' && (
        <Pressable style={styles.option} onPress={() => navigation.navigate('NFCPair')}>
          <Text style={styles.optTitle}>NFC tap</Text>
          <Text style={styles.optSub}>Touch phones together. Android only.</Text>
        </Pressable>
      )}

      <View style={[styles.option, styles.passive]}>
        <Text style={styles.optTitle}>SMS link</Text>
        <Text style={styles.optSub}>
          Ask your principal to share a link. Tap it and this screen will complete automatically.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '600' },
  sub: { color: '#666', fontSize: 14 },
  option: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 16,
    gap: 4,
    backgroundColor: '#fff',
  },
  passive: { backgroundColor: '#f5f5f5' },
  optTitle: { fontSize: 16, fontWeight: '600' },
  optSub: { fontSize: 13, color: '#666' },
});
