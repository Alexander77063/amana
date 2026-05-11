import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { TransactionSummary } from '@amana/types';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { HistoryStackParamList } from '../nav/HistoryStack';

type Props = NativeStackScreenProps<HistoryStackParamList, 'TransactionList'>;

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
}

const STATUS_COLOR: Record<string, string> = {
  settled: '#2e7d32',
  failed: '#b00020',
  bump_pending: '#a15a00',
  in_flight: '#1769ff',
  reversed: '#888',
};

export function TransactionListScreen({ navigation }: Props): JSX.Element {
  const sw = subWalletMemory.get();
  const [txns, setTxns] = useState<TransactionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(
    async (cursor?: string, append = false) => {
      if (!sw) return;
      if (!append) setLoading(true);
      else setLoadingMore(true);
      try {
        const r = await api.subWallet.getTransactions(sw.id, cursor, 20);
        setTxns((prev) => (append ? [...prev, ...r.transactions] : r.transactions));
        setNextCursor(r.nextCursor);
      } catch {
        // silent fail — stale data stays visible
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [sw?.id],
  );

  useFocusEffect(
    useCallback(() => {
      void loadPage();
    }, [loadPage]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    void loadPage();
  };

  return (
    <FlatList
      data={txns}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : (
          <Text style={styles.empty}>No transactions yet.</Text>
        )
      }
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate('TransactionDetail', { transactionId: item.id })}
        >
          <View style={styles.rowLeft}>
            <Text style={styles.vendor}>{item.vendorResolvedName ?? '—'}</Text>
            <Text style={styles.date}>{formatDate(item.initiatedAt)}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
            <Text style={[styles.status, { color: STATUS_COLOR[item.status] ?? '#888' }]}>
              {item.status}
            </Text>
          </View>
        </Pressable>
      )}
      ListFooterComponent={
        nextCursor ? (
          loadingMore ? (
            <ActivityIndicator style={{ padding: 16 }} />
          ) : (
            <Pressable style={styles.loadMore} onPress={() => void loadPage(nextCursor, true)}>
              <Text style={styles.loadMoreText}>Load more</Text>
            </Pressable>
          )
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 8 },
  empty: { textAlign: 'center', color: '#888', marginTop: 40 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  rowLeft: { gap: 4, flex: 1 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  vendor: { fontSize: 15, fontWeight: '500' },
  date: { fontSize: 12, color: '#888' },
  amount: { fontSize: 15, fontWeight: '600' },
  status: { fontSize: 11, textTransform: 'capitalize' },
  loadMore: { padding: 16, alignItems: 'center' },
  loadMoreText: { color: '#1a1a2e', fontWeight: '600' },
});
