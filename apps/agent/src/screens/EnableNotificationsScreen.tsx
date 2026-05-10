import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';
import type { SettingsStackParamList } from '../nav/SettingsStack';

type Props = NativeStackScreenProps<SettingsStackParamList, 'EnableNotifications'>;

export function EnableNotificationsScreen(_props: Props): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Enable notifications — coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { fontSize: 18, fontWeight: '600' },
});
