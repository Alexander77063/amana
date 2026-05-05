import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useAuthStore } from '../state/auth.store';
import { useHouseholdStore } from '../state/household.store';

type Props = NativeStackScreenProps<MainStackParamList, 'HomeDashboard'>;

export function HomeDashboardScreen({ navigation }: Props): JSX.Element {
  const status = useHouseholdStore((s) => s.status);
  const household = useHouseholdStore((s) => s.household);
  const masterWallet = useHouseholdStore((s) => s.masterWallet);
  const members = useHouseholdStore((s) => s.members);
  const errorCode = useHouseholdStore((s) => s.errorCode);
  const bootstrap = useHouseholdStore((s) => s.bootstrap);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (status === 'idle') void bootstrap();
  }, [status, bootstrap]);

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

      <Pressable
        style={[styles.button, styles.danger]}
        onPress={() => {
          void logout();
        }}
      >
        <Text style={styles.buttonText}>Log out</Text>
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
  button: {
    marginTop: 24,
    alignSelf: 'flex-start',
    backgroundColor: '#222',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
  },
  danger: { backgroundColor: '#b00020' },
  buttonText: { color: 'white', fontWeight: '600' },
  err: { color: '#b00020' },
});
