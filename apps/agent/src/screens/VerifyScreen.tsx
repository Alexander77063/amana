import type { StoredAuth } from '@amana/api-client';
import { Body, Button, Screen, SectionHeader, TextInput } from '@amana/ui';
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

/**
 * Two flows, mirroring the principal app's VerifyScreen:
 *  - Returning agent: the code alone is enough.
 *  - First-time agent: the server will only mint an `agent` user when the request carries a
 *    valid `pairingCode` (plus NIN). Without one it falls through to the principal-signup
 *    branch and 400s with `nin_and_bvn_required_for_principal_signup` — which is why a brand
 *    new agent previously could not get past this screen at all.
 *
 * The fields are optional and the server decides which combination is valid; we surface its
 * error either way.
 */
const schema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Six digits'),
  pairingCode: z.string().optional().or(z.literal('')),
  nin: z
    .string()
    .regex(/^\d{11}$/, 'Eleven digits')
    .optional()
    .or(z.literal('')),
});
type FormValues = z.infer<typeof schema>;

export function VerifyScreen({ onLoggedIn, route }: Props): JSX.Element {
  const { pendingPhone } = route.params;
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', pairingCode: '', nin: '' },
  });

  const onSubmit = handleSubmit(async ({ code, pairingCode, nin }) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const r = await api.auth.verifyOtp({
        phone: pendingPhone,
        code,
        ...(pairingCode?.length ? { pairingCode } : {}),
        ...(nin?.length ? { nin } : {}),
      });
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

      <SectionHeader title="FIRST TIME? ADD THE CODE FROM YOUR PRINCIPAL:" />

      <Controller
        control={control}
        name="pairingCode"
        render={({ field, fieldState }) => (
          <TextInput
            label="PAIRING CODE"
            autoCapitalize="none"
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="From your principal's phone"
            error={fieldState.error?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="nin"
        render={({ field, fieldState }) => (
          <TextInput
            label="NIN"
            keyboardType="number-pad"
            maxLength={11}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="11 digits"
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
