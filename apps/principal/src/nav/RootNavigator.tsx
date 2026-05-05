import { NavigationContainer } from '@react-navigation/native';
import { useEffect } from 'react';
import { SplashScreen } from '../screens/SplashScreen';
import { useAuthStore } from '../state/auth.store';
import { AuthStack } from './AuthStack';
import { MainStack } from './MainStack';

export function RootNavigator(): JSX.Element {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'booting') return <SplashScreen />;

  return (
    <NavigationContainer>
      {status === 'logged_in' ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
