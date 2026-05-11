import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'PairingSuccess'> & {
  onPaired: () => void;
};

export function PairingSuccessScreen({ route, onPaired }: Props): JSX.Element {
  const { subWalletName, principalPhone } = route.params;
  return (
    <View style={styles.container}>
      <Text style={styles.check}>✓</Text>
      <Text style={styles.title}>Paired!</Text>
      <Text style={styles.detail}>Wallet: {subWalletName}</Text>
      <Text style={styles.detail}>Principal: {principalPhone}</Text>
      <Pressable style={styles.button} onPress={onPaired}>
        <Text style={styles.buttonText}>Let&apos;s go</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  check: { fontSize: 64, color: '#2e7d32' },
  title: { fontSize: 28, fontWeight: '700' },
  detail: { fontSize: 16, color: '#444' },
  button: {
    marginTop: 16,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 999,
  },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
});
