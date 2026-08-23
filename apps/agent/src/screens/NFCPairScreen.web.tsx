import { Body, Button, Card, Heading, Screen } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'NFCPair'> & { onPaired: () => void };

/**
 * Web twin of NFCPairScreen, resolved by Metro only for Platform.OS === 'web'.
 *
 * `react-native-nfc-manager` ships no web implementation, so importing the native screen
 * would fail to bundle for web at all. NFC is genuinely a native, Android-only capability —
 * this screen says so plainly rather than pretending otherwise, and points at the two
 * pairing paths that DO work in a browser (QR code and the SMS link).
 */
export function NFCPairScreen({ navigation }: Props): JSX.Element {
  return (
    <Screen title="NFC tap">
      <View style={{ gap: 12, marginTop: 8 }}>
        <Card style={{ gap: 8 }}>
          <Heading size="md">Not available in a browser</Heading>
          <Body muted>
            NFC tap-to-pair needs the phone's NFC radio, which a web browser cannot reach. It works
            on the Android app.
          </Body>
        </Card>
        <Card style={{ gap: 8 }}>
          <Heading size="md">Use another pairing method</Heading>
          <Body muted>
            Ask your principal for the QR code, or for the pairing link — either one pairs this
            device without NFC.
          </Body>
          <Button label="BACK TO PAIRING OPTIONS" onPress={() => navigation.goBack()} />
        </Card>
      </View>
    </Screen>
  );
}
