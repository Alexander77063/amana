import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'QRScan'> & { onPaired: () => void };

export function QRScanScreen({ navigation }: Props): JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  const handleScan = async (data: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.pairing.complete(data);
      const me = await api.me.getSubWallet();
      subWalletMemory.set(me.subWallet);
      navigation.replace('PairingSuccess', {
        subWalletName: me.subWallet.name,
        principalPhone: me.principal.phone,
      });
    } catch (e: unknown) {
      Alert.alert('Pairing failed', e instanceof Error ? e.message : 'Invalid or expired code.');
      setBusy(false);
    }
  };

  if (!permission) return <ActivityIndicator style={{ flex: 1 }} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>Camera access is needed to scan QR codes.</Text>
        <Pressable style={styles.btn} onPress={() => void requestPermission()}>
          <Text style={styles.btnText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : ({ data }) => void handleScan(data)}
      />
      {busy && (
        <View style={styles.overlay}>
          <ActivityIndicator color="white" size="large" />
          <Text style={styles.overlayText}>Pairing…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  sub: { color: '#666', textAlign: 'center' },
  btn: { backgroundColor: '#1a1a2e', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999 },
  btnText: { color: 'white', fontWeight: '600' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  overlayText: { color: 'white', fontSize: 16 },
});
