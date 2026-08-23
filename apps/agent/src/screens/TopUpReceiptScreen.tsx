import type { VasPurchase } from '@amana/api-client';
import {
  AmountText,
  Badge,
  Body,
  Button,
  Card,
  Label,
  Screen,
  Skeleton,
  useTheme,
} from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'TopUpReceipt'>;

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 10;

const naira = (k: string) =>
  `₦${(Number(k) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, string> = {
  pending: 'Sending…',
  in_flight: 'Sending…',
  settled: 'Delivered',
  failed: 'Failed — refunded',
};

export function TopUpReceiptScreen({ route, navigation }: Props): JSX.Element {
  const theme = useTheme();
  const { purchaseId } = route.params;
  const [purchase, setPurchase] = useState<VasPurchase | null>(null);

  // A bill can settle inline or land later on a webhook, so poll until it reaches a terminal
  // state rather than showing a status that will quietly go stale on screen.
  useEffect(() => {
    let alive = true;
    let polls = 0;
    const tick = async () => {
      if (!alive) return;
      try {
        const { purchases } = await api.vas.listPurchases();
        const found = purchases.find((p) => p.id === purchaseId) ?? null;
        if (!alive) return;
        if (found) setPurchase(found);
        if (found && (found.status === 'settled' || found.status === 'failed')) return;
      } catch {
        // Transient — keep polling.
      }
      polls += 1;
      if (alive && polls < MAX_POLLS) setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [purchaseId]);

  if (!purchase) {
    return (
      <Screen title="Receipt">
        <Skeleton />
      </Screen>
    );
  }

  const failed = purchase.status === 'failed';
  const settled = purchase.status === 'settled';

  return (
    <Screen title="Receipt" scrollable>
      <View style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <AmountText
          size="xl"
          value={naira(purchase.amountKobo)}
          sentiment={failed ? 'debit' : 'credit'}
        />
        <Badge
          label={STATUS_LABEL[purchase.status] ?? purchase.status}
          variant={failed ? 'warning' : 'neutral'}
        />
      </View>

      <Card style={{ gap: 10 }}>
        <View>
          <Label>TO</Label>
          <Body strong>{purchase.customerName ?? purchase.recipient}</Body>
        </View>
        <View>
          <Label>PROVIDER</Label>
          <Body>{purchase.provider.toUpperCase()}</Body>
        </View>
        {purchase.productSlug ? (
          <View>
            <Label>BUNDLE</Label>
            <Body>{purchase.productSlug}</Body>
          </View>
        ) : null}
        {purchase.completedAt ? (
          <View>
            <Label>COMPLETED</Label>
            <Body>{new Date(purchase.completedAt).toLocaleString()}</Body>
          </View>
        ) : null}
      </Card>

      {/* The prepaid electricity token is the thing the customer actually needs. */}
      {purchase.token ? (
        <Card style={{ gap: 4 }}>
          <Label>PREPAID TOKEN</Label>
          <Body strong style={{ fontSize: 20, letterSpacing: 2 }}>
            {purchase.token}
          </Body>
          <Body muted>Enter this on the meter.</Body>
        </Card>
      ) : null}

      {failed ? (
        <Body style={{ color: theme.colors.debit }}>
          The biller could not deliver this. The money has been returned to the wallet.
        </Body>
      ) : null}

      {!settled && !failed ? (
        <Body muted>Waiting for the provider to confirm. This usually takes a few seconds.</Body>
      ) : null}

      <Button label="DONE" onPress={() => navigation.replace('CaptureMethod')} />
    </Screen>
  );
}
