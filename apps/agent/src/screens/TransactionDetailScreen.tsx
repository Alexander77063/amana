import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';
import type { HistoryStackParamList } from '../nav/HistoryStack';

type Props = NativeStackScreenProps<HistoryStackParamList, 'TransactionDetail'>;

export function TransactionDetailScreen({ route }: Props): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Transaction detail — coming soon</Text>
      <Text style={styles.sub}>{route.params.transactionId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { fontSize: 18, fontWeight: '600' },
  sub: { fontSize: 13, color: '#888', marginTop: 8 },
});
