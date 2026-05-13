import { ApiError } from '@amana/api-client';
import type { TransactionDetail } from '@amana/types';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../lib/api';
import type { MainStackParamList } from '../nav/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'TransactionDetail'>;

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | { kind: 'ready'; txn: TransactionDetail };

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

function formatNaira(amountKoboStr: string): string {
  const kobo = BigInt(amountKoboStr);
  const naira = Number(kobo) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusBadgeStyle(status: TransactionDetail['status']): {
  bg: string;
  fg: string;
  label: string;
} {
  switch (status) {
    case 'settled':
      return { bg: '#e6f7ec', fg: '#0a7a3b', label: 'Settled' };
    case 'failed':
      return { bg: '#fde7ea', fg: '#b00020', label: 'Failed' };
    case 'reversed':
      return { bg: '#eee', fg: '#444', label: 'Reversed' };
    case 'bump_pending':
      return { bg: '#fff4d6', fg: '#a15a00', label: 'Awaiting decision' };
    case 'in_flight':
      return { bg: '#e3f1ff', fg: '#1769ff', label: 'Sending…' };
    case 'rule_eval':
    case 'draft':
      return { bg: '#eee', fg: '#444', label: 'In progress' };
  }
}

export function TransactionDetailScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId } = route.params;
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });

  // Refetch on focus — txn status can change between visits (e.g. bump_pending → settled).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setState({ kind: 'loading' });
      void api.transaction
        .getById(transactionId)
        .then((r) => {
          if (!cancelled) setState({ kind: 'ready', txn: r.transaction });
        })
        .catch((e) => {
          if (!cancelled) setState({ kind: 'error', code: ERR(e) });
        });
      return () => {
        cancelled = true;
      };
    }, [transactionId]),
  );

  if (state.kind === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state.kind === 'error') {
    const message =
      state.code === 'principal_only'
        ? "You don't have access to this transaction"
        : state.code === 'not_found'
          ? 'Transaction not found'
          : "Couldn't load. Try again.";
    const showRetry = state.code !== 'principal_only' && state.code !== 'not_found';
    return (
      <View style={styles.center}>
        <Text style={styles.err}>{message}</Text>
        {showRetry ? (
          <Pressable
            style={styles.button}
            onPress={() => {
              setState({ kind: 'loading' });
              void api.transaction
                .getById(transactionId)
                .then((r) => setState({ kind: 'ready', txn: r.transaction }))
                .catch((e) => setState({ kind: 'error', code: ERR(e) }));
            }}
          >
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.button} onPress={() => navigation.goBack()}>
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const { txn } = state;
  const badge = statusBadgeStyle(txn.status);
  const showAnomaly = txn.anomalyScore !== null && txn.anomalyScore >= 0.85;
  const initiatorLabel = txn.initiatedBy.role === 'principal' ? 'You' : txn.initiatedBy.displayName;
  const subWalletLabel = txn.subWallet ? txn.subWallet.name : 'Direct from master wallet';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.amountRow}>
        <Text style={styles.amount}>{formatNaira(txn.amountKobo)}</Text>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
        </View>
      </View>

      {txn.vendorResolvedName ? <Text style={styles.vendor}>{txn.vendorResolvedName}</Text> : null}
      {txn.vendorBankCode || txn.vendorAccountMasked ? (
        <Text style={styles.muted}>
          {[txn.vendorBankCode, txn.vendorAccountMasked].filter(Boolean).join(' ')}
        </Text>
      ) : null}

      {txn.status === 'bump_pending' ? (
        <View style={styles.alertBanner}>
          <Text style={styles.alertBannerText}>⏳ Awaiting your decision</Text>
          <Pressable style={styles.bannerCta} onPress={() => navigation.navigate('BumpsInbox')}>
            <Text style={styles.bannerCtaText}>Review request</Text>
          </Pressable>
        </View>
      ) : null}

      {txn.status === 'failed' && txn.errorMessage ? (
        <View style={styles.failBanner}>
          <Text style={styles.failBannerText}>{txn.errorMessage}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Row label="Sub-wallet" value={subWalletLabel} />
        <Row label="Initiated by" value={`${initiatorLabel} · ${txn.initiatedBy.role}`} />
        <Row label="Initiated" value={formatDateTime(txn.initiatedAt)} />
        {txn.status === 'settled' && txn.settledAt ? (
          <Row label="Settled" value={formatDateTime(txn.settledAt)} />
        ) : null}
      </View>

      {txn.agentNote ? (
        <View style={styles.section}>
          <Text style={styles.note}>📝 “{txn.agentNote}”</Text>
        </View>
      ) : null}

      {showAnomaly ? (
        <View style={styles.section}>
          <Text style={styles.anomaly}>⚠ Anomaly score {txn.anomalyScore?.toFixed(2)}</Text>
        </View>
      ) : null}

      {txn.geolocation ? (
        <Pressable
          style={styles.locRow}
          onPress={() => {
            const geo = txn.geolocation;
            if (!geo) return;
            void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${geo.lat},${geo.lng}`);
          }}
        >
          <Text style={styles.locText}>📍 View location</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : null}

      {txn.nibssSessionId ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Receipt</Text>
          <Row label="NIBSS session" value={txn.nibssSessionId} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { fontSize: 28, fontWeight: '700', color: '#222' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  vendor: { fontSize: 18, fontWeight: '600', color: '#222' },
  muted: { color: '#666', fontSize: 13 },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  buttonText: { color: 'white', fontWeight: '600' },
  section: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
    gap: 8,
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { color: '#666', fontSize: 14 },
  rowValue: { color: '#222', fontSize: 14, flexShrink: 1, textAlign: 'right' },
  note: { fontSize: 14, color: '#444', fontStyle: 'italic' },
  anomaly: { fontSize: 14, color: '#a15a00', fontWeight: '600' },
  alertBanner: {
    backgroundColor: '#fff4d6',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  alertBannerText: { color: '#a15a00', fontWeight: '600', flex: 1 },
  bannerCta: {
    backgroundColor: '#a15a00',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  bannerCtaText: { color: 'white', fontWeight: '600', fontSize: 13 },
  failBanner: { backgroundColor: '#fde7ea', padding: 12, borderRadius: 8 },
  failBannerText: { color: '#b00020', fontSize: 14 },
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  locText: { color: '#1769ff', fontSize: 14, fontWeight: '500' },
  chevron: { color: '#888', fontSize: 18 },
});
