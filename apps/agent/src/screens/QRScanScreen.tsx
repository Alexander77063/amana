import { Body, Button, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { api } from '../lib/api';
import { useAgentStore } from '../state/agent.store';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'QRScan'> & { onPaired: () => void };

export function QRScanScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  const handleScan = async (data: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.pairing.complete(data);
      const me = await api.me.getSubWallet();
      useAgentStore.getState().setSubWallet(me.subWallet);
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
          <Body style={{ color: 'white' }}>Pairing…</Body>
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
