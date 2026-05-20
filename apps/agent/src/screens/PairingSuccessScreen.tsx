import { Body, Button, CoinSealMark, Heading, Label, Screen, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'PairingSuccess'> & {
  onPaired: () => void;
};

export function PairingSuccessScreen({ route, onPaired }: Props): JSX.Element {
  const theme = useTheme();
  const { subWalletName, principalPhone } = route.params;
  return (
    <Screen title="Paired!">
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <CoinSealMark size={80} variant="agent" />
        <Heading size="lg">{subWalletName}</Heading>
        <View style={{ gap: 4, alignItems: 'center' }}>
          <Label>PRINCIPAL</Label>
          <Body>{principalPhone}</Body>
        </View>
        <Button label="LET'S GO" onPress={onPaired} style={{ marginTop: 16, width: '100%' }} />
      </View>
    </Screen>
  );
}
