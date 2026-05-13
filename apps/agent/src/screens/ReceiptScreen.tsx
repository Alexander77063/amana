import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Receipt'>;

type ReceiptTxn = {
  id: string;
  amountKobo: string;
  vendorResolvedName: string | null;
  vendorAccountMasked: string | null;
  settledAt: string | null;
  nibssSessionId: string | null;
  attachedMedia: unknown;
};

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

export function ReceiptScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId } = route.params;
  const [txn, setTxn] = useState<ReceiptTxn | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.transaction
      .getById(transactionId)
      .then((r) => setTxn(r.transaction as unknown as ReceiptTxn))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [transactionId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!txn) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Could not load receipt.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.amount}>{formatNaira(txn.amountKobo)}</Text>
      <Text style={styles.vendor}>{txn.vendorResolvedName ?? '—'}</Text>
      <Text style={styles.acct}>{txn.vendorAccountMasked ?? ''}</Text>
      {txn.settledAt && <Text style={styles.meta}>Settled {formatDateTime(txn.settledAt)}</Text>}
      {txn.nibssSessionId && (
        <Text style={styles.meta} selectable>
          NIBSS: {txn.nibssSessionId}
        </Text>
      )}

      <View style={styles.actions}>
        <Pressable
          style={styles.btn}
          onPress={() =>
            navigation.navigate('ShowRecipient', {
              amountKobo: txn.amountKobo,
              resolvedName: txn.vendorResolvedName ?? '—',
              sessionId: txn.nibssSessionId ?? '',
            })
          }
        >
          <Text style={styles.btnText}>Show recipient</Text>
        </Pressable>

        {!txn.attachedMedia && (
          <Pressable
            style={[styles.btn, styles.btnSecondary]}
            onPress={() => navigation.navigate('PhotoAttach', { transactionId })}
          >
            <Text style={[styles.btnText, styles.btnTextSecondary]}>Add photo</Text>
          </Pressable>
        )}

        {Boolean(txn.attachedMedia) && <Text style={styles.photoBadge}>📎 Photo attached</Text>}
      </View>

      <Pressable style={styles.doneBtn} onPress={() => navigation.popToTop()}>
        <Text style={styles.doneBtnText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 24, alignItems: 'center', gap: 8 },
  amount: { fontSize: 48, fontWeight: '800', marginBottom: 4 },
  vendor: { fontSize: 20, fontWeight: '600' },
  acct: { fontSize: 14, color: '#888' },
  meta: { fontSize: 13, color: '#666' },
  actions: { width: '100%', gap: 12, marginTop: 24 },
  btn: { backgroundColor: '#1a1a2e', paddingVertical: 14, borderRadius: 999, alignItems: 'center' },
  btnSecondary: { backgroundColor: '#f0f0f0' },
  btnText: { color: 'white', fontWeight: '600', fontSize: 15 },
  btnTextSecondary: { color: '#1a1a2e' },
  photoBadge: { textAlign: 'center', color: '#2e7d32', fontWeight: '600' },
  err: { color: '#b00020' },
  doneBtn: { marginTop: 16 },
  doneBtnText: { color: '#888', fontSize: 15 },
});
