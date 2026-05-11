import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import type { TransactionSummary } from '@amana/types';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { MainTabParamList } from '../nav/MainTabs';

type Props = BottomTabScreenProps<MainTabParamList, 'Home'>;

export function HomeScreen({ navigation }: Props): JSX.Element {
  const sw = subWalletMemory.get();
  const [txns, setTxns] = useState<TransactionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!sw) return;
      setLoading(true);
      api.subWallet
        .getTransactions(sw.id, undefined, 20)
        .then((r) => setTxns(r.transactions))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [sw?.id]),
  );

  const pendingBump = txns.find((t) => t.status === 'bump_pending');

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.walletName}>{sw?.name ?? '—'}</Text>
        <Text style={styles.label}>Your sub-wallet</Text>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 24 }} />}

      {pendingBump && (
        <Pressable
          style={styles.badge}
          onPress={() => navigation.navigate('History')}
        >
          <Text style={styles.badgeText}>⚠ Payment pending principal approval — tap to view</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  card: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#1a1a2e',
    gap: 4,
  },
  walletName: { fontSize: 22, fontWeight: '700', color: 'white' },
  label: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  badge: {
    backgroundColor: '#fff3e0',
    borderLeftWidth: 4,
    borderLeftColor: '#e65100',
    padding: 14,
    borderRadius: 8,
  },
  badgeText: { color: '#e65100', fontWeight: '600', fontSize: 14 },
});
