import { Body, Button, Caption, Card, Screen, TextInput as UITextInput, useTheme } from '@amana/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, View } from 'react-native';
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
  const theme = useTheme();

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

  if (!household) return <Screen title="New sub-wallet">{null}</Screen>;

  if (agents.length === 0) {
    return (
      <Screen title="New sub-wallet">
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}
        >
          <Body strong>No paired agents</Body>
          <Body muted>Pair an agent first, then come back to create a sub-wallet for them.</Body>
          <Button label="GO TO PAIRING" onPress={() => navigation.navigate('Pairing')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="New sub-wallet" keyboardAvoiding scrollable>
      <Caption>PICK AN AGENT</Caption>
      <Controller
        control={control}
        name="agentUserId"
        render={({ fieldState }) => (
          <View style={{ gap: 8 }}>
            {agents.map((m) => {
              const active = selectedAgentId === m.userId;
              return (
                <Pressable
                  key={m.userId}
                  onPress={() => setValue('agentUserId', m.userId, { shouldValidate: true })}
                >
                  <Card accent={active}>
                    <Body strong>{m.phone}</Body>
                    <Caption>{`KYC tier ${m.kycTier}`}</Caption>
                  </Card>
                </Pressable>
              );
            })}
            {fieldState.error ? (
              <Body style={{ color: theme.colors.debit }}>{fieldState.error.message ?? ''}</Body>
            ) : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <UITextInput
            label="SUB-WALLET NAME"
            value={field.value}
            onChangeText={field.onChange}
            placeholder="e.g. School fees, Driver, Kitchen"
            error={fieldState.error?.message}
          />
        )}
      />

      {errorCode ? <Body style={{ color: theme.colors.debit }}>Server: {errorCode}</Body> : null}

      <Button
        label={busy ? 'CREATING…' : 'CREATE SUB-WALLET'}
        onPress={onSubmit}
        loading={busy}
        disabled={busy || formState.isSubmitting}
        fullWidth
      />
    </Screen>
  );
}
