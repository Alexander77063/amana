import type { NotificationChannel, NotificationKind } from '@amana/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Couldn&apos;t load: {errorCode}</Text>
        <Pressable style={styles.button} onPress={() => void bootstrap()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Pressable
        style={styles.qhRow}
        onPress={() => navigation.navigate('QuietHours')}
      >
        <Text style={styles.qhTitle}>Quiet hours</Text>
        <Text style={styles.qhSummary}>{quietWindowSummary(quietHours)}</Text>
      </Pressable>
      <FlatList
        contentContainerStyle={styles.container}
        data={KINDS}
        keyExtractor={(k) => k}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => navigation.navigate('NotificationKindDetail', { kind: item })}
          >
            <Text style={styles.rowTitle}>{kindTitle(item)}</Text>
            <Text style={styles.muted}>{summarize(item)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  row: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
  },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  muted: { color: '#666' },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  buttonText: { color: 'white', fontWeight: '600' },
  qhRow: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
    backgroundColor: '#fafafa',
  },
  qhTitle: { fontSize: 16, fontWeight: '600' },
  qhSummary: { color: '#666' },
});
