import type { StoredAuth } from '@amana/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { z } from 'zod';
import { api } from '../lib/api';
import { secureTokenStore } from '../lib/secure-token-store';
import type { AuthStackParamList } from '../nav/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Verify'> & {
  onLoggedIn: () => void;
};

const schema = z.object({ code: z.string().regex(/^\d{6}$/, 'Six digits') });
type FormValues = z.infer<typeof schema>;

export function VerifyScreen({ onLoggedIn, route }: Props): JSX.Element {
  const { pendingPhone } = route.params;
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
  });

  const onSubmit = handleSubmit(async ({ code }) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const r = await api.auth.verifyOtp({ phone: pendingPhone, code });
      const stored: StoredAuth = {
        tokens: {
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
          accessExpiresAt: r.accessExpiresAt,
          refreshExpiresAt: r.refreshExpiresAt,
        },
        user: r.user,
      };
      await secureTokenStore.write(stored);
      onLoggedIn();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Enter the 6-digit code</Text>
      <Text style={styles.muted}>Sent to {pendingPhone}</Text>
      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <View>
            <TextInput
              autoFocus
              keyboardType="number-pad"
              maxLength={6}
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="123456"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />
      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}
      <Pressable
        accessibilityRole="button"
        disabled={busy || formState.isSubmitting}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          (busy || formState.isSubmitting) && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>{busy ? 'Verifying…' : 'Verify'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '600' },
  muted: { color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
  err: { color: '#b00020', marginTop: 4 },
  button: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
