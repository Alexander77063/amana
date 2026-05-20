import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';
import { Body, Button, Screen, TextInput } from '@amana/ui';
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
      navigation.navigate('Verify', { pendingPhone: phone });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  });

  return (
    <Screen title="Welcome" keyboardAvoiding scrollable>
      <View style={{ gap: 8, marginTop: 32, marginBottom: 24 }}>
        <Body muted>Enter your phone number to receive a code.</Body>
      </View>
      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <TextInput
            label="MOBILE NUMBER"
            keyboardType="phone-pad"
            autoFocus
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="+2348012345678"
            error={fieldState.error?.message}
          />
        )}
      />
      {errorMsg ? <Body muted>{errorMsg}</Body> : null}
      <View style={{ marginTop: 8 }}>
        <Button
          label="SEND CODE"
          onPress={onSubmit}
          loading={busy || formState.isSubmitting}
          disabled={busy || formState.isSubmitting}
        />
      </View>
    </Screen>
  );
}
