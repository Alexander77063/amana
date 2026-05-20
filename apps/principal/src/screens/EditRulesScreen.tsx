import { zodResolver } from '@hookform/resolvers/zod';
import { Body, Button, Screen, TextInput as UITextInput, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';
import type { MainStackParamList } from '../nav/MainStack';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'EditRules'>;

const schema = z.object({
  dailyLimitNaira: z.string().regex(/^\d+(\.\d{1,2})?$/, 'e.g. 50000 or 50000.00'),
});
type FormValues = z.infer<typeof schema>;

const nairaToKobo = (naira: string): string => {
  const [whole = '0', frac = ''] = naira.split('.');
  const fracPad = `${frac}00`.slice(0, 2);
  return `${BigInt(whole) * 100n + BigInt(fracPad || '0')}`;
};

export function EditRulesScreen({ navigation, route }: Props): JSX.Element {
  const { subWalletId } = route.params;
  const rules = useSubWalletsStore((s) => s.rulesById[subWalletId]);
  const busy = useSubWalletsStore((s) => s.busy);
  const errorCode = useSubWalletsStore((s) => s.errorCode);
  const refreshRules = useSubWalletsStore((s) => s.refreshRules);
  const publishRules = useSubWalletsStore((s) => s.publishRules);
  const theme = useTheme();

  useEffect(() => {
    void refreshRules(subWalletId);
  }, [subWalletId, refreshRules]);

  const currentDailyLimit = (() => {
    if (!rules) return '';
    const limit = rules.rules.find((r) => r.kind === 'limit');
    if (!limit) return '';
    const config = limit.configJson as { windowKind?: string; maxKobo?: string | number };
    if (config.windowKind !== 'daily' || !config.maxKobo) return '';
    const koboStr = String(config.maxKobo);
    const naira = BigInt(koboStr) / 100n;
    return naira.toString();
  })();

  const { control, handleSubmit, formState, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { dailyLimitNaira: '' },
  });

  useEffect(() => {
    reset({ dailyLimitNaira: currentDailyLimit });
  }, [currentDailyLimit, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await publishRules(subWalletId, [
        {
          kind: 'limit',
          priority: 10,
          config: {
            windowKind: 'daily',
            maxKobo: nairaToKobo(values.dailyLimitNaira),
          },
        },
      ]);
      navigation.goBack();
    } catch {
      // errorCode set on store
    }
  });

  return (
    <Screen title="Daily limit" keyboardAvoiding scrollable>
      <Body muted>
        Spend above this in 24 hours triggers a bump request to you. Categories + time windows land
        in a future update.
      </Body>

      <Controller
        control={control}
        name="dailyLimitNaira"
        render={({ field, fieldState }) => (
          <View>
            <UITextInput
              label="AMOUNT (₦)"
              autoFocus
              keyboardType="numeric"
              value={field.value}
              onChangeText={field.onChange}
              placeholder="50000"
              error={fieldState.error?.message}
            />
          </View>
        )}
      />

      {errorCode ? (
        <Body style={{ color: theme.colors.debit }}>Server: {errorCode}</Body>
      ) : null}

      <Button
        label="PUBLISH RULES"
        onPress={onSubmit}
        loading={busy || formState.isSubmitting}
        disabled={busy || formState.isSubmitting}
        fullWidth
      />
    </Screen>
  );
}
