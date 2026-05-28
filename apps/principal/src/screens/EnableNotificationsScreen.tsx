import { Body, Button, CoinSealMark, Heading, Screen, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';
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
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <CoinSealMark size={80} variant="principal" />
        <Heading size="md" style={{ textAlign: 'center' }}>
          Get notified when an agent needs approval
        </Heading>
        <View style={{ gap: 8 }}>
          <Body>• Approve spend in one tap</Body>
          <Body>• Hear about settled transactions</Body>
          <Body>• Get anomaly alerts</Body>
        </View>
        <View style={{ gap: 8, alignSelf: 'stretch' }}>
          <Button label="ENABLE NOTIFICATIONS" onPress={() => void onEnable()} fullWidth />
          <Button variant="ghost" label="NOT NOW" onPress={() => navigation.goBack()} fullWidth />
        </View>
      </View>
    </Screen>
  );
}
