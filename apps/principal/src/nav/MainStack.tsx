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
    <Stack.Navigator>
      <Stack.Screen
        name="HomeDashboard"
        component={HomeDashboardScreen}
        options={{ title: 'Amana' }}
      />
      <Stack.Screen
        name="HouseholdSetup"
        component={HouseholdSetupScreen}
        options={{ title: 'Set up household' }}
      />
      <Stack.Screen name="Pairing" component={PairingScreen} options={{ title: 'Pair an agent' }} />
      <Stack.Screen name="Members" component={MembersScreen} options={{ title: 'Agents' }} />
      <Stack.Screen
        name="SubWalletsList"
        component={SubWalletsListScreen}
        options={{ title: 'Sub-wallets' }}
      />
      <Stack.Screen
        name="CreateSubWallet"
        component={CreateSubWalletScreen}
        options={{ title: 'New sub-wallet' }}
      />
      <Stack.Screen
        name="SubWalletDetail"
        component={SubWalletDetailScreen}
        options={{ title: 'Sub-wallet' }}
      />
      <Stack.Screen
        name="EditRules"
        component={EditRulesScreen}
        options={{ title: 'Edit rules' }}
      />
      <Stack.Screen
        name="BumpsInbox"
        component={BumpsInboxScreen}
        options={{ title: 'Pending requests' }}
      />
      <Stack.Screen
        name="NotificationsInbox"
        component={NotificationsInboxScreen}
        options={{ title: 'Notifications' }}
      />
      <Stack.Screen
        name="EnableNotifications"
        component={EnableNotificationsScreen}
        options={{ title: 'Notifications', presentation: 'modal' }}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{ title: 'Notification preferences' }}
      />
      <Stack.Screen
        name="NotificationKindDetail"
        component={NotificationKindDetailScreen}
        options={{ title: 'Notification kind' }}
      />
      <Stack.Screen
        name="QuietHours"
        component={QuietHoursScreen}
        options={{ title: 'Quiet hours' }}
      />
      <Stack.Screen
        name="TransactionDetail"
        component={TransactionDetailScreen}
        options={{ title: 'Transaction' }}
      />
    </Stack.Navigator>
  );
}
