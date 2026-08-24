import type { MarketplaceItem } from '@amana/api-client';
import { ApiError } from '@amana/api-client';
import { Body, Caption, Card, Chip, Label, Screen, formatNaira, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Marketplace'>;

/**
 * What the agent may buy.
 *
 * Everything here is already permitted: the server filters the catalogue by the same rule set
 * that enforces at purchase time, so nothing is shown that buying would refuse for a reason the
 * list could have known. That is a spec §8 guardrail, not a nicety — an agent is never shown, or
 * upsold, something their principal has not allowed.
 */
export function MarketplaceScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [section, setSection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (only: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const [s, i] = await Promise.all([
        api.marketplace.sections(),
        api.marketplace.items(only ? { section: only } : {}),
      ]);
      setSections(s.sections);
      setItems(i.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'Could not load the marketplace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(section);
  }, [load, section]);

  return (
    <Screen title="Marketplace" scrollable>
      {loading && items.length === 0 ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : null}

      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {sections.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="All" selected={section === null} onPress={() => setSection(null)} />
            {sections.map((s) => (
              <Chip
                key={s}
                label={s}
                selected={section === s}
                onPress={() => setSection(section === s ? null : s)}
              />
            ))}
          </View>
        </ScrollView>
      ) : null}

      {!loading && items.length === 0 ? (
        <Card>
          <Body strong>Nothing here yet</Body>
          {/* An empty catalogue is nearly always the merchant rule, not an empty platform. Say
              which, so the agent asks the right person rather than assuming it is broken. */}
          <Caption>
            Your parent has not approved any shops for this wallet yet, or nothing matches what you
            are allowed to buy.
          </Caption>
        </Card>
      ) : null}

      {items.map((item) => {
        const discounted = item.effectiveKobo !== item.grossKobo;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`${item.name} from ${item.retailerName}, ${formatNaira(item.effectiveKobo)}`}
            onPress={() => navigation.navigate('MarketplaceItem', { itemId: item.id })}
          >
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Body strong>{item.name}</Body>
                  <Caption>{item.retailerName}</Caption>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Body strong>{formatNaira(item.effectiveKobo)}</Body>
                  {discounted ? (
                    // The list price is shown only when a deal is actually reducing it, and only
                    // beside the real one — never as the price itself.
                    <Caption style={{ textDecorationLine: 'line-through' }}>
                      {formatNaira(item.grossKobo)}
                    </Caption>
                  ) : null}
                </View>
              </View>
              {item.durationMinutes ? (
                <Caption>{`About ${item.durationMinutes} minutes`}</Caption>
              ) : null}
            </Card>
          </Pressable>
        );
      })}

      {items.length > 0 ? (
        <Label>{`${items.length} ${items.length === 1 ? 'item' : 'items'} you can buy`}</Label>
      ) : null}
    </Screen>
  );
}
