import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'ShowRecipient'>;

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ShowRecipientScreen({ route, navigation }: Props): JSX.Element {
  const { amountKobo, resolvedName, sessionId } = route.params;
  return (
    <View style={styles.container}>
      <Text style={styles.sent}>{formatNaira(amountKobo)} sent to</Text>
      <Text style={styles.name}>{resolvedName}</Text>
      {sessionId && (
        <Text style={styles.session}>NIBSS session: {sessionId}{'\n'}Should appear in your bank within 30 seconds.</Text>
      )}
      <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16, backgroundColor: '#fff' },
  sent: { fontSize: 22, color: '#444', textAlign: 'center' },
  name: { fontSize: 48, fontWeight: '800', textAlign: 'center' },
  session: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22 },
  backBtn: { marginTop: 32, paddingHorizontal: 32, paddingVertical: 12 },
  backText: { fontSize: 16, color: '#888' },
});
