import { Body, Button, Heading, Screen, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { api } from '../lib/api';
import type { SettingsStackParamList } from '../nav/SettingsStack';

type Props = NativeStackScreenProps<SettingsStackParamList, 'EnableNotifications'>;

export function EnableNotificationsScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
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
    <Screen title="Notifications">
      <View style={{ flex: 1, justifyContent: 'center', gap: 20 }}>
        <Heading size="lg">Stay in the loop</Heading>
        <Body muted>
          Get instant alerts when your payment settles, fails, or needs principal approval.
        </Body>

        {errorMsg ? <Body style={{ color: theme.colors.debit }}>{errorMsg}</Body> : null}

        <Button label="ENABLE NOTIFICATIONS" onPress={() => void enable()} loading={busy} />
        <Button variant="ghost" label="NOT NOW" onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}
