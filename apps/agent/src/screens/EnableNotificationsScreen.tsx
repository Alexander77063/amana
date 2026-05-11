import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import type { SettingsStackParamList } from '../nav/SettingsStack';

type Props = NativeStackScreenProps<SettingsStackParamList, 'EnableNotifications'>;

export function EnableNotificationsScreen({ navigation }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const enable = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission denied. Enable notifications in your device settings.');
        setBusy(false);
        return;
      }
      const token = await Notifications.getExpoPushTokenAsync();
      const platform = Platform.OS === 'android' ? 'android' : 'ios';
      await api.device.register({ expoPushToken: token.data, platform });
      navigation.goBack();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Stay in the loop</Text>
      <Text style={styles.sub}>
        Get instant alerts when your payment settles, fails, or needs principal approval.
      </Text>
      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}
      {busy ? (
        <ActivityIndicator />
      ) : (
        <Pressable style={styles.button} onPress={() => void enable()}>
          <Text style={styles.buttonText}>Enable notifications</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 32, gap: 20, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 16, color: '#666', lineHeight: 24 },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
});
