import type { RecentVendorResponse } from '@amana/api-client';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'CaptureMethod'>;

export function CaptureMethodScreen({ navigation }: Props): JSX.Element {
  const sw = subWalletMemory.get();
  const [recents, setRecents] = useState<RecentVendorResponse[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!sw) return;
      setLoading(true);
      api.vendor
        .recents(sw.id)
        .then(setRecents)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [sw]),
  );

  const goConfirm = (v: RecentVendorResponse) =>
    navigation.navigate('Confirm', {
      resolvedName: v.accountName,
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
      accountMasked: `****${v.accountNumber.slice(-4)}`,
    });

  return (
    <View style={styles.container}>
      <Pressable style={styles.action} onPress={() => navigation.navigate('NQRScan')}>
        <Text style={styles.actionTitle}>Scan QR code</Text>
        <Text style={styles.actionSub}>NIBSS NQR or bank QR</Text>
      </Pressable>
      <Pressable style={styles.action} onPress={() => navigation.navigate('PhoneLookup')}>
        <Text style={styles.actionTitle}>Pay by phone number</Text>
      </Pressable>
      <Pressable style={styles.action} onPress={() => navigation.navigate('AccountEntry')}>
        <Text style={styles.actionTitle}>Pay by account number</Text>
      </Pressable>

      {loading && <ActivityIndicator style={{ marginTop: 16 }} />}

      {recents.length > 0 && (
        <FlatList
          data={recents}
          keyExtractor={(item) => `${item.bankCode}-${item.accountNumber}`}
          ListHeaderComponent={<Text style={styles.sectionLabel}>Recents</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.recent} onPress={() => goConfirm(item)}>
              <Text style={styles.recentName}>{item.accountName}</Text>
              <Text style={styles.recentSub}>****{item.accountNumber.slice(-4)}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  action: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 16,
  },
  actionTitle: { fontSize: 16, fontWeight: '600' },
  actionSub: { fontSize: 13, color: '#666', marginTop: 2 },
  sectionLabel: { fontSize: 13, color: '#888', fontWeight: '600', marginTop: 8, marginBottom: 4 },
  recent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  recentName: { fontSize: 15 },
  recentSub: { fontSize: 13, color: '#888' },
});
