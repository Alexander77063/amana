import { Body, Screen, Skeleton, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Sending'>;

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 10;

export function SendingScreen({ route, navigation }: Props): JSX.Element {
  const theme = useTheme();
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
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <View style={{ width: '70%', gap: 12 }}>
          <Skeleton height={24} borderRadius={6} />
          <Skeleton height={16} width="80%" borderRadius={6} />
          <Skeleton height={16} width="60%" borderRadius={6} />
        </View>
        <Body strong>Sending payment…</Body>
        <Body muted>This usually takes under 10 seconds.</Body>
      </View>
    </Screen>
  );
}
