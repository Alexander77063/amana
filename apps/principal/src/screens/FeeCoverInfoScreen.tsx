import { Body, Card, Heading, Screen } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../nav/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'FeeCoverInfo'>;

export function FeeCoverInfoScreen(_props: Props): JSX.Element {
  return (
    <Screen title="Fee cover" scrollable>
      <Card accent>
        <Heading>Every naira lands</Heading>
        <Body muted>
          When you fund your wallet by bank transfer, the bank charges a small funding fee. Amana
          absorbs that fee for you — so the full amount you send arrives in your wallet, every time.
        </Body>
      </Card>
      <Card>
        <Body>
          The total on your home screen is the lifetime sum of bank funding fees Amana has covered
          on your top-ups.
        </Body>
      </Card>
    </Screen>
  );
}
