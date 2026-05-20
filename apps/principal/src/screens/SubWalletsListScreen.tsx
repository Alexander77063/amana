import { Body, Button, Caption, Card, Screen, Skeleton } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useHouseholdStore } from '../state/household.store';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'SubWalletsList'>;

export function SubWalletsListScreen({ navigation }: Props): JSX.Element {
  const household = useHouseholdStore((s) => s.household);
  const list = useSubWalletsStore((s) => s.list);
  const busy = useSubWalletsStore((s) => s.busy);
  const refreshList = useSubWalletsStore((s) => s.refreshList);

  useEffect(() => {
    if (household) void refreshList(household.id);
  }, [household, refreshList]);

  if (!household) return <Screen title="Sub-wallets" />;

  if (busy && list.length === 0) {
    return (
      <Screen title="Sub-wallets">
        <Skeleton lines={3} />
      </Screen>
    );
  }

  if (list.length === 0) {
    return (
      <Screen title="Sub-wallets">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Body muted>No sub-wallets yet.</Body>
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
