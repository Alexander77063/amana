import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AccountEntryScreen } from '../screens/AccountEntryScreen';
import { BumpWaitScreen } from '../screens/BumpWaitScreen';
import { CaptureMethodScreen } from '../screens/CaptureMethodScreen';
import { ConfirmScreen } from '../screens/ConfirmScreen';
import { FailedScreen } from '../screens/FailedScreen';
import { MarketplaceItemScreen } from '../screens/MarketplaceItemScreen';
import { MarketplaceScreen } from '../screens/MarketplaceScreen';
import { NQRScanScreen } from '../screens/NQRScanScreen';
import { PhoneLookupScreen } from '../screens/PhoneLookupScreen';
import { PhotoAttachScreen } from '../screens/PhotoAttachScreen';
import { ReceiptScreen } from '../screens/ReceiptScreen';
import { SendingScreen } from '../screens/SendingScreen';
import { ShowRecipientScreen } from '../screens/ShowRecipientScreen';
import { TopUpReceiptScreen } from '../screens/TopUpReceiptScreen';
import { TopUpScreen } from '../screens/TopUpScreen';
import { VoucherScreen } from '../screens/VoucherScreen';

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
    /**
     * The registry vendor, when the payment came from an Amana Vendor Code. OUTPUT ONLY: it exists
     * so the confirm screen can show a verified badge. It must never be put on the spend intent —
     * `CreateIntentInput` has no such field, and the server re-resolves the vendor from the bank
     * code and account number precisely so a payer cannot choose whose category rules apply.
     */
    vendorId?: string | null;
    /** The registry's category, pre-filled into the confirm screen. Advisory, never enforced here. */
    category?: string | null;
    /**
     * An amount the QR itself carried (NQR tag 54), as a kobo string. Pre-fills the amount field
     * and stays editable — the payer, not the sticker, decides what leaves their wallet.
     */
    suggestedAmountKobo?: string | null;
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
  TopUp: undefined;
  TopUpReceipt: { purchaseId: string };
  Marketplace: undefined;
  MarketplaceItem: { itemId: string };
  Voucher: { voucherId: string };
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
      <Stack.Screen name="Marketplace" component={MarketplaceScreen} />
      <Stack.Screen name="MarketplaceItem" component={MarketplaceItemScreen} />
      <Stack.Screen name="Voucher" component={VoucherScreen} />
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
      <Stack.Screen name="TopUp" component={TopUpScreen} />
      <Stack.Screen name="TopUpReceipt" component={TopUpReceiptScreen} />
      <Stack.Screen name="Failed" component={FailedScreen} />
    </Stack.Navigator>
  );
}
