import type { Notification, NotificationKind } from '@amana/types';
import { Body, Button, Caption, Screen, Skeleton, useTheme } from '@amana/ui';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
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
  const theme = useTheme();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

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

  const headerRight =
    unreadCount > 0 ? (
      <Pressable onPress={() => void markAllRead()}>
        <Body style={{ color: theme.colors.accent }}>Mark all read</Body>
      </Pressable>
    ) : undefined;

  // Only show the full-screen loader on initial load (no items yet).
  if ((status === 'idle' || status === 'loading') && items.length === 0) {
    return (
      <Screen title="Notifications" headerRight={headerRight}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Skeleton lines={3} />
        </View>
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen title="Notifications" headerRight={headerRight}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <Body style={{ color: theme.colors.debit }}>Couldn&apos;t load: {errorCode}</Body>
          <Button label="RETRY" onPress={() => void refresh()} />
        </View>
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen title="Notifications" headerRight={headerRight}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Body muted>Nothing here yet.</Body>
        </View>
      </Screen>
    );
  }

  const now = new Date();

  return (
    <Screen title="Notifications" noPadding headerRight={headerRight}>
      <FlatList
        contentContainerStyle={{ paddingVertical: 8 }}
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => {
          const unread = item.status !== 'read';
          const payload = (item.payloadJson ?? {}) as Record<string, unknown>;
          const body = typeof payload.body === 'string' ? payload.body : '';
          return (
            <Pressable
              style={{
                flexDirection: 'row',
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: 0.5,
                borderBottomColor: theme.colors.border,
                gap: 12,
                alignItems: 'flex-start',
              }}
              onPress={() => onTap(item)}
            >
              {unread && (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.accent,
                    marginTop: 6,
                  }}
                />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Body strong={unread}>{titleFor(item.kind)}</Body>
                {body ? <Body>{body}</Body> : null}
                <Caption>{relativeTime(item.createdAt, now)}</Caption>
              </View>
            </Pressable>
          );
        }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} />}
      />
    </Screen>
  );
}
