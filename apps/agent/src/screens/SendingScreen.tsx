import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Sending'>;

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 10;

export function SendingScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId } = route.params;
  const done = useRef(false);

  const navigateResult = (status: string) => {
    if (done.current) return;
    done.current = true;
    if (status === 'settled') {
      navigation.replace('Receipt', { transactionId });
    } else {
      navigation.replace('Failed', { transactionId, errorMessage: null });
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: navigateResult omitted — done.current guards double-fire
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      if (
        (data.kind === 'txn_settled' || data.kind === 'txn_failed') &&
        data.transactionId === transactionId
      ) {
        navigateResult(data.kind === 'txn_settled' ? 'settled' : 'failed');
      }
    });
    return () => sub.remove();
  }, [transactionId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: navigateResult omitted — done.current guards double-fire
  useEffect(() => {
    let polls = 0;
    const poll = async () => {
      if (done.current) return;
      try {
        const r = await api.transaction.getById(transactionId);
        const status = r.transaction.status;
        if (status !== 'in_flight' && status !== 'rule_eval' && status !== 'draft') {
          navigateResult(status);
          return;
        }
      } catch {
        // Network error — keep polling
      }
      polls += 1;
      if (polls >= MAX_POLLS) {
        navigateResult('failed');
        return;
      }
      setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    setTimeout(() => void poll(), POLL_INTERVAL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.title}>Sending payment…</Text>
      <Text style={styles.sub}>This usually takes under 10 seconds.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  sub: { color: '#666', textAlign: 'center' },
});
