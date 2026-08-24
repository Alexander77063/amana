import type { TransactionSummary } from '@amana/types';
import {
  AmountText,
  Badge,
  BalanceCard,
  Body,
  Button,
  Screen,
  TransactionRow,
  formatNaira,
  useTheme,
} from '@amana/ui';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '../lib/api';
import type { MainTabParamList } from '../nav/MainTabs';
import { useAgentStore } from '../state/agent.store';

type Props = BottomTabScreenProps<MainTabParamList, 'Home'>;

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

        {/* The way into the marketplace. Everything behind it is already permitted — the
            catalogue is filtered by the same rules that enforce at purchase — so this is not an
            upsell, it is a shorter route to something the agent may already buy. */}
        <Button
          label="SHOP WITH THIS WALLET"
          variant="secondary"
          onPress={() => navigation.navigate('Pay', { screen: 'Marketplace' })}
        />

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
