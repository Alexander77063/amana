import type { TransactionSummary } from '@amana/types';
import { Badge, Screen, SectionHeader, TransactionRow, useTheme } from '@amana/ui';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import { useAgentStore } from '../state/agent.store';
import type { HistoryStackParamList } from '../nav/HistoryStack';

type Props = NativeStackScreenProps<HistoryStackParamList, 'TransactionList'>;

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
}

function statusVariant(status: string): 'success' | 'error' | 'warning' | 'neutral' {
  if (status === 'settled') return 'success';
  if (status === 'failed' || status === 'reversed') return 'error';
  if (status === 'bump_pending') return 'warning';
  return 'neutral';
}

export function TransactionListScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const sw = useAgentStore((s) => s.selectedSubWallet);
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
    [sw],
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
    <Screen title="Transactions" noPadding>
      <FlatList
        data={txns}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={<SectionHeader title="ALL TRANSACTIONS" />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} />
          ) : (
            <Text style={[styles.empty, { color: theme.colors.text.muted }]}>
              No transactions yet.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <View>
            <TransactionRow
              merchant={item.vendorResolvedName ?? '—'}
              timestamp={formatDate(item.initiatedAt)}
              amount={formatNaira(item.amountKobo)}
              sentiment="debit"
              onPress={() =>
                navigation.navigate('TransactionDetail', { transactionId: item.id })
              }
            />
            {item.status !== 'settled' && (
              <View style={{ paddingHorizontal: 20, paddingBottom: 4 }}>
                <Badge label={item.status} variant={statusVariant(item.status)} />
              </View>
            )}
          </View>
        )}
        ListFooterComponent={
          nextCursor ? (
            loadingMore ? (
              <ActivityIndicator style={{ padding: 16 }} />
            ) : (
              <Pressable
                style={styles.loadMore}
                onPress={() => void loadPage(nextCursor, true)}
              >
                <Text style={[styles.loadMoreText, { color: theme.colors.accent }]}>
                  Load more
                </Text>
              </Pressable>
            )
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', marginTop: 40 },
  loadMore: { padding: 16, alignItems: 'center' },
  loadMoreText: { fontWeight: '600' },
});
