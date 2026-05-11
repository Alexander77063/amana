import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { secureTokenStore } from '../lib/secure-token-store';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { SettingsStackParamList } from '../nav/SettingsStack';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props): JSX.Element {
  const sw = subWalletMemory.get();

  const signOut = async () => {
    await secureTokenStore.clear();
    subWalletMemory.clear();
  };

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Wallet</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Name</Text>
          <Text style={styles.rowValue}>{sw?.name ?? '—'}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Notifications</Text>
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate('EnableNotifications')}
        >
          <Text style={styles.rowLabel}>Push notifications</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      <Pressable style={styles.signOutBtn} onPress={() => void signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 24 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  rowLabel: { fontSize: 15 },
  rowValue: { color: '#888', fontSize: 15 },
  chevron: { fontSize: 20, color: '#ccc' },
  signOutBtn: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingVertical: 14,
  },
  signOutText: { color: '#b00020', fontWeight: '600', fontSize: 15 },
});
