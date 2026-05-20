import { ApiError } from '@amana/api-client';
import type { TransactionDetail } from '@amana/types';
import { AmountText, Badge, Body, Button, Card, Caption, Label, Screen, Skeleton, useTheme } from '@amana/ui';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import {
  Linking,
  Pressable,
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

function statusBadgeVariant(status: TransactionDetail['status']): {
  variant: 'success' | 'error' | 'warning' | 'neutral';
  label: string;
} {
  switch (status) {
    case 'settled':
      return { variant: 'success', label: 'Settled' };
    case 'failed':
      return { variant: 'error', label: 'Failed' };
    case 'reversed':
      return { variant: 'neutral', label: 'Reversed' };
    case 'bump_pending':
      return { variant: 'warning', label: 'Awaiting decision' };
    case 'in_flight':
      return { variant: 'neutral', label: 'Sending…' };
    case 'rule_eval':
    case 'draft':
      return { variant: 'neutral', label: 'In progress' };
  }
}

export function TransactionDetailScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId } = route.params;
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const theme = useTheme();

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
      <Screen title="Transaction">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Skeleton />
        </View>
      </Screen>
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
      <Screen title="Transaction">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <Body style={{ color: theme.colors.debit }}>{message}</Body>
          {showRetry ? (
            <Button
              label="RETRY"
              onPress={() => {
                setState({ kind: 'loading' });
                void api.transaction
                  .getById(transactionId)
                  .then((r) => setState({ kind: 'ready', txn: r.transaction }))
                  .catch((e) => setState({ kind: 'error', code: ERR(e) }));
              }}
            />
          ) : (
            <Button label="BACK" onPress={() => navigation.goBack()} />
          )}
        </View>
      </Screen>
    );
  }

  const { txn } = state;
  const badge = statusBadgeVariant(txn.status);
  const showAnomaly = txn.anomalyScore !== null && txn.anomalyScore >= 0.85;
  const initiatorLabel = txn.initiatedBy.role === 'principal' ? 'You' : txn.initiatedBy.displayName;
  const subWalletLabel = txn.subWallet ? txn.subWallet.name : 'Direct from master wallet';
  const sentiment = txn.status === 'settled' ? 'debit' : 'neutral';

  return (
    <Screen title="Transaction" scrollable>
      <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}>
        <AmountText size="xl" value={formatNaira(txn.amountKobo)} sentiment={sentiment} />
        <Badge variant={badge.variant} label={badge.label} />
      </View>

      {txn.vendorResolvedName ? (
        <Body strong style={{ textAlign: 'center' }}>{txn.vendorResolvedName}</Body>
      ) : null}
      {txn.vendorBankCode || txn.vendorAccountMasked ? (
        <Caption style={{ textAlign: 'center' }}>
          {[txn.vendorBankCode, txn.vendorAccountMasked].filter(Boolean).join(' ')}
        </Caption>
      ) : null}

      {txn.status === 'bump_pending' ? (
        <Card accent style={{ gap: 8 }}>
          <Body style={{ color: theme.colors.accent }}>⏳ Awaiting your decision</Body>
          <Button
            variant="secondary"
            label="REVIEW REQUEST"
            onPress={() => navigation.navigate('BumpsInbox')}
          />
        </Card>
      ) : null}

      {txn.status === 'failed' && txn.errorMessage ? (
        <Card accent style={{ borderColor: theme.colors.debit }}>
          <Body style={{ color: theme.colors.debit }}>{txn.errorMessage}</Body>
        </Card>
      ) : null}

      <Card style={{ gap: 12 }}>
        <Row label="Sub-wallet" value={subWalletLabel} />
        <Row label="Initiated by" value={`${initiatorLabel} · ${txn.initiatedBy.role}`} />
        <Row label="Initiated" value={formatDateTime(txn.initiatedAt)} />
        {txn.status === 'settled' && txn.settledAt ? (
          <Row label="Settled" value={formatDateTime(txn.settledAt)} />
        ) : null}
      </Card>

      {txn.agentNote ? (
        <Card>
          <Body style={{ fontStyle: 'italic' }}>📝 "{txn.agentNote}"</Body>
        </Card>
      ) : null}

      {showAnomaly ? (
        <Card>
          <Body style={{ color: theme.colors.accent }}>
            ⚠ Anomaly score {txn.anomalyScore?.toFixed(2) ?? ''}
          </Body>
        </Card>
      ) : null}

      {txn.geolocation ? (
        <Pressable
          onPress={() => {
            const geo = txn.geolocation;
            if (!geo) return;
            void Linking.openURL(
              `https://www.google.com/maps/search/?api=1&query=${geo.lat},${geo.lng}`,
            );
          }}
        >
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Body style={{ color: theme.colors.accent }}>📍 View location</Body>
            <Body muted>›</Body>
          </Card>
        </Pressable>
      ) : null}

      {txn.nibssSessionId ? (
        <Card style={{ gap: 8 }}>
          <Label>RECEIPT</Label>
          <Row label="NIBSS session" value={txn.nibssSessionId} />
        </Card>
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Label>{label}</Label>
      <Body style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Body>
    </View>
  );
}
