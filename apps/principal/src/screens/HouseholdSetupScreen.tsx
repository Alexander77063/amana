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
import type { MainStackParamList } from '../nav/MainStack';
import { useHouseholdStore } from '../state/household.store';

type Props = NativeStackScreenProps<MainStackParamList, 'HouseholdSetup'>;

const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(60, 'Too long'),
});
type FormValues = z.infer<typeof schema>;

export function HouseholdSetupScreen({ navigation }: Props): JSX.Element {
  const createHousehold = useHouseholdStore((s) => s.createHousehold);
  const status = useHouseholdStore((s) => s.status);
  const errorCode = useHouseholdStore((s) => s.errorCode);

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createHousehold(values.name);
      navigation.replace('HomeDashboard');
    } catch {
      // errorCode set on store
    }
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Set up your household</Text>
      <Text style={styles.muted}>
        Your household holds your master wallet. You&apos;ll fund it once and issue sub-wallets to
        your agents.
      </Text>

      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <View>
            <Text style={styles.label}>Household name</Text>
            <TextInput
              autoFocus
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="e.g. Adegbola family"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />

      {errorCode && <Text style={styles.err}>Server: {errorCode}</Text>}

      <Pressable
        accessibilityRole="button"
        disabled={status === 'loading' || formState.isSubmitting}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          (status === 'loading' || formState.isSubmitting) && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>
          {status === 'loading' ? 'Creating…' : 'Create household'}
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
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
