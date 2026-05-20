import { zodResolver } from '@hookform/resolvers/zod';
import { Body, Button, Screen, TextInput as UITextInput, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
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
  const theme = useTheme();

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
    <Screen title="Set up your household" keyboardAvoiding scrollable>
      <Body muted>
        Your household holds your master wallet. You&apos;ll fund it once and issue sub-wallets to
        your agents.
      </Body>

      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <View>
            <UITextInput
              label="HOUSEHOLD NAME"
              autoFocus
              value={field.value}
              onChangeText={field.onChange}
              placeholder="e.g. Adegbola family"
              error={fieldState.error?.message}
            />
          </View>
        )}
      />

      {errorCode ? (
        <Body style={{ color: theme.colors.debit }}>Server: {errorCode}</Body>
      ) : null}

      <Button
        label={status === 'loading' ? 'CREATING…' : 'CREATE HOUSEHOLD'}
        onPress={onSubmit}
        loading={status === 'loading'}
        disabled={status === 'loading' || formState.isSubmitting}
        fullWidth
      />
    </Screen>
  );
}
