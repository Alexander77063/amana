import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { usePushStore } from '../state/push.store';

type Props = NativeStackScreenProps<MainStackParamList, 'EnableNotifications'>;

export function EnableNotificationsScreen({ navigation }: Props): JSX.Element {
  const requestPermissionAndRegister = usePushStore((s) => s.requestPermissionAndRegister);

  const onEnable = async () => {
    await requestPermissionAndRegister();
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>🔔</Text>
      </View>
      <Text style={styles.title}>Get notified when an agent needs approval</Text>
      <View style={styles.bullets}>
        <Text style={styles.bullet}>• Approve spend in one tap</Text>
        <Text style={styles.bullet}>• Hear about settled transactions</Text>
        <Text style={styles.bullet}>• Get anomaly alerts</Text>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.primary} onPress={() => void onEnable()}>
          <Text style={styles.primaryText}>Enable notifications</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryText}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 24, justifyContent: 'center', alignItems: 'center' },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#f3f3f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 48 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  bullets: { gap: 8 },
  bullet: { fontSize: 16, color: '#444' },
  actions: { gap: 8, alignSelf: 'stretch' },
  primary: {
    backgroundColor: '#222',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  primaryText: { color: 'white', fontWeight: '600', fontSize: 16 },
  secondary: { paddingVertical: 14, alignItems: 'center' },
  secondaryText: { color: '#666', fontSize: 14 },
});
