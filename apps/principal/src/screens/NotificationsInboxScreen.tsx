import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { Notification, NotificationKind } from '@amana/types';
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
    const link = deepLinkFor(n.kind, n.payloadJson);
    if (link.kind === 'bump') {
      navigation.navigate('BumpsInbox');
    }
    // 'transaction' and 'none' deep-links are no-ops in v1 (mark-read only).
  };

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
        const body =
          typeof payload.vendorResolvedName === 'string'
            ? payload.vendorResolvedName
            : '';
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
      refreshControl={
        <RefreshControl refreshing={status === 'loading'} onRefresh={() => void refresh()} />
      }
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
