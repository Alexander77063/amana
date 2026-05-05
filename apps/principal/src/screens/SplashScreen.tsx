import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export function SplashScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Amana</Text>
      <ActivityIndicator />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  title: { fontSize: 32, fontWeight: '600' },
});
