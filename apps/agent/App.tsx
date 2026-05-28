import { ThemeProvider } from '@amana/ui';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { StatusBar } from 'expo-status-bar';
import { Component, type ReactNode } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/nav/RootNavigator';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error),
    };
  }
  render() {
    if (this.state.error) {
      return (
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
          <Text style={{ color: 'red', fontWeight: '700', marginBottom: 8 }}>CRASH</Text>
          <Text style={{ color: 'red', fontFamily: 'monospace', fontSize: 12 }}>
            {this.state.error}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

export default function App(): JSX.Element {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <ThemeProvider fontsLoaded={fontsLoaded}>
          <RootNavigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
