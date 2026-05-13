import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Failed'>;

const ERROR_LABELS: Record<string, string> = {
  CANCELLED_BY_AGENT: 'You cancelled this payment.',
  BUMP_DENIED: 'Your principal declined the payment.',
  BUMP_EXPIRED: 'The approval request expired.',
  INSUFFICIENT_FUNDS: 'Insufficient funds in sub-wallet.',
  NIP_FAILURE: 'The bank transfer failed. No funds were deducted.',
};

export function FailedScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId, errorMessage: passedError } = route.params;
  const [fetchedError, setFetchedError] = useState<string | null>(null);

  useEffect(() => {
    if (passedError !== null) return;
    api.transaction
      .getById(transactionId)
      .then((r) => {
        const txn = r.transaction as { errorMessage?: string | null };
        setFetchedError(txn.errorMessage ?? null);
      })
      .catch(() => {});
  }, [transactionId, passedError]);

  const errorCode = passedError ?? fetchedError ?? 'UNKNOWN';
  const errorLabel = ERROR_LABELS[errorCode] ?? `Error: ${errorCode}`;

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>✕</Text>
      <Text style={styles.title}>Payment failed</Text>
      <Text style={styles.reason}>{errorLabel}</Text>
      <View style={styles.actions}>
        <Pressable style={styles.retryBtn} onPress={() => navigation.popToTop()}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
        <Pressable style={styles.dismissBtn} onPress={() => navigation.popToTop()}>
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  icon: { fontSize: 56, color: '#b00020' },
  title: { fontSize: 24, fontWeight: '700' },
  reason: { fontSize: 16, color: '#666', textAlign: 'center' },
  actions: { gap: 12, width: '100%', marginTop: 16 },
  retryBtn: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  retryText: { color: 'white', fontWeight: '600', fontSize: 15 },
  dismissBtn: { paddingVertical: 14, alignItems: 'center' },
  dismissText: { color: '#888', fontSize: 15 },
});
