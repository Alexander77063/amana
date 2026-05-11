import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PhoneScreen } from '../screens/PhoneScreen';
import { VerifyScreen } from '../screens/VerifyScreen';

export type AuthStackParamList = {
  Phone: undefined;
  Verify: { pendingPhone: string };
};

type Props = { onLoggedIn: () => void };

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack({ onLoggedIn }: Props): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Phone" component={PhoneScreen} options={{ title: 'Sign in' }} />
      <Stack.Screen name="Verify" options={{ title: 'Verify' }}>
        {(props) => <VerifyScreen {...props} onLoggedIn={onLoggedIn} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
