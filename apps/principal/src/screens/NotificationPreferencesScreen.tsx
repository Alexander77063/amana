import type { NotificationChannel, NotificationKind } from '@amana/types';
import { Body, Button, Caption, Card, Screen, Skeleton, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { quietWindowSummary } from '../lib/quiet-window-summary';
import type { MainStackParamList } from '../nav/MainStack';
import { usePreferencesStore } from '../state/preferences.store';

type Props = NativeStackScreenProps<MainStackParamList, 'NotificationPreferences'>;

const KINDS: NotificationKind[] = [
  'bump_requested',
  'bump_decided',
  'txn_settled',
  'txn_failed',
  'anomaly_alert',
  'refund_received',
];

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: 'Push',
  in_app: 'In-app',
  sms: 'SMS',
};

function kindTitle(kind: NotificationKind): string {
  switch (kind) {
    case 'bump_requested':
      return 'Bump requests';
    case 'bump_decided':
      return 'Bump decisions';
    case 'txn_settled':
      return 'Payments sent';
    case 'txn_failed':
      return 'Failed payments';
    case 'anomaly_alert':
      return 'Anomaly alerts';
    case 'refund_received':
      return 'Refunds received';
  }
}

export function NotificationPreferencesScreen({ navigation }: Props): JSX.Element {
  const status = usePreferencesStore((s) => s.status);
  const rowCount = usePreferencesStore((s) => s.rows.length);
  const errorCode = usePreferencesStore((s) => s.errorCode);
  const bootstrap = usePreferencesStore((s) => s.bootstrap);
  const getEffective = usePreferencesStore((s) => s.getEffective);
  const quietHours = usePreferencesStore((s) => s.quietHours);
  const theme = useTheme();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const summarize = (kind: NotificationKind): string => {
    const channels: NotificationChannel[] = ['push', 'in_app', 'sms'];
    const on = channels.filter((c) => getEffective(kind, c).preference !== 'silent');
    if (on.length === 0) return 'Off';
    const labels = on.map((c) => CHANNEL_LABELS[c]);
    return labels.join(', ');
  };

  if (status === 'idle' || (status === 'loading' && rowCount === 0)) {
    return (
      <Screen title="Notification preferences">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Skeleton />
        </View>
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen title="Notification preferences">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <Body style={{ color: theme.colors.debit }}>{`Couldn't load: ${errorCode ?? ''}`}</Body>
          <Button label="RETRY" onPress={() => void bootstrap()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Notification preferences" noPadding>
      <Pressable onPress={() => navigation.navigate('QuietHours')}>
        <Card style={{ flexDirection: 'row', justifyContent: 'space-between', margin: 16, marginBottom: 0 }}>
          <Body strong>Quiet hours</Body>
          <Caption>{quietWindowSummary(quietHours)}</Caption>
        </Card>
      </Pressable>
      <FlatList
        contentContainerStyle={{ paddingVertical: 8 }}
        data={KINDS}
        keyExtractor={(k) => k}
        renderItem={({ item }) => (
          <Pressable
            style={{
              paddingHorizontal: 24,
              paddingVertical: 16,
              borderBottomWidth: 0.5,
              borderBottomColor: theme.colors.border,
              gap: 4,
            }}
            onPress={() => navigation.navigate('NotificationKindDetail', { kind: item })}
          >
            <Body strong>{kindTitle(item)}</Body>
            <Body muted>{summarize(item)}</Body>
          </Pressable>
        )}
      />
    </Screen>
  );
}
