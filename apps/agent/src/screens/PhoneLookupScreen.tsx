import { Body, Button, Card, Label, Screen, TextInput, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';
import { useAgentStore } from '../state/agent.store';

type Props = NativeStackScreenProps<PayStackParamList, 'PhoneLookup'>;

export function PhoneLookupScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const lookup = async () => {
    const sw = useAgentStore.getState().selectedSubWallet;
    if (!sw || !phone.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const vendor = await api.vendor.phoneLookup(phone.trim(), sw.id);
      navigation.navigate('Confirm', {
        resolvedName: vendor.accountName,
        bankCode: vendor.bankCode,
        accountNumber: vendor.accountNumber,
        accountMasked: `****${vendor.accountNumber.slice(-4)}`,
      });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Phone number not found.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Find Recipient" keyboardAvoiding>
      <View style={{ gap: 12, marginTop: 8 }}>
        <TextInput
          label="PHONE NUMBER"
          placeholder="+2348012345678"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          autoFocus
        />

        {errorMsg ? (
          <Card style={{ backgroundColor: 'transparent' }}>
            <Body style={{ color: theme.colors.debit }}>{errorMsg}</Body>
          </Card>
        ) : null}

        <Button label="LOOK UP" onPress={() => void lookup()} loading={busy} />
      </View>
    </Screen>
  );
}
