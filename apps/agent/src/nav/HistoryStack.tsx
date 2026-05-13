import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TransactionDetailScreen } from '../screens/TransactionDetailScreen';
import { TransactionListScreen } from '../screens/TransactionListScreen';

export type HistoryStackParamList = {
  TransactionList: undefined;
  TransactionDetail: { transactionId: string };
};

const Stack = createNativeStackNavigator<HistoryStackParamList>();

export function HistoryStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="TransactionList"
        component={TransactionListScreen}
        options={{ title: 'History' }}
      />
      <Stack.Screen
        name="TransactionDetail"
        component={TransactionDetailScreen}
        options={{ title: 'Transaction' }}
      />
    </Stack.Navigator>
  );
}
