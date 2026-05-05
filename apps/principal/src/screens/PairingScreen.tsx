import { ApiError } from '@amana/api-client';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { useHouseholdStore } from '../state/household.store';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'issued'; code: string; expiresAt: string }
  | { kind: 'error'; code: string };

export function PairingScreen(): JSX.Element {
  const household = useHouseholdStore((s) => s.household);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  const issue = async () => {
    if (!household) {
      setState({ kind: 'error', code: 'no_household' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const r = await api.pairing.issue({ householdId: household.id });
      setState({ kind: 'issued', code: r.code, expiresAt: r.expiresAt });
      setCopied(false);
    } catch (e) {
      setState({
        kind: 'error',
        code: e instanceof ApiError ? e.code : 'unknown_error',
      });
    }
  };

  const copy = async () => {
    if (state.kind !== 'issued') return;
    await Clipboard.setStringAsync(state.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pair an agent</Text>
      <Text style={styles.muted}>
        Issue a one-time code, then send it to your agent (SMS, WhatsApp, in-person). They enter
        it during signup; that links them to your household.
      </Text>

      {state.kind === 'idle' && (
        <Pressable style={styles.button} onPress={() => void issue()}>
          <Text style={styles.buttonText}>Generate code</Text>
        </Pressable>
      )}

      {state.kind === 'loading' && <ActivityIndicator />}

      {state.kind === 'issued' && (
        <View style={styles.card}>
          <Text style={styles.muted}>Share this code with your agent:</Text>
          <Text style={styles.code} selectable>
            {state.code}
          </Text>
          <Text style={styles.muted}>Expires {new Date(state.expiresAt).toLocaleString()}</Text>
          <Pressable style={styles.button} onPress={() => void copy()}>
            <Text style={styles.buttonText}>{copied ? 'Copied ✓' : 'Copy'}</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondary]} onPress={() => void issue()}>
            <Text style={[styles.buttonText, styles.secondaryText]}>Generate another</Text>
          </Pressable>
        </View>
      )}

      {state.kind === 'error' && (
        <View>
          <Text style={styles.err}>Couldn&apos;t issue code: {state.code}</Text>
          <Pressable style={styles.button} onPress={() => void issue()}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '600' },
  muted: { color: '#666' },
  err: { color: '#b00020' },
  card: { padding: 16, gap: 12, borderRadius: 12, backgroundColor: '#f3f3f3' },
  code: { fontSize: 28, fontFamily: 'Courier', letterSpacing: 2, fontWeight: '700' },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  secondary: { backgroundColor: '#eee' },
  buttonText: { color: 'white', fontWeight: '600' },
  secondaryText: { color: '#222' },
});
