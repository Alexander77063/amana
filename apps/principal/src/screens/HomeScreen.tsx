import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from '../state/auth.store';

export function HomeScreen(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const busy = useAuthStore((s) => s.busy);

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Welcome, principal</Text>
      <Text style={styles.muted}>Phone: {user?.phone ?? '(unknown)'}</Text>
      <Text style={styles.muted}>KYC tier: {user?.kycTier ?? '?'}</Text>
      <Text style={styles.muted}>User id: {user?.id ?? '(none)'}</Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}
        disabled={busy}
        onPress={() => {
          void logout();
        }}
      >
        <Text style={styles.buttonText}>{busy ? 'Logging out…' : 'Log out'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 24 },
  greeting: { fontSize: 24, fontWeight: '600' },
  muted: { color: '#666', fontSize: 14 },
  button: {
    marginTop: 24,
    backgroundColor: '#222',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
