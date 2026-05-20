import { Body, Button, Card, Label, Screen, SectionHeader, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, View } from 'react-native';
import { secureTokenStore } from '../lib/secure-token-store';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { SettingsStackParamList } from '../nav/SettingsStack';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const sw = subWalletMemory.get();

  const signOut = async () => {
    await secureTokenStore.clear();
    subWalletMemory.clear();
  };

  return (
    <Screen title="Settings" scrollable>
      <View style={{ gap: 20, marginTop: 8 }}>
        <View style={{ gap: 8 }}>
          <SectionHeader title="WALLET" />
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label>NAME</Label>
            <Body muted>{sw?.name ?? '—'}</Body>
          </Card>
        </View>

        <View style={{ gap: 8 }}>
          <SectionHeader title="NOTIFICATIONS" />
          <Pressable onPress={() => navigation.navigate('EnableNotifications')}>
            <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Body>Push notifications</Body>
              <Body muted style={{ fontSize: 20 }}>›</Body>
            </Card>
          </Pressable>
        </View>

        <Button
          variant="ghost"
          label="SIGN OUT"
          onPress={() => void signOut()}
          style={{ marginTop: 'auto' as unknown as number }}
        />
      </View>
    </Screen>
  );
}
