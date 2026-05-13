import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { HistoryStack } from './HistoryStack';
import { PayStack } from './PayStack';
import { SettingsStack } from './SettingsStack';

export type MainTabParamList = {
  Home: undefined;
  Pay: undefined;
  History: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs(): JSX.Element {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: true, title: 'Home' }}
      />
      <Tab.Screen name="Pay" component={PayStack} options={{ title: 'Pay' }} />
      <Tab.Screen name="History" component={HistoryStack} options={{ title: 'History' }} />
      <Tab.Screen name="Settings" component={SettingsStack} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}
