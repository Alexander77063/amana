import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PayStackParamList } from '../nav/PayStack';

const BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '050', name: 'EcoBank' },
  { code: '011', name: 'First Bank' },
  { code: '214', name: 'First City Monument Bank' },
  { code: '058', name: 'Guaranty Trust Bank' },
  { code: '030', name: 'Heritage Bank' },
  { code: '301', name: 'Jaiz Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '101', name: 'ProvidusBank' },
  { code: '221', name: 'Stanbic IBTC' },
  { code: '068', name: 'Standard Chartered' },
  { code: '232', name: 'Sterling Bank' },
  { code: '100', name: 'Suntrust Bank' },
  { code: '032', name: 'Union Bank' },
  { code: '033', name: 'United Bank for Africa' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '120001', name: 'OPay' },
  { code: '090405', name: 'Moniepoint' },
  { code: '100002', name: 'Kuda Bank' },
  { code: '110005', name: 'PalmPay' },
];

type Props = NativeStackScreenProps<PayStackParamList, 'AccountEntry'>;

export function AccountEntryScreen({ navigation }: Props): JSX.Element {
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankFilter, setBankFilter] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedBank = BANKS.find((b) => b.code === bankCode);
  const filteredBanks = BANKS.filter((b) =>
    b.name.toLowerCase().includes(bankFilter.toLowerCase()),
  );

  const enquire = async () => {
    const sw = subWalletMemory.get();
    if (!sw || !bankCode || accountNumber.length < 10) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const vendor = await api.vendor.nameEnquiry(bankCode, accountNumber, sw.id);
      navigation.navigate('Confirm', {
        resolvedName: vendor.accountName,
        bankCode: vendor.bankCode,
        accountNumber: vendor.accountNumber,
        accountMasked: `****${vendor.accountNumber.slice(-4)}`,
      });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Name enquiry failed. Check details and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (showPicker) {
    return (
      <View style={styles.container}>
        <TextInput
          style={styles.input}
          placeholder="Search banks…"
          value={bankFilter}
          onChangeText={setBankFilter}
          autoFocus
        />
        <FlatList
          data={filteredBanks}
          keyExtractor={(b) => b.code}
          renderItem={({ item }) => (
            <Pressable style={styles.bankRow} onPress={() => { setBankCode(item.code); setShowPicker(false); setBankFilter(''); }}>
              <Text style={styles.bankName}>{item.name}</Text>
            </Pressable>
          )}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <Text style={styles.label}>Bank</Text>
      <Pressable style={styles.input} onPress={() => setShowPicker(true)}>
        <Text style={selectedBank ? styles.selected : styles.placeholder}>
          {selectedBank?.name ?? 'Select bank…'}
        </Text>
      </Pressable>
      <Text style={styles.label}>Account number</Text>
      <TextInput
        style={styles.input}
        placeholder="0123456789"
        keyboardType="number-pad"
        maxLength={10}
        value={accountNumber}
        onChangeText={setAccountNumber}
      />
      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}
      {busy ? (
        <ActivityIndicator />
      ) : (
        <Pressable
          style={[styles.button, (!bankCode || accountNumber.length < 10) && styles.disabled]}
          disabled={!bankCode || accountNumber.length < 10}
          onPress={() => void enquire()}
        >
          <Text style={styles.buttonText}>Confirm name</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#444' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#fff', justifyContent: 'center' },
  placeholder: { color: '#999', fontSize: 16 },
  selected: { fontSize: 16 },
  err: { color: '#b00020' },
  button: { backgroundColor: '#1a1a2e', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 999, alignSelf: 'flex-start' },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
  bankRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  bankName: { fontSize: 15 },
});
