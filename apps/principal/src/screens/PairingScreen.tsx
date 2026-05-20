import { ApiError } from '@amana/api-client';
import { Body, Button, Card, Screen, Skeleton, useTheme } from '@amana/ui';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import {
  Platform,
  Share,
  View,
} from 'react-native';
// @ts-ignore — react-native-nfc-manager types may not resolve in all envs
import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';
import QRCode from 'react-native-qrcode-svg';
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
  const theme = useTheme();

  // Initialise NFC on Android only
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NfcManager.start()
      .then(() => NfcManager.isEnabled())
      .then((enabled: boolean) => setNfcReady(enabled))
      .catch(() => setNfcReady(false));
    return () => {
      void NfcManager.cancelTechnologyRequest().catch(() => {});
    };
  }, []);

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
    } catch {
      /* user cancelled */
    }
  };

  return (
    <Screen title="Pair an agent" scrollable>
      <Body muted>
        Issue a one-time code, then have your agent scan the QR or tap phones (Android).
      </Body>

      {state.kind === 'idle' && (
        <Button label="GENERATE CODE" onPress={() => void issue()} />
      )}

      {state.kind === 'loading' && (
        <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 24 }}>
          <Skeleton width={120} />
        </View>
      )}

      {state.kind === 'issued' && (
        <Card style={{ gap: 12 }}>
          <Body muted>Have your agent scan this QR:</Body>
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            <QRCode value={state.code} size={220} />
          </View>
          {Platform.OS === 'android' && nfcReady && (
            <Body style={{ color: theme.colors.accent }}>📶 NFC active — touch phones to pair</Body>
          )}
          <Body muted>Or share the deep-link:</Body>
          <Body strong style={{ fontSize: 22, letterSpacing: 2 }}>
            {state.code}
          </Body>
          <Body muted>Expires {new Date(state.expiresAt).toLocaleString()}</Body>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="SHARE" onPress={() => void share()} />
            <Button
              variant="secondary"
              label={copied ? 'COPIED ✓' : 'COPY'}
              onPress={() => void copy()}
            />
          </View>
          <Button
            variant="ghost"
            label="GENERATE ANOTHER"
            onPress={() => void issue()}
          />
        </Card>
      )}

      {state.kind === 'error' && (
        <View style={{ gap: 12 }}>
          <Body style={{ color: theme.colors.debit }}>
            Couldn&apos;t issue code: {state.code}
          </Body>
          <Button label="TRY AGAIN" onPress={() => void issue()} />
        </View>
      )}
    </Screen>
  );
}
