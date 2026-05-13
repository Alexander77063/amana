import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'PhoneLookup'>;

export function PhoneLookupScreen({ navigation }: Props): JSX.Element {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const lookup = async () => {
    const sw = subWalletMemory.get();
    if (!sw || !phone.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const vendor = await api.vendor.phoneLookup(phone.trim(), sw.id);
      navigation.navigate('Confirm', {
        resolvedName: vendor.accountName,
        bankCode: vendor.bankCode,
        accountNumber: vendor.accountNumber,
        accountMasked: `****${vendor.accountNumber.slice(-4)}`,
      });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Phone number not found.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.label}>Phone number</Text>
      <TextInput
        style={styles.input}
        placeholder="+2348012345678"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        autoFocus
      />
      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}
      {busy ? (
        <ActivityIndicator />
      ) : (
        <Pressable style={styles.button} onPress={() => void lookup()}>
          <Text style={styles.buttonText}>Look up</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#444' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  buttonText: { color: 'white', fontWeight: '600' },
});
