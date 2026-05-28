import { AmountText, Body, Button, Card, Label, Screen, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
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
  const theme = useTheme();
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
      <Screen title="Receipt">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      </Screen>
    );
  }

  if (!txn) {
    return (
      <Screen title="Receipt">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Body muted>Could not load receipt.</Body>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Receipt" scrollable>
      <View style={{ alignItems: 'center', paddingVertical: 24 }}>
        <AmountText size="xl" value={formatNaira(txn.amountKobo)} sentiment="credit" />
      </View>

      <Card accent style={{ gap: 12 }}>
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
      </Card>

      <View style={{ gap: 12, marginTop: 24 }}>
        <Button
          variant="secondary"
          label="SHOW RECIPIENT"
          onPress={() =>
            navigation.navigate('ShowRecipient', {
              amountKobo: txn.amountKobo,
              resolvedName: txn.vendorResolvedName ?? '—',
              sessionId: txn.nibssSessionId ?? '',
            })
          }
        />

        {!txn.attachedMedia && (
          <Button
            variant="secondary"
            label="ADD PHOTO"
            onPress={() => navigation.navigate('PhotoAttach', { transactionId })}
          />
        )}

        {Boolean(txn.attachedMedia) && (
          <Body style={{ textAlign: 'center', color: theme.colors.credit }}>Photo attached</Body>
        )}

        <Button variant="ghost" label="DONE" onPress={() => navigation.popToTop()} />
      </View>
    </Screen>
  );
}
