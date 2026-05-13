import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'BumpWait'>;

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BumpWaitScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId, amountKobo, resolvedName, expiresAt } = route.params;
  const [msLeft, setMsLeft] = useState(() => new Date(expiresAt).getTime() - Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const navigated = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      setMsLeft(new Date(expiresAt).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (navigated.current) return;
      const data = notification.request.content.data as Record<string, unknown>;
      if (data.kind !== 'bump_decided' || data.transactionId !== transactionId) return;
      navigated.current = true;
      if (
        data.decision === 'approved' ||
        data.decision === 'approved_once' ||
        data.decision === 'raise_limit'
      ) {
        navigation.replace('Sending', { transactionId });
      } else {
        navigation.replace('Failed', {
          transactionId,
          errorMessage: `Bump ${String(data.decision ?? 'denied')}`,
        });
      }
    });
    return () => sub.remove();
  }, [navigation, transactionId]);

  const cancel = async () => {
    setCancelling(true);
    setErrorMsg(null);
    try {
      await api.bump.cancelBump(transactionId);
      navigation.replace('Failed', { transactionId, errorMessage: 'CANCELLED_BY_AGENT' });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Cancel failed.');
      setCancelling(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Awaiting principal approval</Text>
      <Text style={styles.amount}>{formatNaira(amountKobo)}</Text>
      <Text style={styles.vendor}>to {resolvedName}</Text>
      <View style={styles.timer}>
        <Text style={styles.timerLabel}>Expires in</Text>
        <Text style={[styles.timerValue, msLeft < 60_000 && styles.timerRed]}>
          {formatCountdown(msLeft)}
        </Text>
      </View>
      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}
      {cancelling ? (
        <ActivityIndicator />
      ) : (
        <Pressable style={styles.cancelBtn} onPress={() => void cancel()}>
          <Text style={styles.cancelText}>Cancel payment</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 18, fontWeight: '600', color: '#444', textAlign: 'center' },
  amount: { fontSize: 40, fontWeight: '800' },
  vendor: { fontSize: 16, color: '#666' },
  timer: { alignItems: 'center', marginTop: 8 },
  timerLabel: { fontSize: 13, color: '#888' },
  timerValue: { fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timerRed: { color: '#b00020' },
  err: { color: '#b00020' },
  cancelBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#b00020',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
  },
  cancelText: { color: '#b00020', fontWeight: '600' },
});
