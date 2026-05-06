import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useAuthStore } from '../state/auth.store';

type Props = NativeStackScreenProps<MainStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props): JSX.Element {
  const logout = useAuthStore((s) => s.logout);
  const version = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable style={styles.row} onPress={() => navigation.navigate('NotificationPreferences')}>
        <Text style={styles.rowTitle}>Notification preferences</Text>
        <Text style={styles.muted}>Choose which alerts reach you and how</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => void logout()}>
        <Text style={[styles.rowTitle, styles.danger]}>Log out</Text>
      </Pressable>

      <View style={styles.row}>
        <Text style={styles.rowTitle}>App version</Text>
        <Text style={styles.muted}>Amana {version}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
  },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  muted: { color: '#666' },
  danger: { color: '#b00020' },
});
