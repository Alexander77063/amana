import { zodResolver } from '@hookform/resolvers/zod';
import { Body, Button, Screen, SectionHeader, TextInput as UITextInput, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
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
  const theme = useTheme();

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
      <Screen title="Verify">
        <Body>No phone selected</Body>
        <Button label="BACK" onPress={() => navigation.navigate('Phone')} />
      </Screen>
    );
  }

  return (
    <Screen title="Verify" keyboardAvoiding scrollable>
      <Body muted>Sent to {pendingPhone}</Body>

      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <UITextInput
            label="6-DIGIT CODE"
            autoFocus
            keyboardType="number-pad"
            maxLength={6}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="123456"
            error={fieldState.error?.message}
          />
        )}
      />

      <SectionHeader title="IF THIS IS YOUR FIRST TIME, ALSO ENTER:" />

      <Controller
        control={control}
        name="nin"
        render={({ field, fieldState }) => (
          <UITextInput
            label="NIN"
            keyboardType="number-pad"
            maxLength={11}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="11 digits"
            error={fieldState.error?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="bvn"
        render={({ field, fieldState }) => (
          <UITextInput
            label="BVN"
            keyboardType="number-pad"
            maxLength={11}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="11 digits"
            error={fieldState.error?.message}
          />
        )}
      />

      {errorCode ? (
        <Body style={{ color: theme.colors.debit }}>Server: {errorCode}</Body>
      ) : null}

      <Button
        label={busy ? 'VERIFYING…' : 'VERIFY'}
        onPress={onSubmit}
        loading={busy}
        disabled={busy || formState.isSubmitting}
        fullWidth
      />
    </Screen>
  );
}
