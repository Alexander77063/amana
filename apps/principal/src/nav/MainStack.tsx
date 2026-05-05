import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CreateSubWalletScreen } from '../screens/CreateSubWalletScreen';
import { EditRulesScreen } from '../screens/EditRulesScreen';
import { HomeDashboardScreen } from '../screens/HomeDashboardScreen';
import { HouseholdSetupScreen } from '../screens/HouseholdSetupScreen';
import { MembersScreen } from '../screens/MembersScreen';
import { PairingScreen } from '../screens/PairingScreen';
import { SubWalletDetailScreen } from '../screens/SubWalletDetailScreen';
import { SubWalletsListScreen } from '../screens/SubWalletsListScreen';

export type MainStackParamList = {
  HomeDashboard: undefined;
  HouseholdSetup: undefined;
  Pairing: undefined;
  Members: undefined;
  SubWalletsList: undefined;
  CreateSubWallet: undefined;
  SubWalletDetail: { subWalletId: string };
  EditRules: { subWalletId: string };
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
      <Stack.Screen
        name="Pairing"
        component={PairingScreen}
        options={{ title: 'Pair an agent' }}
      />
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
    </Stack.Navigator>
  );
}
