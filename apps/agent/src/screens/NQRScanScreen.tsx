import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'NQRScan'>;

export function NQRScanScreen({ navigation }: Props): JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  const handleScan = async (payload: string) => {
    if (busy) return;
    setBusy(true);
    const sw = subWalletMemory.get();
    if (!sw) { setBusy(false); return; }
    try {
      const vendor = await api.vendor.nqrDecode(payload, sw.id);
      navigation.navigate('Confirm', {
        resolvedName: vendor.accountName,
        bankCode: vendor.bankCode,
        accountNumber: vendor.accountNumber,
        accountMasked: `****${vendor.accountNumber.slice(-4)}`,
      });
    } catch (e: unknown) {
      Alert.alert('QR decode failed', e instanceof Error ? e.message : 'Try again.');
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
          <Text style={styles.overlayText}>Resolving vendor…</Text>
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
