import { Body, Button, Caption, Card, Screen, Skeleton } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { MainStackParamList } from '../nav/MainStack';
import { useHouseholdStore } from '../state/household.store';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'SubWalletsList'>;

export function SubWalletsListScreen({ navigation }: Props): JSX.Element {
  const household = useHouseholdStore((s) => s.household);
  // `useShallow` is load-bearing, not a nicety. Zustand v5 reads through
  // `useSyncExternalStore`, which compares snapshots by identity — and `Object.values()`
  // returns a fresh array every call, so a bare selector here re-rendered forever and the
  // screen died with "Maximum update depth exceeded". Shallow-comparing the array contents
  // makes the snapshot stable while the underlying map is unchanged.
  const list = useSubWalletsStore(useShallow((s) => Object.values(s.byId)));
  const busy = useSubWalletsStore((s) => s.busy);
  const refreshList = useSubWalletsStore((s) => s.refreshList);

  useEffect(() => {
    if (household) void refreshList(household.id);
  }, [household, refreshList]);

  if (!household) return <Screen title="Sub-wallets">{null}</Screen>;

  if (busy && list.length === 0) {
    return (
      <Screen title="Sub-wallets">
        <Skeleton />
      </Screen>
    );
  }

  // The empty state must still offer the create action. Without it a principal who has never
  // made a sub-wallet lands on a dead end — exactly the moment they most need the button.
  if (list.length === 0) {
    return (
      <Screen title="Sub-wallets">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <Body muted>No sub-wallets yet.</Body>
          <Button
            label="＋ NEW SUB-WALLET"
            onPress={() => navigation.navigate('CreateSubWallet')}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Sub-wallets" noPadding>
      <FlatList
        contentContainerStyle={{ padding: 24, gap: 12 }}
        data={list}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => {
          const isSnoozedActive =
            item.snoozedUntil !== null && new Date(item.snoozedUntil) > new Date();
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.status}`}
              onPress={() => navigation.navigate('SubWalletDetail', { subWalletId: item.id })}
            >
              <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Body strong>{item.name}</Body>
                  <Caption>{item.status}</Caption>
                </View>
                {isSnoozedActive && <Body>🌙</Body>}
              </Card>
            </Pressable>
          );
        }}
      />
      <View style={{ position: 'absolute', bottom: 32, right: 24 }}>
        <Button label="＋ NEW SUB-WALLET" onPress={() => navigation.navigate('CreateSubWallet')} />
      </View>
    </Screen>
  );
}
