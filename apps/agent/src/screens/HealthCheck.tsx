import { AmanaApiClient } from '@amana/api-client';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; version: string }
  | { kind: 'error'; message: string };

export function HealthCheck(): JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    const client = new AmanaApiClient({ baseUrl: BACKEND_URL });
    client
      .health()
      .then((r) => setStatus({ kind: 'ok', version: r.version }))
      .catch((e: Error) => setStatus({ kind: 'error', message: e.message }));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Amana Agent — bootstrap smoke test</Text>
      <Text style={styles.subtitle}>Backend: {BACKEND_URL}</Text>
      {status.kind === 'loading' && <ActivityIndicator />}
      {status.kind === 'ok' && <Text style={styles.ok}>OK · backend version {status.version}</Text>}
      {status.kind === 'error' && <Text style={styles.err}>ERROR · {status.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#666' },
  ok: { fontSize: 16, color: '#0a7d24', fontWeight: '600' },
  err: { fontSize: 14, color: '#9a1d1d', textAlign: 'center' },
});
