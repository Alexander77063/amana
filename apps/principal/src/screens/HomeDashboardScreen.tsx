import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useBumpsStore } from '../state/bumps.store';
import { useHouseholdStore } from '../state/household.store';
import { useNotificationsStore } from '../state/notifications.store';

type Props = NativeStackScreenProps<MainStackParamList, 'HomeDashboard'>;

export function HomeDashboardScreen({ navigation }: Props): JSX.Element {
  const status = useHouseholdStore((s) => s.status);
  const household = useHouseholdStore((s) => s.household);
  const masterWallet = useHouseholdStore((s) => s.masterWallet);
  const members = useHouseholdStore((s) => s.members);
  const errorCode = useHouseholdStore((s) => s.errorCode);
  const bootstrap = useHouseholdStore((s) => s.bootstrap);
  const refreshBumps = useBumpsStore((s) => s.refresh);
  const pendingCount = useBumpsStore((s) => s.pending.length);
  const refreshNotifications = useNotificationsStore((s) => s.refresh);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  useEffect(() => {
    if (status === 'idle') void bootstrap();
  }, [status, bootstrap]);

  useEffect(() => {
    if (status === 'has_household') {
      void refreshBumps();
      void refreshNotifications();
    }
  }, [status, refreshBumps, refreshNotifications]);

  useEffect(() => {
    if (status === 'no_household') navigation.replace('HouseholdSetup');
  }, [status, navigation]);

  if (status === 'idle' || status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Couldn&apos;t load: {errorCode}</Text>
        <Pressable style={styles.button} onPress={() => void bootstrap()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!household || !masterWallet) {
    return <View />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{household.name}</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top up your wallet</Text>
        <Text style={styles.muted}>Send via NIP transfer to:</Text>
        <Text style={styles.account}>{masterWallet.anchorVirtualAccount}</Text>
        <Text style={styles.muted}>Bank code: {masterWallet.anchorBankCode}</Text>
      </View>

      <Pressable style={styles.row} onPress={() => navigation.navigate('BumpsInbox')}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle}>Pending requests</Text>
          {pendingCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{pendingCount}</Text>
            </View>
          )}
        </View>
        <Text style={styles.muted}>Approve or deny agent bumps</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => navigation.navigate('NotificationsInbox')}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        <Text style={styles.muted}>Recent activity</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => navigation.navigate('Members')}>
        <Text style={styles.rowTitle}>Agents</Text>
        <Text style={styles.muted}>{members.length} paired</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => navigation.navigate('SubWalletsList')}>
        <Text style={styles.rowTitle}>Sub-wallets</Text>
        <Text style={styles.muted}>Manage controlled spend</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => navigation.navigate('Pairing')}>
        <Text style={styles.rowTitle}>Pair an agent</Text>
        <Text style={styles.muted}>Issue a one-time code</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => navigation.navigate('Settings')}>
        <Text style={styles.rowTitle}>Settings</Text>
        <Text style={styles.muted}>Notifications, log out, and more</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 24, fontWeight: '600' },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f3f3f3', gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: '600' },
  account: { fontSize: 22, fontFamily: 'Courier', letterSpacing: 1, fontWeight: '700' },
  muted: { color: '#666' },
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
  },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1769ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: 'white', fontSize: 12, fontWeight: '700' },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  buttonText: { color: 'white', fontWeight: '600' },
  err: { color: '#b00020' },
});
