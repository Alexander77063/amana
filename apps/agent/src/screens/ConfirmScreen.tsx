import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Confirm'>;

export function ConfirmScreen({ route, navigation }: Props): JSX.Element {
  const { resolvedName, bankCode, accountNumber, accountMasked } = route.params;
  const [amountNaira, setAmountNaira] = useState('');
  const [note, setNote] = useState('');
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const send = async () => {
    const sw = subWalletMemory.get();
    if (!sw) return;
    const naira = parseFloat(amountNaira);
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
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.resolvedName}>{resolvedName}</Text>
        <Text style={styles.accountMasked}>{accountMasked}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Amount (₦)</Text>
          <TextInput
            style={styles.amountInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            value={amountNaira}
            onChangeText={setAmountNaira}
            autoFocus
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            style={styles.noteInput}
            placeholder="What is this for?"
            value={note}
            onChangeText={setNote}
            multiline
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Capture GPS location</Text>
          <Switch value={gpsEnabled} onValueChange={setGpsEnabled} />
        </View>

        {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}

        {busy ? (
          <ActivityIndicator style={{ marginTop: 8 }} />
        ) : (
          <Pressable style={styles.button} onPress={() => void send()}>
            <Text style={styles.buttonText}>Send payment</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 20 },
  resolvedName: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  accountMasked: { fontSize: 15, color: '#888', textAlign: 'center', marginTop: -12 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: '#444' },
  amountInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 24, fontWeight: '600' },
  noteInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 15, minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  err: { color: '#b00020' },
  button: { backgroundColor: '#1a1a2e', paddingVertical: 16, borderRadius: 999, alignItems: 'center' },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 17 },
});
