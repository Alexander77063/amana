import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError } from '@amana/api-client';
import type { TransactionDetail } from '@amana/types';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../lib/api';
import type { HistoryStackParamList } from '../nav/HistoryStack';

type Props = NativeStackScreenProps<HistoryStackParamList, 'TransactionDetail'>;

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | { kind: 'ready'; txn: TransactionDetail };

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS_LABEL: Record<string, string> = {
  settled: 'Settled',
  failed: 'Failed',
  reversed: 'Reversed',
  bump_pending: 'Awaiting decision',
  in_flight: 'Sending…',
  rule_eval: 'Evaluating…',
  draft: 'Draft',
};

export function TransactionDetailScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId } = route.params;
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });

  useFocusEffect(
    useCallback(() => {
      setState({ kind: 'loading' });
      api.transaction
        .getById(transactionId)
        .then((r) => setState({ kind: 'ready', txn: r.transaction }))
        .catch((e: unknown) => {
          const code = e instanceof ApiError ? e.code : 'unknown_error';
          setState({ kind: 'error', code });
        });
    }, [transactionId]),
  );

  if (state.kind === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Could not load transaction: {state.code}</Text>
      </View>
    );
  }

  const { txn } = state;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.amount}>{formatNaira(txn.amountKobo)}</Text>
      <Text style={styles.status}>{STATUS_LABEL[txn.status] ?? txn.status}</Text>

      <View style={styles.section}>
        {txn.vendorResolvedName && <Text style={styles.field}>To: {txn.vendorResolvedName}</Text>}
        {txn.vendorAccountMasked && <Text style={styles.field}>{txn.vendorAccountMasked}</Text>}
        <Text style={styles.field}>Initiated: {formatDateTime(txn.initiatedAt)}</Text>
        {txn.settledAt && <Text style={styles.field}>Settled: {formatDateTime(txn.settledAt)}</Text>}
        {txn.nibssSessionId && (
          <Text style={styles.field} selectable>
            NIBSS: {txn.nibssSessionId}
          </Text>
        )}
        {txn.agentNote && <Text style={styles.field}>Note: {txn.agentNote}</Text>}
        {txn.errorMessage && <Text style={[styles.field, styles.errField]}>Error: {txn.errorMessage}</Text>}
        {txn.anomalyScore !== null && txn.anomalyScore >= 0.85 && (
          <Text style={[styles.field, styles.anomaly]}>⚠ Anomaly score: {txn.anomalyScore.toFixed(2)}</Text>
        )}
      </View>

      {txn.status === 'settled' && (
        <Pressable
          style={styles.addPhotoBtn}
          onPress={() =>
            navigation.getParent()?.navigate('PhotoAttach', { transactionId })
          }
        >
          <Text style={styles.addPhotoText}>Add photo</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 24, gap: 8 },
  amount: { fontSize: 40, fontWeight: '800', textAlign: 'center' },
  status: { textAlign: 'center', color: '#666', marginBottom: 8 },
  section: { gap: 6 },
  field: { fontSize: 14, color: '#444' },
  errField: { color: '#b00020' },
  anomaly: { color: '#a15a00', fontWeight: '600' },
  addPhotoBtn: {
    marginTop: 16,
    backgroundColor: '#1a1a2e',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  addPhotoText: { color: 'white', fontWeight: '600' },
  err: { color: '#b00020' },
});
