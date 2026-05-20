import type { NotificationKind } from '@amana/types';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BumpsInboxScreen } from '../screens/BumpsInboxScreen';
import { CreateSubWalletScreen } from '../screens/CreateSubWalletScreen';
import { EditRulesScreen } from '../screens/EditRulesScreen';
import { EnableNotificationsScreen } from '../screens/EnableNotificationsScreen';
import { HomeDashboardScreen } from '../screens/HomeDashboardScreen';
import { HouseholdSetupScreen } from '../screens/HouseholdSetupScreen';
import { MembersScreen } from '../screens/MembersScreen';
import { NotificationKindDetailScreen } from '../screens/NotificationKindDetailScreen';
import { NotificationPreferencesScreen } from '../screens/NotificationPreferencesScreen';
import { NotificationsInboxScreen } from '../screens/NotificationsInboxScreen';
import { PairingScreen } from '../screens/PairingScreen';
import { QuietHoursScreen } from '../screens/QuietHoursScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SubWalletDetailScreen } from '../screens/SubWalletDetailScreen';
import { SubWalletsListScreen } from '../screens/SubWalletsListScreen';
import { TransactionDetailScreen } from '../screens/TransactionDetailScreen';

export type MainStackParamList = {
  HomeDashboard: undefined;
  HouseholdSetup: undefined;
  Pairing: undefined;
  Members: undefined;
  SubWalletsList: undefined;
  CreateSubWallet: undefined;
  SubWalletDetail: { subWalletId: string };
  EditRules: { subWalletId: string };
  BumpsInbox: undefined;
  NotificationsInbox: undefined;
  EnableNotifications: undefined;
  Settings: undefined;
  NotificationPreferences: undefined;
  NotificationKindDetail: { kind: NotificationKind };
  QuietHours: undefined;
  TransactionDetail: { transactionId: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeDashboard" component={HomeDashboardScreen} />
      <Stack.Screen name="HouseholdSetup" component={HouseholdSetupScreen} />
      <Stack.Screen name="Pairing" component={PairingScreen} />
      <Stack.Screen name="Members" component={MembersScreen} />
      <Stack.Screen name="SubWalletsList" component={SubWalletsListScreen} />
      <Stack.Screen name="CreateSubWallet" component={CreateSubWalletScreen} />
      <Stack.Screen name="SubWalletDetail" component={SubWalletDetailScreen} />
      <Stack.Screen name="EditRules" component={EditRulesScreen} />
      <Stack.Screen name="BumpsInbox" component={BumpsInboxScreen} />
      <Stack.Screen name="NotificationsInbox" component={NotificationsInboxScreen} />
      <Stack.Screen
        name="EnableNotifications"
        component={EnableNotificationsScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="NotificationPreferences" component={NotificationPreferencesScreen} />
      <Stack.Screen name="NotificationKindDetail" component={NotificationKindDetailScreen} />
      <Stack.Screen name="QuietHours" component={QuietHoursScreen} />
      <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
    </Stack.Navigator>
  );
}
