import {
  AmountText,
  Badge,
  Body,
  Button,
  Card,
  Heading,
  Label,
  Screen,
  formatNaira,
  useTheme,
} from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

const POLL_INTERVAL_MS = 3_000;

type Props = NativeStackScreenProps<PayStackParamList, 'BumpWait'>;

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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

  /**
   * Continue an approved spend.
   *
   * The approval lives on the principal's phone; what unlocks the payment here is the one-shot
   * token, which the agent pulls over its own authenticated connection. Consuming it moves the
   * transaction out of bump_pending, which is what lets the Sending screen hand it to the bank.
   */
  const resumeApproved = async () => {
    if (navigated.current) return;
    try {
      const { resumeToken } = await api.transaction.bumpStatus(transactionId);
      if (!resumeToken) return; // approved but already consumed — the poll will settle it
      navigated.current = true;
      await api.transaction.resumeAfterBump(transactionId, resumeToken);
      navigation.replace('Sending', { transactionId });
    } catch {
      // Leave it to the poll below rather than failing a payment the principal approved.
      navigated.current = false;
    }
  };

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (navigated.current) return;
      const data = notification.request.content.data as Record<string, unknown>;
      if (data.kind !== 'bump_decided' || data.transactionId !== transactionId) return;
      if (
        data.decision === 'approved' ||
        data.decision === 'approved_once' ||
        data.decision === 'raise_limit'
      ) {
        void resumeApproved();
      } else {
        navigated.current = true;
        navigation.replace('Failed', {
          transactionId,
          errorMessage: `Bump ${String(data.decision ?? 'denied')}`,
        });
      }
    });
    return () => sub.remove();
  }, [navigation, transactionId]);

  /**
   * Poll the bump as well as listening for the push.
   *
   * Push is best-effort — it can be dropped, delayed, or denied at the OS level, and it does
   * not exist at all on web. Without this the agent sat on this screen until the request
   * expired, even though the principal had already approved.
   */
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive || navigated.current) return;
      try {
        const { status } = await api.transaction.bumpStatus(transactionId);
        if (status === 'approved_once' || status === 'raise_limit') {
          await resumeApproved();
        } else if (status === 'denied' || status === 'expired' || status === 'cancelled') {
          navigated.current = true;
          navigation.replace('Failed', { transactionId, errorMessage: `Bump ${status}` });
        }
      } catch {
        // Transient — keep polling.
      }
      if (alive && !navigated.current) setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    const id = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      alive = false;
      clearTimeout(id);
    };
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
