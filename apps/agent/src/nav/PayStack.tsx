import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AccountEntryScreen } from '../screens/AccountEntryScreen';
import { BumpWaitScreen } from '../screens/BumpWaitScreen';
import { CaptureMethodScreen } from '../screens/CaptureMethodScreen';
import { ConfirmScreen } from '../screens/ConfirmScreen';
import { FailedScreen } from '../screens/FailedScreen';
import { NQRScanScreen } from '../screens/NQRScanScreen';
import { PhoneLookupScreen } from '../screens/PhoneLookupScreen';
import { PhotoAttachScreen } from '../screens/PhotoAttachScreen';
import { ReceiptScreen } from '../screens/ReceiptScreen';
import { SendingScreen } from '../screens/SendingScreen';
import { ShowRecipientScreen } from '../screens/ShowRecipientScreen';

export type PayStackParamList = {
  CaptureMethod: undefined;
  NQRScan: undefined;
  PhoneLookup: undefined;
  AccountEntry: undefined;
  Confirm: {
    resolvedName: string;
    bankCode: string;
    accountNumber: string;
    accountMasked: string;
  };
  BumpWait: {
    transactionId: string;
    amountKobo: string;
    resolvedName: string;
    expiresAt: string;
  };
  Sending: { transactionId: string };
  Receipt: { transactionId: string };
  ShowRecipient: { amountKobo: string; resolvedName: string; sessionId: string };
  PhotoAttach: { transactionId: string };
  Failed: { transactionId: string; errorMessage: string | null };
};

const Stack = createNativeStackNavigator<PayStackParamList>();

export function PayStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CaptureMethod" component={CaptureMethodScreen} />
      <Stack.Screen name="NQRScan" component={NQRScanScreen} />
      <Stack.Screen name="PhoneLookup" component={PhoneLookupScreen} />
      <Stack.Screen name="AccountEntry" component={AccountEntryScreen} />
      <Stack.Screen name="Confirm" component={ConfirmScreen} />
      <Stack.Screen name="BumpWait" component={BumpWaitScreen} />
      <Stack.Screen name="Sending" component={SendingScreen} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} />
      <Stack.Screen
        name="ShowRecipient"
        component={ShowRecipientScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="PhotoAttach"
        component={PhotoAttachScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="Failed" component={FailedScreen} />
    </Stack.Navigator>
  );
}
