import { CoinSealWordmark, Screen, Skeleton } from '@amana/ui';
import { View } from 'react-native';

export function SplashScreen(): JSX.Element {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <CoinSealWordmark size={40} />
        <Skeleton lines={1} width={120} />
      </View>
    </Screen>
  );
}
