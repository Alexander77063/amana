import { AmountText, Badge, Body, Button, Heading, Screen, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
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
  const theme = useTheme();
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
    <Screen title="Payment Failed">
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Badge variant="error" label="FAILED" />
        <Heading size="lg">Payment failed</Heading>
        <Body muted style={{ textAlign: 'center' }}>{errorLabel}</Body>
        <View style={{ width: '100%', gap: 12, marginTop: 16 }}>
          <Button label="TRY AGAIN" onPress={() => navigation.popToTop()} />
          <Button
            variant="ghost"
            label="DISMISS"
            onPress={() => navigation.popToTop()}
          />
        </View>
      </View>
    </Screen>
  );
}
