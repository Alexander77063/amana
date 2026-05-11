import { ApiError } from '@amana/api-client';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
// @ts-ignore — react-native-nfc-manager types may not resolve in all envs
import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';
import { api } from '../lib/api';
import { useHouseholdStore } from '../state/household.store';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'issued'; code: string; expiresAt: string }
  | { kind: 'error'; code: string };

async function emitNfc(code: string): Promise<void> {
  await NfcManager.requestTechnology(NfcTech.Ndef);
  try {
    const bytes = Ndef.encodeMessage([Ndef.textRecord(code)]);
    if (bytes) await NfcManager.ndefHandler.writeNdefMessage(bytes);
  } finally {
    await NfcManager.cancelTechnologyRequest();
  }
}

export function PairingScreen(): JSX.Element {
  const household = useHouseholdStore((s) => s.household);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const [nfcReady, setNfcReady] = useState(false);

  // Initialise NFC on Android only
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NfcManager.start()
      .then(() => NfcManager.isEnabled())
      .then((enabled: boolean) => setNfcReady(enabled))
      .catch(() => setNfcReady(false));
    return () => { void NfcManager.cancelTechnologyRequest().catch(() => {}); };
  }, []);

  const issue = async () => {
    if (!household) { setState({ kind: 'error', code: 'no_household' }); return; }
    setState({ kind: 'loading' });
    try {
      const r = await api.pairing.issue({ householdId: household.id });
      setState({ kind: 'issued', code: r.code, expiresAt: r.expiresAt });
      setCopied(false);
      // Start NFC emit so agent can tap immediately
      if (Platform.OS === 'android' && nfcReady) {
        void emitNfc(r.code).catch(() => {}); // best-effort; don't block UI
      }
    } catch (e) {
      setState({ kind: 'error', code: e instanceof ApiError ? e.code : 'unknown_error' });
    }
  };

  const copy = async () => {
    if (state.kind !== 'issued') return;
    await Clipboard.setStringAsync(state.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    if (state.kind !== 'issued') return;
    try {
      await Share.share({ message: `amana://pair?token=${state.code}` });
    } catch { /* user cancelled */ }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pair an agent</Text>
      <Text style={styles.muted}>
        Issue a one-time code, then have your agent scan the QR or tap phones (Android).
      </Text>

      {state.kind === 'idle' && (
        <Pressable style={styles.button} onPress={() => void issue()}>
          <Text style={styles.buttonText}>Generate code</Text>
        </Pressable>
      )}

      {state.kind === 'loading' && <ActivityIndicator />}

      {state.kind === 'issued' && (
        <View style={styles.card}>
          <Text style={styles.muted}>Have your agent scan this QR:</Text>
          <View style={styles.qrWrap}>
            <QRCode value={state.code} size={220} />
          </View>
          {Platform.OS === 'android' && nfcReady && (
            <Text style={styles.nfcHint}>📶 NFC active — touch phones to pair</Text>
          )}
          <Text style={styles.muted}>Or share the deep-link:</Text>
          <Text style={styles.code} selectable>{state.code}</Text>
          <Text style={styles.muted}>Expires {new Date(state.expiresAt).toLocaleString()}</Text>
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={() => void share()}>
              <Text style={styles.buttonText}>Share</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.secondary]} onPress={() => void copy()}>
              <Text style={[styles.buttonText, styles.secondaryText]}>
                {copied ? 'Copied ✓' : 'Copy'}
              </Text>
            </Pressable>
          </View>
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
  nfcHint: { color: '#1565c0', fontSize: 13, fontWeight: '600' },
  card: { padding: 16, gap: 12, borderRadius: 12, backgroundColor: '#f3f3f3' },
  code: { fontSize: 28, fontFamily: 'Courier', letterSpacing: 2, fontWeight: '700' },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  qrWrap: { alignItems: 'center', paddingVertical: 8 },
  row: { flexDirection: 'row', gap: 8 },
  secondary: { backgroundColor: '#eee' },
  buttonText: { color: 'white', fontWeight: '600' },
  secondaryText: { color: '#222' },
});
