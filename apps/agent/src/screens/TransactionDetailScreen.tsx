import { ApiError } from '@amana/api-client';
import type { TransactionDetail } from '@amana/types';
import { AmountText, Badge, Body, Button, Card, Label, Screen, useTheme } from '@amana/ui';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
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

function statusVariant(status: string): 'success' | 'error' | 'warning' | 'neutral' {
  if (status === 'settled') return 'success';
  if (status === 'failed' || status === 'reversed') return 'error';
  if (status === 'bump_pending') return 'warning';
  return 'neutral';
}

export function TransactionDetailScreen({ route, navigation }: Props): JSX.Element {
  const theme = useTheme();
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
      <Screen title="Transaction">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      </Screen>
    );
  }

  if (state.kind === 'error') {
    return (
      <Screen title="Transaction">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Body muted>Could not load transaction: {state.code}</Body>
        </View>
      </Screen>
    );
  }

  const { txn } = state;

  return (
    <Screen title="Transaction" scrollable>
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }}>
        <AmountText size="xl" value={formatNaira(txn.amountKobo)} sentiment="debit" />
        <Badge label={STATUS_LABEL[txn.status] ?? txn.status} variant={statusVariant(txn.status)} />
      </View>

      <Card style={{ gap: 12 }}>
        {txn.vendorResolvedName && (
          <View style={{ gap: 2 }}>
            <Label>TO</Label>
            <Body>{txn.vendorResolvedName}</Body>
          </View>
        )}
        {txn.vendorAccountMasked && (
          <View style={{ gap: 2 }}>
            <Label>ACCOUNT</Label>
            <Body>{txn.vendorAccountMasked}</Body>
          </View>
        )}
        <View style={{ gap: 2 }}>
          <Label>INITIATED</Label>
          <Body>{formatDateTime(txn.initiatedAt)}</Body>
        </View>
        {txn.settledAt && (
          <View style={{ gap: 2 }}>
            <Label>SETTLED</Label>
            <Body>{formatDateTime(txn.settledAt)}</Body>
          </View>
        )}
        {txn.nibssSessionId && (
          <View style={{ gap: 2 }}>
            <Label>NIBSS SESSION</Label>
            <Body>{txn.nibssSessionId}</Body>
          </View>
        )}
        {txn.agentNote && (
          <View style={{ gap: 2 }}>
            <Label>NOTE</Label>
            <Body>{txn.agentNote}</Body>
          </View>
        )}
        {txn.errorMessage && (
          <View style={{ gap: 2 }}>
            <Label>ERROR</Label>
            <Body style={{ color: theme.colors.debit }}>{txn.errorMessage}</Body>
          </View>
        )}
        {txn.anomalyScore !== null && txn.anomalyScore >= 0.85 && (
          <View style={{ gap: 2 }}>
            <Label>ANOMALY SCORE</Label>
            <Body style={{ color: theme.colors.accent }}>{txn.anomalyScore.toFixed(2)}</Body>
          </View>
        )}
      </Card>

      {txn.status === 'settled' && (
        <View style={{ marginTop: 16 }}>
          <Button
            variant="secondary"
            label="ADD PHOTO"
            onPress={() => navigation.getParent()?.navigate('PhotoAttach', { transactionId })}
          />
        </View>
      )}
    </Screen>
  );
}
