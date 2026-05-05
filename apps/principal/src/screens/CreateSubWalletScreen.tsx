import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { z } from 'zod';
import type { MainStackParamList } from '../nav/MainStack';
import { useHouseholdStore } from '../state/household.store';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'CreateSubWallet'>;

const schema = z.object({
  agentUserId: z.string().min(1, 'Pick an agent'),
  name: z.string().trim().min(1, 'Required').max(40, 'Too long'),
});
type FormValues = z.infer<typeof schema>;

export function CreateSubWalletScreen({ navigation }: Props): JSX.Element {
  const household = useHouseholdStore((s) => s.household);
  const members = useHouseholdStore((s) => s.members);
  const refreshMembers = useHouseholdStore((s) => s.refreshMembers);
  const create = useSubWalletsStore((s) => s.create);
  const busy = useSubWalletsStore((s) => s.busy);
  const errorCode = useSubWalletsStore((s) => s.errorCode);

  useEffect(() => {
    void refreshMembers();
  }, [refreshMembers]);

  const agents = members.filter((m) => m.role === 'agent' && m.status === 'active');

  const { control, handleSubmit, formState, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { agentUserId: '', name: '' },
  });
  const selectedAgentId = watch('agentUserId');

  const onSubmit = handleSubmit(async (values) => {
    if (!household) return;
    try {
      await create(household.id, values.agentUserId, values.name);
      navigation.goBack();
    } catch {
      // errorCode set on store
    }
  });

  if (!household) return <View />;

  if (agents.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No paired agents</Text>
        <Text style={styles.muted}>
          Pair an agent first, then come back to create a sub-wallet for them.
        </Text>
        <Pressable style={styles.button} onPress={() => navigation.navigate('Pairing')}>
          <Text style={styles.buttonText}>Go to Pairing</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>New sub-wallet</Text>

        <Text style={styles.label}>Pick an agent</Text>
        <Controller
          control={control}
          name="agentUserId"
          render={({ fieldState }) => (
            <View style={styles.agentList}>
              {agents.map((m) => {
                const active = selectedAgentId === m.userId;
                return (
                  <Pressable
                    key={m.userId}
                    onPress={() => setValue('agentUserId', m.userId, { shouldValidate: true })}
                    style={[styles.agentRow, active && styles.agentRowActive]}
                  >
                    <Text style={[styles.agentPhone, active && styles.agentPhoneActive]}>
                      {m.phone}
                    </Text>
                    <Text style={[styles.muted, active && styles.agentMutedActive]}>
                      KYC tier {m.kycTier}
                    </Text>
                  </Pressable>
                );
              })}
              {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
            </View>
          )}
        />

        <Controller
          control={control}
          name="name"
          render={({ field, fieldState }) => (
            <View>
              <Text style={styles.label}>Sub-wallet name</Text>
              <TextInput
                style={styles.input}
                value={field.value}
                onChangeText={field.onChange}
                placeholder="e.g. School fees, Driver, Kitchen"
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
          <Text style={styles.buttonText}>{busy ? 'Creating…' : 'Create sub-wallet'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 24, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 22, fontWeight: '600' },
  label: { fontSize: 12, color: '#666' },
  muted: { color: '#666' },
  err: { color: '#b00020' },
  agentList: { gap: 8 },
  agentRow: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    gap: 4,
  },
  agentRowActive: { borderColor: '#222', backgroundColor: '#222' },
  agentPhone: { fontSize: 16, fontWeight: '600', color: '#222' },
  agentPhoneActive: { color: 'white' },
  agentMutedActive: { color: '#ccc' },
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
