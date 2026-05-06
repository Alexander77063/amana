import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { BumpRequest, BumpStatus } from '@amana/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
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
  const pending = useBumpsStore((s) => s.pending);
  const history = useBumpsStore((s) => s.history);
  const errorCode = useBumpsStore((s) => s.errorCode);
  const decidingId = useBumpsStore((s) => s.decidingId);
  const refresh = useBumpsStore((s) => s.refresh);
  const decide = useBumpsStore((s) => s.decide);
  const permissionStatus = usePushStore((s) => s.permissionStatus);

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
    <View style={styles.card}>
      <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
      <Text style={styles.vendor}>{item.vendorResolvedName}</Text>
      <Text style={styles.muted}>Expires {expiresInLabel(item.expiresAt, now)}</Text>
      <View style={styles.actions}>
        <Pressable
          style={[styles.button, decidingId === item.id && styles.disabled]}
          disabled={decidingId !== null}
          onPress={() => void decide(item.id, 'approve_once')}
        >
          <Text style={styles.buttonText}>Approve</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.deny, decidingId === item.id && styles.disabled]}
          disabled={decidingId !== null}
          onPress={() => void decide(item.id, 'deny')}
        >
          <Text style={styles.buttonText}>Deny</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderHistory = ({ item }: { item: BumpRequest }) => (
    <View style={[styles.card, styles.dim]}>
      <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
      <Text style={styles.vendor}>{item.vendorResolvedName}</Text>
      <Text style={styles.pill}>{statusLabel(item.status)}</Text>
    </View>
  );

  if (status === 'idle' || status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Couldn&apos;t load: {errorCode}</Text>
        <Pressable style={styles.button} onPress={() => void refresh()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (pending.length === 0 && history.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No requests need your decision.</Text>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={[
        ...pending.map((b) => ({ kind: 'pending' as const, b })),
        ...history.map((b) => ({ kind: 'history' as const, b })),
      ]}
      keyExtractor={(row) => row.b.id}
      ListHeaderComponent={
        pending.length > 0 ? <Text style={styles.section}>Pending</Text> : null
      }
      renderItem={({ item, index }) => {
        const showHistoryHeader =
          item.kind === 'history' &&
          (index === 0 || (index > 0 && pending.length === index));
        return (
          <>
            {showHistoryHeader && <Text style={styles.section}>Recent</Text>}
            {item.kind === 'pending' ? renderPending({ item: item.b }) : renderHistory({ item: item.b })}
          </>
        );
      }}
      refreshControl={
        <RefreshControl refreshing={status === 'loading'} onRefresh={() => void refresh()} />
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  section: { fontSize: 12, fontWeight: '600', color: '#666', textTransform: 'uppercase', marginTop: 8 },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f3f3f3', gap: 6 },
  dim: { opacity: 0.6 },
  amount: { fontSize: 22, fontWeight: '700' },
  vendor: { fontSize: 14, color: '#444' },
  muted: { color: '#666' },
  err: { color: '#b00020' },
  pill: {
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#e0e0e0',
    color: '#222',
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  deny: { backgroundColor: '#b00020' },
  disabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600' },
});
