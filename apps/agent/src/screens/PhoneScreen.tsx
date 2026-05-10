import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { z } from 'zod';
import { api } from '../lib/api';
import type { AuthStackParamList } from '../nav/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Phone'>;

const schema = z.object({
  phone: z.string().regex(/^\+\d{8,15}$/, 'Use international format (+234…)'),
});
type FormValues = z.infer<typeof schema>;

export function PhoneScreen({ navigation }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { phone: '+234' },
  });

  const onSubmit = handleSubmit(async ({ phone }) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await api.auth.requestOtp({ phone, purpose: 'login' });
      navigation.navigate('Verify');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.muted}>Enter your phone number to receive a code.</Text>
      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <View>
            <TextInput
              autoFocus
              keyboardType="phone-pad"
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder="+2348012345678"
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
        style={({ pressed }) => [styles.button, pressed && styles.pressed,
          (busy || formState.isSubmitting) && styles.disabled]}
      >
        <Text style={styles.buttonText}>{busy ? 'Sending…' : 'Send code'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
  muted: { color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
  err: { color: '#b00020', marginTop: 4 },
  button: { backgroundColor: '#1a1a2e', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 999, alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
