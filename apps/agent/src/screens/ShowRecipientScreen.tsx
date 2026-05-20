import { AmountText, Body, Button, Card, Label, Screen, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'ShowRecipient'>;

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ShowRecipientScreen({ route, navigation }: Props): JSX.Element {
  const theme = useTheme();
  const { amountKobo, resolvedName, sessionId } = route.params;
  return (
    <Screen title="Recipient">
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Card accent style={{ width: '100%', alignItems: 'center', gap: 12 }}>
          <AmountText size="xl" value={formatNaira(amountKobo)} sentiment="credit" />
          <View style={{ gap: 4, alignItems: 'center' }}>
            <Label>SENT TO</Label>
            <Body strong>{resolvedName}</Body>
          </View>
          {sessionId ? (
            <View style={{ gap: 4, alignItems: 'center' }}>
              <Label>NIBSS SESSION</Label>
              <Body muted style={{ textAlign: 'center' }}>{sessionId}</Body>
              <Body muted style={{ textAlign: 'center' }}>
                Should appear in your bank within 30 seconds.
              </Body>
            </View>
          ) : null}
        </Card>

        <Button variant="ghost" label="BACK" onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}
