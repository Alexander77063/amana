import type { Voucher } from '@amana/api-client';
import { Body, Caption, Card, Label, Screen, formatNaira, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Voucher'>;

const STATUS_COPY: Record<string, string> = {
  reserved: 'Show this code at the shop.',
  redeemed: 'Used. The shop has been paid.',
  expired: 'Expired — the money went back to the wallet.',
  refunded: 'Refunded to the wallet.',
};

/**
 * The voucher itself: a short code the agent reads out or shows.
 *
 * Deliberately a code and not a QR image. The retailer's own redeem screen takes a keyed code for
 * the same reason — a scanner that half-works at a counter is worse than something that always
 * does, and a code survives a cracked screen, a dim shop and a flat battery on either side.
 */
export function VoucherScreen({ route }: Props): JSX.Element {
  const theme = useTheme();
  const { voucherId } = route.params;
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { vouchers } = await api.marketplace.vouchers();
        setVoucher(vouchers.find((v) => v.id === voucherId) ?? null);
      } catch {
        setError('Could not load this voucher.');
      }
    })();
  }, [voucherId]);

  if (!voucher) {
    return (
      <Screen title="Voucher">
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          {error ? <Body>{error}</Body> : <ActivityIndicator color={theme.colors.accent} />}
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Your voucher" scrollable>
      <Card>
        <Label>SHOW THIS CODE</Label>
        {/* Large and widely spaced because this is read aloud across a counter, often from a
            cracked screen in a bright shop. Body takes no accessibility props, so the label goes
            on the wrapping view where a screen reader will reach it. */}
        <View accessible accessibilityLabel={`Voucher code ${voucher.code.split('').join(' ')}`}>
          <Body strong style={{ fontSize: 30, letterSpacing: 3 }}>
            {voucher.code}
          </Body>
        </View>
        <Caption>{STATUS_COPY[voucher.status] ?? voucher.status}</Caption>
      </Card>

      <Card>
        <Label>PAID</Label>
        <Body strong>{formatNaira(voucher.discountedKobo)}</Body>
        {voucher.discountedKobo !== voucher.grossKobo ? (
          <Caption>{`Saved ${formatNaira(
            (BigInt(voucher.grossKobo) - BigInt(voucher.discountedKobo)).toString(),
          )}`}</Caption>
        ) : null}
      </Card>

      <Card>
        <Label>VALID UNTIL</Label>
        <Body>{new Date(voucher.expiresAt).toLocaleString()}</Body>
        {/* Expiry is not a penalty — it is what returns the buyer's money if the shop never
            delivers, so it is worth stating rather than hiding in small print. */}
        <Caption>If you do not use it by then, the money goes back to the wallet.</Caption>
      </Card>
    </Screen>
  );
}
