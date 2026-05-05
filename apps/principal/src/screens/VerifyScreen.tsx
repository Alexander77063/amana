import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import type { AuthStackParamList } from '../nav/AuthStack';
import { useAuthStore } from '../state/auth.store';

type Props = NativeStackScreenProps<AuthStackParamList, 'Verify'>;

const schema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Six digits'),
  nin: z
    .string()
    .regex(/^\d{11}$/, 'Eleven digits')
    .optional()
    .or(z.literal('')),
  bvn: z
    .string()
    .regex(/^\d{11}$/, 'Eleven digits')
    .optional()
    .or(z.literal('')),
});
type FormValues = z.infer<typeof schema>;

/**
 * Two flows:
 *  - Returning user: enter the code, server returns tokens.
 *  - New principal signup: server 400s with `nin_and_bvn_required_for_principal_signup` —
 *    we expose NIN + BVN inputs that submit on the next tap.
 *
 * For simplicity, we always show NIN + BVN as optional fields. The server enforces
 * which combinations are valid; we surface its error code.
 */
export function VerifyScreen({ navigation }: Props): JSX.Element {
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const pendingPhone = useAuthStore((s) => s.pendingPhone);
  const busy = useAuthStore((s) => s.busy);
  const errorCode = useAuthStore((s) => s.errorCode);

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', nin: '', bvn: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await verifyOtp({
        code: values.code,
        nin: values.nin?.length ? values.nin : undefined,
        bvn: values.bvn?.length ? values.bvn : undefined,
      });
      // RootNavigator will switch to MainStack when status === 'logged_in'.
    } catch {
      // errorCode is already set on the store; UI re-renders.
    }
  });

  if (!pendingPhone) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>No phone selected</Text>
        <Pressable style={styles.button} onPress={() => navigation.navigate('Phone')}>
          <Text style={styles.buttonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

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

      <Text style={styles.section}>If this is your first time, also enter:</Text>

      <Controller
        control={control}
        name="nin"
        render={({ field, fieldState }) => (
          <View>
            <Text style={styles.label}>NIN</Text>
            <TextInput
              keyboardType="number-pad"
              maxLength={11}
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="11 digits"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />

      <Controller
        control={control}
        name="bvn"
        render={({ field, fieldState }) => (
          <View>
            <Text style={styles.label}>BVN</Text>
            <TextInput
              keyboardType="number-pad"
              maxLength={11}
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="11 digits"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />

      {errorCode && <Text style={styles.err}>Server: {errorCode}</Text>}

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
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  section: { fontSize: 14, fontWeight: '600', marginTop: 16 },
  muted: { color: '#666' },
  label: { fontSize: 12, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
  err: { color: '#b00020', marginTop: 4 },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
