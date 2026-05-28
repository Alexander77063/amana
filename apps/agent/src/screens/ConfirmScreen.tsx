import { AmountText, Body, Button, Card, Label, Screen, TextInput, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';
import { useAgentStore } from '../state/agent.store';

type Props = NativeStackScreenProps<PayStackParamList, 'Confirm'>;

export function ConfirmScreen({ route, navigation }: Props): JSX.Element {
  const theme = useTheme();
  const { resolvedName, bankCode, accountNumber, accountMasked } = route.params;
  const [amountNaira, setAmountNaira] = useState('');
  const [note, setNote] = useState('');
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const send = async () => {
    const sw = useAgentStore.getState().selectedSubWallet;
    if (!sw) return;
    const naira = Number.parseFloat(amountNaira);
    if (!Number.isFinite(naira) || naira <= 0) {
      setErrorMsg('Enter a valid amount.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);

    let geolocation: { lat: number; lng: number } | null = null;
    if (gpsEnabled) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          geolocation = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        }
      } catch {
        // GPS failed — send without location rather than blocking payment
      }
    }

    try {
      const { transactionId } = await api.transaction.createIntent({
        masterWalletId: sw.masterWalletId,
        subWalletId: sw.id,
        amountKobo: String(Math.round(naira * 100)),
        idempotencyKey: `${sw.id}-${Date.now()}`,
        vendorBankCode: bankCode,
        vendorAccountNumber: accountNumber,
        vendorResolvedName: resolvedName,
        category: 'ad_hoc_service',
        agentNote: note.trim() || null,
        geolocation,
      });
      const evalResult = await api.transaction.evaluate(transactionId);
      if (evalResult.kind === 'allow') {
        navigation.replace('Sending', { transactionId });
      } else {
        navigation.replace('BumpWait', {
          transactionId,
          amountKobo: String(Math.round(naira * 100)),
          resolvedName,
          expiresAt: evalResult.expiresAt,
        });
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Payment failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Confirm Payment" keyboardAvoiding scrollable>
      <Card style={{ alignItems: 'center', gap: 4, marginBottom: 8 }}>
        <Body strong>{resolvedName}</Body>
        <Body muted>{accountMasked}</Body>
        {amountNaira ? (
          <AmountText
            size="xl"
            value={`₦${Number.parseFloat(amountNaira || '0').toLocaleString('en-NG', { minimumFractionDigits: 2 })}`}
            sentiment="debit"
            style={{ marginTop: 8 }}
          />
        ) : null}
      </Card>

      <TextInput
        label="AMOUNT (₦)"
        keyboardType="decimal-pad"
        placeholder="0.00"
        value={amountNaira}
        onChangeText={setAmountNaira}
        autoFocus
        style={{ fontSize: 24, fontWeight: '600', height: 56 }}
      />

      <TextInput
        label="NOTE (OPTIONAL)"
        placeholder="What is this for?"
        value={note}
        onChangeText={setNote}
        multiline
        style={{ minHeight: 72, textAlignVertical: 'top', height: undefined }}
      />

      <View style={styles.row}>
        <Body>Capture GPS location</Body>
        <Switch value={gpsEnabled} onValueChange={setGpsEnabled} />
      </View>

      {errorMsg ? <Body style={{ color: theme.colors.debit }}>{errorMsg}</Body> : null}

      <Button
        label="CONFIRM PAYMENT"
        onPress={() => void send()}
        loading={busy}
        style={{ marginTop: 8 }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
});
