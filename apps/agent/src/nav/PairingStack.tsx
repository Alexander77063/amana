import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NFCPairScreen } from '../screens/NFCPairScreen';
import { PairingMethodScreen } from '../screens/PairingMethodScreen';
import { PairingSuccessScreen } from '../screens/PairingSuccessScreen';
import { QRScanScreen } from '../screens/QRScanScreen';

export type PairingStackParamList = {
  PairingMethod: { pendingToken?: string };
  QRScan: undefined;
  NFCPair: undefined;
  PairingSuccess: { subWalletName: string; principalPhone: string };
};

type Props = { onPaired: () => void; pendingToken: string | null };

const Stack = createNativeStackNavigator<PairingStackParamList>();

export function PairingStack({ onPaired, pendingToken }: Props): JSX.Element {
  return (
    <Stack.Navigator initialRouteName="PairingMethod">
      <Stack.Screen
        name="PairingMethod"
        initialParams={{ pendingToken: pendingToken ?? undefined }}
        options={{ title: 'Pair wallet' }}
      >
        {(props) => <PairingMethodScreen {...props} onPaired={onPaired} />}
      </Stack.Screen>
      <Stack.Screen name="QRScan" options={{ title: 'Scan QR' }}>
        {(props) => <QRScanScreen {...props} onPaired={onPaired} />}
      </Stack.Screen>
      <Stack.Screen name="NFCPair" options={{ title: 'NFC tap' }}>
        {(props) => <NFCPairScreen {...props} onPaired={onPaired} />}
      </Stack.Screen>
      <Stack.Screen name="PairingSuccess" options={{ title: 'Paired!', headerLeft: () => null }}>
        {(props) => <PairingSuccessScreen {...props} onPaired={onPaired} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
