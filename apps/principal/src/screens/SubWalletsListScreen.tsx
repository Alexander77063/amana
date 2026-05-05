import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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

  if (!household) return <View />;

  return (
    <View style={styles.container}>
      {busy && list.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>No sub-wallets yet.</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={list}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('SubWalletDetail', { subWalletId: item.id })}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.muted}>{item.status}</Text>
            </Pressable>
          )}
        />
      )}
      <Pressable style={styles.fab} onPress={() => navigation.navigate('CreateSubWallet')}>
        <Text style={styles.fabText}>＋ New sub-wallet</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  list: { padding: 24, gap: 12 },
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
  },
  name: { fontSize: 16, fontWeight: '600' },
  muted: { color: '#666' },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    backgroundColor: '#222',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 999,
  },
  fabText: { color: 'white', fontWeight: '600' },
});
