import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PhoneScreen } from '../screens/PhoneScreen';
import { VerifyScreen } from '../screens/VerifyScreen';

export type AuthStackParamList = {
  Phone: undefined;
  Verify: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Phone" component={PhoneScreen} />
      <Stack.Screen name="Verify" component={VerifyScreen} />
    </Stack.Navigator>
  );
}
