import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { EnableNotificationsScreen } from '../screens/EnableNotificationsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SupportApproveScreen } from '../screens/SupportApproveScreen';

export type SettingsStackParamList = {
  Settings: undefined;
  EnableNotifications: undefined;
  /** Raised by a support-verification push; `options` are the three numbers to choose between. */
  SupportApprove: { verificationId: string; options: number[] };
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen
        name="EnableNotifications"
        component={EnableNotificationsScreen}
        options={{ title: 'Notifications', presentation: 'modal' }}
      />
      <Stack.Screen
        name="SupportApprove"
        component={SupportApproveScreen}
        options={{ title: 'Amana support', presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
