import { useEffect } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useHouseholdStore } from '../state/household.store';

export function MembersScreen(): JSX.Element {
  const members = useHouseholdStore((s) => s.members);
  const refresh = useHouseholdStore((s) => s.refreshMembers);
  const status = useHouseholdStore((s) => s.status);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (members.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No agents paired yet.</Text>
        <Text style={styles.muted}>
          Use &quot;Pair an agent&quot; from the home screen to issue a code.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={members}
      keyExtractor={(m) => m.userId}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.phone}>{item.phone}</Text>
          <Text style={styles.muted}>
            {item.role} · KYC tier {item.kycTier} · {item.status}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  list: { padding: 24, gap: 12 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
  },
  phone: { fontSize: 16, fontWeight: '600' },
  muted: { color: '#666' },
});
