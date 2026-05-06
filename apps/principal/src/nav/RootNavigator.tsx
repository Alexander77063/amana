import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { useEffect } from 'react';
import { SplashScreen } from '../screens/SplashScreen';
import { useAuthStore } from '../state/auth.store';
import { AuthStack } from './AuthStack';
import { MainStack, type MainStackParamList } from './MainStack';

export const navigationRef = createNavigationContainerRef<MainStackParamList>();

export function RootNavigator(): JSX.Element {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'booting') return <SplashScreen />;

  return (
    <NavigationContainer ref={navigationRef}>
      {status === 'logged_in' ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
