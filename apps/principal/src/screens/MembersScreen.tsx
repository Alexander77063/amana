import { Body, Caption, Screen, Skeleton } from '@amana/ui';
import { useEffect } from 'react';
import { FlatList, View } from 'react-native';
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
      <Screen title="Agents">
        <Skeleton />
      </Screen>
    );
  }

  if (members.length === 0) {
    return (
      <Screen title="Agents">
        <Body muted>No agents paired yet.</Body>
        <Body muted>Use &quot;Pair an agent&quot; from the home screen to issue a code.</Body>
      </Screen>
    );
  }

  return (
    <Screen title="Agents" noPadding>
      <FlatList
        contentContainerStyle={{ padding: 24, gap: 12 }}
        data={members}
        keyExtractor={(m) => m.userId}
        renderItem={({ item }) => (
          <View
            style={{
              paddingVertical: 12,
              borderBottomWidth: 0.5,
              borderBottomColor: '#ddd',
              gap: 4,
            }}
          >
            <Body strong>{item.phone}</Body>
            <Caption>{`${item.role} · KYC tier ${item.kycTier} · ${item.status}`}</Caption>
          </View>
        )}
      />
    </Screen>
  );
}
