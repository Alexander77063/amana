import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Body, Button, Label, Screen, TextInput, useTheme } from '@amana/ui';
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
  const theme = useTheme();
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
      setErrorMsg(
        e instanceof Error ? e.message : 'Name enquiry failed. Check details and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (showPicker) {
    return (
      <Screen title="Select Bank" noPadding>
        <View style={styles.searchWrapper}>
          <TextInput
            placeholder="Search banks…"
            value={bankFilter}
            onChangeText={setBankFilter}
            autoFocus
          />
        </View>
        <FlatList
          data={filteredBanks}
          keyExtractor={(b) => b.code}
          renderItem={({ item }) => (
            <Pressable
              style={[
                styles.bankRow,
                { borderBottomColor: theme.colors.border },
              ]}
              onPress={() => {
                setBankCode(item.code);
                setShowPicker(false);
                setBankFilter('');
              }}
            >
              <Body>{item.name}</Body>
            </Pressable>
          )}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Link Account" noPadding>
      <View style={[styles.formContent, { paddingHorizontal: 20 }]}>
        <View style={{ marginBottom: 12 }}>
          <Label style={{ marginBottom: 6 }}>Bank</Label>
          <Pressable
            style={[
              styles.bankSelector,
              {
                backgroundColor: theme.colors.bg.surface,
                borderColor: theme.colors.border,
              },
            ]}
            onPress={() => setShowPicker(true)}
          >
            <Text
              style={[
                { fontSize: 14 },
                selectedBank
                  ? { color: theme.colors.text.primary }
                  : { color: theme.colors.text.muted },
              ]}
            >
              {selectedBank?.name ?? 'Select bank…'}
            </Text>
          </Pressable>
        </View>
        <TextInput
          label="ACCOUNT NUMBER"
          placeholder="0123456789"
          keyboardType="number-pad"
          maxLength={10}
          value={accountNumber}
          onChangeText={setAccountNumber}
        />
        {errorMsg ? <Body muted>{errorMsg}</Body> : null}
        <View style={{ marginTop: 8 }}>
          <Button
            label="CONFIRM NAME"
            onPress={() => void enquire()}
            loading={busy}
            disabled={busy || !bankCode || accountNumber.length < 10}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrapper: { paddingHorizontal: 20, paddingTop: 12 },
  bankRow: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  formContent: { flex: 1, gap: 4, paddingTop: 20 },
  bankSelector: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    height: 48,
    justifyContent: 'center',
  },
});
