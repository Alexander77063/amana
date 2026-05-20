import type { BumpRequest, BumpStatus } from '@amana/types';
import { AmountText, Badge, Body, Button, Caption, Card, Screen, SectionHeader, Skeleton, useTheme } from '@amana/ui';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo } from 'react';
import {
  FlatList,
  RefreshControl,
  View,
} from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useBumpsStore } from '../state/bumps.store';
import { usePushStore } from '../state/push.store';

type Props = NativeStackScreenProps<MainStackParamList, 'BumpsInbox'>;

const PROMPT_SHOWN_KEY = '@amana/principal/enable-notifications-shown';

function statusLabel(status: BumpStatus): string {
  switch (status) {
    case 'approved_once':
      return 'Approved';
    case 'raise_limit':
      return 'Approved (raised)';
    case 'denied':
      return 'Denied';
    case 'expired':
      return 'Expired';
    case 'pending':
      return 'Pending';
    case 'cancelled':
      return 'Cancelled';
  }
}

function formatNaira(amountKoboStr: string): string {
  const kobo = BigInt(amountKoboStr);
  const naira = kobo / 100n;
  const remainder = kobo % 100n;
  return `₦${naira.toLocaleString()}.${remainder.toString().padStart(2, '0')}`;
}

function expiresInLabel(expiresAt: string, now: Date): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'in <1 min';
  if (mins < 60) return `in ${mins} min`;
  return `in ${Math.floor(mins / 60)} h`;
}

export function BumpsInboxScreen({ navigation }: Props): JSX.Element {
  const status = useBumpsStore((s) => s.status);
  const isRefreshing = useBumpsStore((s) => s.status === 'loading');
  const pending = useBumpsStore((s) => s.pending);
  const history = useBumpsStore((s) => s.history);
  const errorCode = useBumpsStore((s) => s.errorCode);
  const decidingId = useBumpsStore((s) => s.decidingId);
  const refresh = useBumpsStore((s) => s.refresh);
  const decide = useBumpsStore((s) => s.decide);
  const permissionStatus = usePushStore((s) => s.permissionStatus);
  const theme = useTheme();

  // Refresh on focus.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // First-open: show enable-notifications explainer once if permission undetermined.
  useEffect(() => {
    void (async () => {
      if (permissionStatus !== 'undetermined') return;
      const shown = await AsyncStorage.getItem(PROMPT_SHOWN_KEY);
      if (shown) return;
      await AsyncStorage.setItem(PROMPT_SHOWN_KEY, '1');
      navigation.navigate('EnableNotifications');
    })();
  }, [permissionStatus, navigation]);

  const now = useMemo(() => new Date(), []);

  const renderPending = ({ item }: { item: BumpRequest }) => (
    <Card style={{ gap: 8 }}>
      <AmountText size="lg" value={formatNaira(item.amountKobo)} sentiment="debit" />
      <Body strong>{item.vendorResolvedName}</Body>
      <Caption>Expires {expiresInLabel(item.expiresAt, now)}</Caption>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Button
          label="APPROVE"
          onPress={() => void decide(item.id, 'approve_once')}
          disabled={decidingId !== null}
          loading={decidingId === item.id}
        />
        <Button
          variant="secondary"
          label="DENY"
          onPress={() => void decide(item.id, 'deny')}
          disabled={decidingId !== null}
        />
      </View>
    </Card>
  );

  const renderHistory = ({ item }: { item: BumpRequest }) => (
    <Card style={{ gap: 8, opacity: 0.6 }}>
      <AmountText size="md" value={formatNaira(item.amountKobo)} sentiment="neutral" />
      <Body>{item.vendorResolvedName}</Body>
      <Badge label={statusLabel(item.status)} variant="neutral" />
    </Card>
  );

  // Only show the full-screen loader on initial load (no data yet).
  const hasData = pending.length > 0 || history.length > 0;
  if ((status === 'idle' || status === 'loading') && !hasData) {
    return (
      <Screen title="Requests">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Skeleton lines={3} />
        </View>
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen title="Requests">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <Body style={{ color: theme.colors.debit }}>Couldn&apos;t load: {errorCode}</Body>
          <Button label="RETRY" onPress={() => void refresh()} />
        </View>
      </Screen>
    );
  }

  if (pending.length === 0 && history.length === 0) {
    return (
      <Screen title="Requests">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Body muted>No requests need your decision.</Body>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Requests" noPadding>
      <FlatList
        contentContainerStyle={{ padding: 16, gap: 12 }}
        data={[
          ...pending.map((b) => ({ kind: 'pending' as const, b })),
          ...history.map((b) => ({ kind: 'history' as const, b })),
        ]}
        keyExtractor={(row) => row.b.id}
        ListHeaderComponent={pending.length > 0 ? <SectionHeader title="PENDING" /> : null}
        renderItem={({ item, index }) => {
          const showHistoryHeader =
            item.kind === 'history' && (index === 0 || (index > 0 && pending.length === index));
          return (
            <>
              {showHistoryHeader && <SectionHeader title="RECENT" />}
              {item.kind === 'pending'
                ? renderPending({ item: item.b })
                : renderHistory({ item: item.b })}
            </>
          );
        }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} />}
      />
    </Screen>
  );
}
