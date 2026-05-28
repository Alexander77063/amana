import type { StoredAuth } from '@amana/api-client';
import { Body, Button, Screen, TextInput } from '@amana/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
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
    <Screen title="Enter Code" keyboardAvoiding scrollable>
      <View style={{ gap: 8, marginTop: 32, marginBottom: 24 }}>
        <Body muted>Sent to {pendingPhone}</Body>
      </View>
      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <TextInput
            label="VERIFICATION CODE"
            keyboardType="number-pad"
            autoFocus
            maxLength={6}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="123456"
            error={fieldState.error?.message}
          />
        )}
      />
      {errorMsg ? <Body muted>{errorMsg}</Body> : null}
      <View style={{ marginTop: 8 }}>
        <Button
          label="VERIFY"
          onPress={onSubmit}
          loading={busy || formState.isSubmitting}
          disabled={busy || formState.isSubmitting}
        />
      </View>
    </Screen>
  );
}
