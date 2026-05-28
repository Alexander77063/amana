import { AmountText, Badge, Body, Button, Card, Heading, Label, Screen, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'BumpWait'>;

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BumpWaitScreen({ route, navigation }: Props): JSX.Element {
  const theme = useTheme();
  const { transactionId, amountKobo, resolvedName, expiresAt } = route.params;
  const [msLeft, setMsLeft] = useState(() => new Date(expiresAt).getTime() - Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const navigated = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      setMsLeft(new Date(expiresAt).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (navigated.current) return;
      const data = notification.request.content.data as Record<string, unknown>;
      if (data.kind !== 'bump_decided' || data.transactionId !== transactionId) return;
      navigated.current = true;
      if (
        data.decision === 'approved' ||
        data.decision === 'approved_once' ||
        data.decision === 'raise_limit'
      ) {
        navigation.replace('Sending', { transactionId });
      } else {
        navigation.replace('Failed', {
          transactionId,
          errorMessage: `Bump ${String(data.decision ?? 'denied')}`,
        });
      }
    });
    return () => sub.remove();
  }, [navigation, transactionId]);

  const cancel = async () => {
    setCancelling(true);
    setErrorMsg(null);
    try {
      await api.bump.cancelBump(transactionId);
      navigation.replace('Failed', { transactionId, errorMessage: 'CANCELLED_BY_AGENT' });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Cancel failed.');
      setCancelling(false);
    }
  };

  return (
    <Screen title="Waiting for Approval">
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <AmountText size="xl" value={formatNaira(amountKobo)} sentiment="debit" />
        <Body muted>to {resolvedName}</Body>

        <Card style={{ alignItems: 'center', gap: 4, width: '100%' }}>
          <Label>EXPIRES IN</Label>
          <Heading
            size="lg"
            style={{
              fontVariant: ['tabular-nums'],
              color: msLeft < 60_000 ? theme.colors.debit : theme.colors.text.primary,
            }}
          >
            {formatCountdown(msLeft)}
          </Heading>
          <Badge label="Awaiting principal approval" variant="warning" />
        </Card>

        {errorMsg ? <Body style={{ color: theme.colors.debit }}>{errorMsg}</Body> : null}

        <Button
          variant="ghost"
          label="CANCEL"
          onPress={() => void cancel()}
          loading={cancelling}
          style={{ marginTop: 8 }}
        />
      </View>
    </Screen>
  );
}
