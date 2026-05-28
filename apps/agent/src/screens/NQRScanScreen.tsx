import { Body, Button, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { api } from '../lib/api';
import { useAgentStore } from '../state/agent.store';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'NQRScan'>;

export function NQRScanScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  const handleScan = async (payload: string) => {
    if (busy) return;
    setBusy(true);
    const sw = useAgentStore.getState().selectedSubWallet;
    if (!sw) {
      setBusy(false);
      return;
    }
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
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 16,
          backgroundColor: theme.colors.bg.base,
        }}
      >
        <Body muted style={{ textAlign: 'center' }}>
          Camera access is needed to scan QR codes.
        </Body>
        <Button
          label="GRANT CAMERA PERMISSION"
          onPress={() => void requestPermission()}
          fullWidth={false}
        />
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
        <View
          style={{
            ...overlayStyle,
            backgroundColor: 'rgba(0,0,0,0.6)',
          }}
        >
          <ActivityIndicator color="white" size="large" />
          <Body style={{ color: 'white' }}>Resolving vendor…</Body>
        </View>
      )}
    </View>
  );
}

const overlayStyle = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  gap: 12,
};
