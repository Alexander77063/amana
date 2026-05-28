import { Body, Button, Caption, Card, Screen, SectionHeader } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { Pressable } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useAuthStore } from '../state/auth.store';

type Props = NativeStackScreenProps<MainStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props): JSX.Element {
  const logout = useAuthStore((s) => s.logout);
  const version = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <Screen title="Settings" scrollable>
      <SectionHeader title="PREFERENCES" />
      <Pressable onPress={() => navigation.navigate('NotificationPreferences')}>
        <Card>
          <Body strong>Notification preferences</Body>
          <Body muted>Choose which alerts reach you and how</Body>
        </Card>
      </Pressable>

      <SectionHeader title="ACCOUNT" />
      <Button variant="ghost" label="SIGN OUT" onPress={() => void logout()} />

      <SectionHeader title="ABOUT" />
      <Card>
        <Body strong>App version</Body>
        <Caption>{`Amana ${version}`}</Caption>
      </Card>
    </Screen>
  );
}
