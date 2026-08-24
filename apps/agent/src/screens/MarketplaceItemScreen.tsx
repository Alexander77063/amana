import type { MarketplaceItem } from '@amana/api-client';
import { ApiError } from '@amana/api-client';
import { Body, Button, Caption, Card, Label, Screen, formatNaira, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'MarketplaceItem'>;

/** Human wording for the reasons the rule engine can give back on a purchase. */
const DENIAL_COPY: Record<string, string> = {
  CATEGORY_NOT_ALLOWED: 'This is not one of the things you are allowed to buy.',
  MERCHANT_NOT_ALLOWED: 'This shop has not been approved for your wallet.',
  OUTSIDE_TIME_WINDOW: 'This is outside the hours you are allowed to spend in.',
  LIMIT_EXCEEDED: 'This would go over your spending limit.',
};

export function MarketplaceItemScreen({ navigation, route }: Props): JSX.Element {
  const theme = useTheme();
  const { itemId } = route.params;
  const [item, setItem] = useState<MarketplaceItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        // The browse list is already scoped to this agent, so finding the item in it is also the
        // check that they are allowed to see it at all.
        const { items } = await api.marketplace.items();
        setItem(items.find((i) => i.id === itemId) ?? null);
      } catch {
        setError('Could not load this item.');
      }
    })();
  }, [itemId]);

  async function buy() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const { voucher } = await api.marketplace.purchase({
        catalogItemId: item.id,
        // The server prices from the catalogue; sending a price would be a spoof vector.
        idempotencyKey: `mkt:${item.id}:${Date.now()}`,
      });
      navigation.replace('Voucher', { voucherId: voucher.id });
    } catch (e) {
      if (e instanceof ApiError) {
        const reasons = (e.body as { reasons?: string[] } | undefined)?.reasons ?? [];
        const first = reasons.find((r) => DENIAL_COPY[r]);
        // Say WHICH rule stopped it. "Something went wrong" would leave the agent unable to tell
        // whether to ask their parent or simply wait until morning.
        setError(first ? DENIAL_COPY[first] : 'That purchase was not allowed.');
      } else {
        setError('Could not complete that purchase.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!item) {
    return (
      <Screen title="Item">
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          {error ? <Body>{error}</Body> : <ActivityIndicator color={theme.colors.accent} />}
        </View>
      </Screen>
    );
  }

  const discounted = item.effectiveKobo !== item.grossKobo;

  return (
    <Screen title={item.name} scrollable>
      <Card>
        <Label>PRICE</Label>
        <Body strong>{formatNaira(item.effectiveKobo)}</Body>
        {discounted ? (
          <Caption>{`Normally ${formatNaira(item.grossKobo)} — a deal is running`}</Caption>
        ) : null}
      </Card>

      <Card>
        <Label>SHOP</Label>
        <Body>{item.retailerName}</Body>
        {item.description ? <Caption>{item.description}</Caption> : null}
        {item.durationMinutes ? (
          <Caption>{`Takes about ${item.durationMinutes} minutes`}</Caption>
        ) : null}
      </Card>

      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      <Button
        label={busy ? 'BUYING…' : 'BUY VOUCHER'}
        onPress={() => void buy()}
        disabled={busy}
        loading={busy}
      />
      <Caption>
        You will get a code to show at the shop. The money leaves your wallet now and reaches the
        shop when they mark it delivered.
      </Caption>
    </Screen>
  );
}
