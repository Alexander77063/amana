import { Body, Button, Screen, TextInput as UITextInput, useTheme } from '@amana/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';
import type { AuthStackParamList } from '../nav/AuthStack';
import { useAuthStore } from '../state/auth.store';

type Props = NativeStackScreenProps<AuthStackParamList, 'Phone'>;

const schema = z.object({
  phone: z.string().regex(/^\+\d{8,15}$/, 'Use international format (+234…)'),
});
type FormValues = z.infer<typeof schema>;

export function PhoneScreen({ navigation }: Props): JSX.Element {
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const busy = useAuthStore((s) => s.busy);
  const errorCode = useAuthStore((s) => s.errorCode);
  const theme = useTheme();

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { phone: '+234' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await requestOtp(values.phone);
      navigation.navigate('Verify');
    } catch {
      // errorCode is already set on the store; UI re-renders.
    }
  });

  return (
    <Screen title="Welcome" keyboardAvoiding scrollable>
      <Body muted>We&apos;ll send a 6-digit code to verify it&apos;s you.</Body>

      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <View>
            <UITextInput
              label="MOBILE NUMBER"
              autoFocus
              keyboardType="phone-pad"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder="+2348012345678"
              error={fieldState.error?.message}
            />
          </View>
        )}
      />

      {errorCode ? <Body style={{ color: theme.colors.debit }}>Server: {errorCode}</Body> : null}

      <Button
        label={busy ? 'SENDING…' : 'SEND CODE'}
        onPress={onSubmit}
        loading={busy}
        disabled={busy || formState.isSubmitting}
        fullWidth
      />
    </Screen>
  );
}
