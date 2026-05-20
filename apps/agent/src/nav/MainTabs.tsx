import { useTheme } from '@amana/ui';
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
  const theme = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.bg.surface,
          borderTopWidth: 0,
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 12,
        },
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.text.muted,
        tabBarLabelStyle: {
          fontFamily: 'PlusJakartaSans_600SemiBold',
          fontSize: 10,
          letterSpacing: 0.5,
        },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Pay" component={PayStack} options={{ title: 'Pay' }} />
      <Tab.Screen name="History" component={HistoryStack} options={{ title: 'History' }} />
      <Tab.Screen name="Settings" component={SettingsStack} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}
