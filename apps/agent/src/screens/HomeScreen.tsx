import type { TransactionSummary } from '@amana/types';
import { AmountText, BalanceCard, Badge, Body, Screen, TransactionRow, useTheme } from '@amana/ui';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '../lib/api';
import { useAgentStore } from '../state/agent.store';
import type { MainTabParamList } from '../nav/MainTabs';

type Props = BottomTabScreenProps<MainTabParamList, 'Home'>;

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
}

export function HomeScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const sw = useAgentStore((s) => s.selectedSubWallet);
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
    }, [sw]),
  );

  const pendingBumps = txns.filter((t) => t.status === 'bump_pending');

  return (
    <Screen title="Amana" noPadding>
      <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 12 }}>
        <BalanceCard label="SUB-WALLET" amount={sw?.name ?? '—'} />

        {pendingBumps.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Badge count={pendingBumps.length} variant="warning" />
            <Body muted>Payment(s) pending principal approval</Body>
          </View>
        )}
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 24 }} />}

      {!loading && txns.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {txns.map((t) => (
            <TransactionRow
              key={t.id}
              merchant={t.vendorResolvedName ?? '—'}
              timestamp={formatDate(t.initiatedAt)}
              amount={formatNaira(t.amountKobo)}
              sentiment="debit"
              onPress={() => navigation.navigate('History')}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
