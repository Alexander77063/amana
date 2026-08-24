import type { MarketplaceItem } from '@amana/api-client';
import { ApiError } from '@amana/api-client';
import { Body, Button, Caption, Card, Label, Screen, formatNaira, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '../lib/api';
import type { MainStackParamList } from '../nav/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'Marketplace'>;

type Shop = {
  retailerId: string;
  retailerName: string;
  items: MarketplaceItem[];
};

/**
 * The principal's marketplace, and where the control fusion is actually operated.
 *
 * Approving a shop here does not tick a marketplace-only box — it **writes a rule** into the
 * sub-wallet's rule set, alongside the daily limit and the category lock, and the same engine
 * enforces all three. That is why this screen says "may spend here" rather than "favourite":
 * the parent is editing permissions, and the wording should not pretend otherwise.
 */
export function MarketplaceScreen({ route }: Props): JSX.Element {
  const theme = useTheme();
  const { subWalletId } = route.params;
  const [shops, setShops] = useState<Shop[]>([]);
  const [approved, setApproved] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The unfiltered marketplace: a principal decides what to approve, so they must be able to
      // see shops this sub-wallet cannot yet buy from.
      const [{ items }, { approvedRetailerIds }] = await Promise.all([
        api.marketplace.items(),
        api.marketplace.approvedMerchants(subWalletId),
      ]);
      const byRetailer = new Map<string, Shop>();
      for (const i of items) {
        const s = byRetailer.get(i.retailerId) ?? {
          retailerId: i.retailerId,
          retailerName: i.retailerName,
          items: [],
        };
        s.items.push(i);
        byRetailer.set(i.retailerId, s);
      }
      setShops([...byRetailer.values()]);
      setApproved(approvedRetailerIds);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'Could not load the marketplace.');
    } finally {
      setLoading(false);
    }
  }, [subWalletId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(retailerId: string, isApproved: boolean) {
    setBusyId(retailerId);
    setError(null);
    try {
      const r = isApproved
        ? await api.marketplace.revokeMerchant({ subWalletId, retailerId })
        : await api.marketplace.approveMerchant({ subWalletId, retailerId });
      setApproved(r.retailerIds);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'Could not change that.');
    } finally {
      setBusyId(null);
    }
  }

  const unrestricted = approved === null;

  return (
    <Screen title="Marketplace" scrollable>
      <Card>
        <Label>WHO THIS WALLET MAY BUY FROM</Label>
        {unrestricted ? (
          // "No rule" and "an empty list" are genuinely different states, and confusing them is
          // how a parent thinks they have restricted something they have not.
          <Body muted>
            Any approved shop. Approve one below to limit this wallet to only the shops you choose.
          </Body>
        ) : (
          <Body muted>
            {approved.length === 0
              ? 'No shops. This wallet cannot buy anything in the marketplace until you approve one.'
              : `${approved.length} ${approved.length === 1 ? 'shop' : 'shops'} approved.`}
          </Body>
        )}
        <Caption>
          Approving a shop adds a rule to this wallet, next to its spending limit and category
          locks.
        </Caption>
      </Card>

      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {loading ? (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : null}

      {shops.map((shop) => {
        const isApproved = approved?.includes(shop.retailerId) ?? false;
        const cheapest = shop.items
          .map((i) => BigInt(i.effectiveKobo))
          .reduce((a, b) => (b < a ? b : a), BigInt(shop.items[0]?.effectiveKobo ?? '0'));
        return (
          <Card key={shop.retailerId}>
            <Body strong>{shop.retailerName}</Body>
            <Caption>
              {`${shop.items.length} ${shop.items.length === 1 ? 'item' : 'items'} from ${formatNaira(
                cheapest.toString(),
              )}`}
            </Caption>
            <View style={{ marginTop: 10 }}>
              <Button
                label={isApproved ? 'REMOVE APPROVAL' : 'APPROVE THIS SHOP'}
                variant={isApproved ? 'secondary' : 'primary'}
                disabled={busyId === shop.retailerId}
                loading={busyId === shop.retailerId}
                onPress={() => void toggle(shop.retailerId, isApproved)}
              />
            </View>
          </Card>
        );
      })}

      {!loading && shops.length === 0 ? (
        <Card>
          <Body muted>No shops are live in the marketplace yet.</Body>
        </Card>
      ) : null}
    </Screen>
  );
}
