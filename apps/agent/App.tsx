import { StatusBar } from 'expo-status-bar';
import { HealthCheck } from './src/screens/HealthCheck';

export default function App(): JSX.Element {
  return (
    <>
      <StatusBar style="auto" />
      <HealthCheck />
    </>
  );
}
