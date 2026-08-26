import { Body, Button, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '../lib/api';
import { type ScanFailure, describeScanFailure, parseScannedPayload } from '../lib/vendor-code';
import type { PayStackParamList } from '../nav/PayStack';
import { useAgentStore } from '../state/agent.store';

type Props = NativeStackScreenProps<PayStackParamList, 'NQRScan'>;

export function NQRScanScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ScanFailure | null>(null);
  // Held so TRY AGAIN can re-issue the SAME lookup without asking the payer to line the camera up
  // again — and so a retry is a deliberate press rather than the lens re-firing on its own.
  const [lastPayload, setLastPayload] = useState<string | null>(null);

  const resolve = async (payload: string) => {
    if (busy) return;
    const sw = useAgentStore.getState().selectedSubWallet;
    if (!sw) return;
    setBusy(true);
    setFailure(null);
    setLastPayload(payload);
    // One camera, two payload kinds: an Amana Vendor Code URL and a NIBSS TLV go to different
    // endpoints, chosen from the payload's shape. Not by trying one and falling back to the other
    // — that would fire a paid partner call on every mis-scanned QR in the market.
    const scanned = parseScannedPayload(payload);
    try {
      const vendor =
        scanned.kind === 'vendor_code'
          ? await api.vendor.vendorCode(scanned.code, sw.id)
          : await api.vendor.nqrDecode(scanned.payload, sw.id);
      // `vendorId` travels as an OUTPUT only — the confirm screen shows it as a badge and pre-fills
      // the category from it. It is never sent back on the spend intent; the server re-resolves the
      // vendor from the bank code and account number so a payer cannot pick whose rules apply.
      navigation.navigate('Confirm', {
        resolvedName: vendor.accountName,
        bankCode: vendor.bankCode,
        accountNumber: vendor.accountNumber,
        accountMasked: `****${vendor.accountNumber.slice(-4)}`,
        vendorId: vendor.vendorId,
        category: vendor.category,
      });
    } catch (e: unknown) {
      setFailure(describeScanFailure(e, scanned.kind));
      setBusy(false);
    }
  };

  if (!permission) return <ActivityIndicator style={{ flex: 1 }} />;

  if (!permission.granted) {
    return (
      <View style={{ ...panelStyle, backgroundColor: theme.colors.bg.base }}>
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

  // The failure REPLACES the camera rather than sitting over it. Leaving the lens armed pointed at
  // the same sticker re-fires the scan the instant the request settles: on a suspended vendor that
  // is a request loop, and on a 429 it is a loop that deepens the rate limit it just hit.
  if (failure) {
    return (
      <View style={{ ...panelStyle, backgroundColor: theme.colors.bg.base }}>
        <View accessibilityRole="alert" accessibilityLabel={`Scan failed. ${failure.message}`}>
          <Body style={{ textAlign: 'center', color: theme.colors.debit }}>{failure.message}</Body>
        </View>
        {/* Offered on the retryable rungs only. A payer standing in a shop tapping Try again on a
            dead code is the exact failure the server's status ladder exists to prevent. */}
        {failure.retryable && lastPayload !== null ? (
          <Button label="TRY AGAIN" onPress={() => void resolve(lastPayload)} fullWidth={false} />
        ) : null}
        {/* Always available, and deliberately not the same offer: this returns to the camera to
            scan something ELSE, it does not repeat a lookup that has already answered. */}
        <Button
          variant="secondary"
          label="SCAN A DIFFERENT CODE"
          onPress={() => setFailure(null)}
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
        onBarcodeScanned={busy ? undefined : ({ data }) => void resolve(data)}
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

const panelStyle = {
  flex: 1,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  padding: 24,
  gap: 16,
};

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
