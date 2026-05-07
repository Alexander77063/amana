import type { Notification, NotificationKind } from '@amana/types';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { deepLinkFor } from '../lib/push';
import type { MainStackParamList } from '../nav/MainStack';
import { useNotificationsStore } from '../state/notifications.store';

type Props = NativeStackScreenProps<MainStackParamList, 'NotificationsInbox'>;

function titleFor(kind: NotificationKind): string {
  switch (kind) {
    case 'bump_requested':
      return 'Bump request';
    case 'bump_decided':
      return 'Bump decided';
    case 'txn_settled':
      return 'Payment sent';
    case 'txn_failed':
      return 'Payment failed';
    case 'anomaly_alert':
      return 'Unusual activity';
    case 'refund_received':
      return 'Refund received';
  }
}

function relativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationsInboxScreen({ navigation }: Props): JSX.Element {
  const status = useNotificationsStore((s) => s.status);
  const isRefreshing = useNotificationsStore((s) => s.status === 'loading');
  const items = useNotificationsStore((s) => s.items);
  const errorCode = useNotificationsStore((s) => s.errorCode);
  const refresh = useNotificationsStore((s) => s.refresh);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        unreadCount > 0 ? (
          <Pressable onPress={() => void markAllRead()}>
            <Text style={styles.headerAction}>Mark all read</Text>
          </Pressable>
        ) : null,
    });
  }, [navigation, unreadCount, markAllRead]);

  const onTap = (n: Notification) => {
    void markRead(n.id);
    // The in-app row stores `payloadJson` as `{ title, body, data: { kind, bumpRequestId, ... } }`.
    // `deepLinkFor` expects the inner `data` sub-object — same contract as the push-tap path in App.tsx.
    const innerData = (n.payloadJson as { data?: unknown } | null)?.data;
    const link = deepLinkFor(n.kind, innerData);
    if (link.kind === 'bump') {
      navigation.navigate('BumpsInbox');
    } else if (link.kind === 'transaction') {
      navigation.navigate('TransactionDetail', { transactionId: link.transactionId });
    }
    // 'none' → mark-read only.
  };

  // Only show the full-screen loader on initial load (no items yet).
  // For pull-to-refresh and on-focus refreshes, the RefreshControl spinner handles the visual.
  if ((status === 'idle' || status === 'loading') && items.length === 0) {
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

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Nothing here yet.</Text>
      </View>
    );
  }

  const now = new Date();

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={items}
      keyExtractor={(n) => n.id}
      renderItem={({ item }) => {
        const unread = item.status !== 'read';
        const payload = (item.payloadJson ?? {}) as Record<string, unknown>;
        const body = typeof payload.body === 'string' ? payload.body : '';
        return (
          <Pressable style={styles.row} onPress={() => onTap(item)}>
            {unread && <View style={styles.dot} />}
            <View style={styles.rowText}>
              <Text style={[styles.title, unread && styles.bold]}>{titleFor(item.kind)}</Text>
              {body ? <Text style={styles.body}>{body}</Text> : null}
              <Text style={styles.muted}>{relativeTime(item.createdAt, now)}</Text>
            </View>
          </Pressable>
        );
      }}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 12,
    alignItems: 'flex-start',
  },
  rowText: { flex: 1, gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1769ff', marginTop: 6 },
  title: { fontSize: 14, color: '#222' },
  bold: { fontWeight: '700' },
  body: { fontSize: 14, color: '#444' },
  muted: { color: '#666', fontSize: 12 },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  buttonText: { color: 'white', fontWeight: '600' },
  headerAction: { color: '#1769ff', fontSize: 14, fontWeight: '600' },
});
