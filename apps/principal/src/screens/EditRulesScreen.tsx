import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
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
import type { MainStackParamList } from '../nav/MainStack';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'EditRules'>;

const schema = z.object({
  dailyLimitNaira: z.string().regex(/^\d+(\.\d{1,2})?$/, 'e.g. 50000 or 50000.00'),
});
type FormValues = z.infer<typeof schema>;

const nairaToKobo = (naira: string): string => {
  const [whole = '0', frac = ''] = naira.split('.');
  const fracPad = (frac + '00').slice(0, 2);
  return `${BigInt(whole) * 100n + BigInt(fracPad || '0')}`;
};

export function EditRulesScreen({ navigation, route }: Props): JSX.Element {
  const { subWalletId } = route.params;
  const rules = useSubWalletsStore((s) => s.rulesById[subWalletId]);
  const busy = useSubWalletsStore((s) => s.busy);
  const errorCode = useSubWalletsStore((s) => s.errorCode);
  const refreshRules = useSubWalletsStore((s) => s.refreshRules);
  const publishRules = useSubWalletsStore((s) => s.publishRules);

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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Daily limit</Text>
      <Text style={styles.muted}>
        Spend above this in 24 hours triggers a bump request to you. Categories + time windows
        land in a future update.
      </Text>

      <Controller
        control={control}
        name="dailyLimitNaira"
        render={({ field, fieldState }) => (
          <View>
            <Text style={styles.label}>Amount (₦)</Text>
            <TextInput
              autoFocus
              keyboardType="numeric"
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="50000"
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
        <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Publish rules'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  label: { fontSize: 12, color: '#666' },
  muted: { color: '#666' },
  err: { color: '#b00020' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
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
