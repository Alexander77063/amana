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
    <Stack.Navigator>
      <Stack.Screen
        name="CaptureMethod"
        component={CaptureMethodScreen}
        options={{ title: 'Pay' }}
      />
      <Stack.Screen name="NQRScan" component={NQRScanScreen} options={{ title: 'Scan QR' }} />
      <Stack.Screen
        name="PhoneLookup"
        component={PhoneLookupScreen}
        options={{ title: 'Pay by phone' }}
      />
      <Stack.Screen
        name="AccountEntry"
        component={AccountEntryScreen}
        options={{ title: 'Pay by account' }}
      />
      <Stack.Screen
        name="Confirm"
        component={ConfirmScreen}
        options={{ title: 'Confirm payment' }}
      />
      <Stack.Screen
        name="BumpWait"
        component={BumpWaitScreen}
        options={{ title: 'Awaiting approval', headerLeft: () => null }}
      />
      <Stack.Screen
        name="Sending"
        component={SendingScreen}
        options={{ title: 'Sending…', headerLeft: () => null }}
      />
      <Stack.Screen
        name="Receipt"
        component={ReceiptScreen}
        options={{ title: 'Receipt', headerLeft: () => null }}
      />
      <Stack.Screen
        name="ShowRecipient"
        component={ShowRecipientScreen}
        options={{ title: 'Show recipient', presentation: 'modal' }}
      />
      <Stack.Screen
        name="PhotoAttach"
        component={PhotoAttachScreen}
        options={{ title: 'Add photo', presentation: 'modal' }}
      />
      <Stack.Screen
        name="Failed"
        component={FailedScreen}
        options={{ title: 'Payment failed', headerLeft: () => null }}
      />
    </Stack.Navigator>
  );
}
