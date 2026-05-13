import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { EnableNotificationsScreen } from '../screens/EnableNotificationsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type SettingsStackParamList = {
  Settings: undefined;
  EnableNotifications: undefined;
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
    </Stack.Navigator>
  );
}
