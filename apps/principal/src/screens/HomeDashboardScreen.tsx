import { Badge, Body, Button, Card, Screen, Skeleton, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useBumpsStore } from '../state/bumps.store';
import { useHouseholdStore } from '../state/household.store';
import { useNotificationsStore } from '../state/notifications.store';

type Props = NativeStackScreenProps<MainStackParamList, 'HomeDashboard'>;

export function HomeDashboardScreen({ navigation }: Props): JSX.Element {
  const status = useHouseholdStore((s) => s.status);
  const household = useHouseholdStore((s) => s.household);
  const masterWallet = useHouseholdStore((s) => s.masterWallet);
  const members = useHouseholdStore((s) => s.members);
  const errorCode = useHouseholdStore((s) => s.errorCode);
  const bootstrap = useHouseholdStore((s) => s.bootstrap);
  const refreshBumps = useBumpsStore((s) => s.refresh);
  const pendingCount = useBumpsStore((s) => s.pending.length);
  const refreshNotifications = useNotificationsStore((s) => s.refresh);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const theme = useTheme();

  useEffect(() => {
    if (status === 'idle') void bootstrap();
  }, [status, bootstrap]);

  useEffect(() => {
    if (status === 'has_household') {
      void refreshBumps();
      void refreshNotifications();
    }
  }, [status, refreshBumps, refreshNotifications]);

  useEffect(() => {
    if (status === 'no_household') navigation.replace('HouseholdSetup');
  }, [status, navigation]);

  if (status === 'idle' || status === 'loading') {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Skeleton lines={3} />
        </View>
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <Body style={{ color: theme.colors.debit }}>Couldn&apos;t load: {errorCode}</Body>
          <Button label="RETRY" onPress={() => void bootstrap()} />
        </View>
      </Screen>
    );
  }

  if (!household || !masterWallet) {
    return <Screen />;
  }

  return (
    <Screen title={household.name} scrollable>
      <Card>
        <Body strong>Top up your wallet</Body>
        <Body muted>Send via NIP transfer to:</Body>
        <Body strong>{masterWallet.anchorVirtualAccount}</Body>
        <Body muted>Bank code: {masterWallet.anchorBankCode}</Body>
      </Card>

      <Pressable onPress={() => navigation.navigate('BumpsInbox')}>
        <Card style={{ paddingVertical: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body strong>Pending requests</Body>
            {pendingCount > 0 && <Badge count={pendingCount} variant="neutral" />}
          </View>
          <Body muted>Approve or deny agent bumps</Body>
        </Card>
      </Pressable>

      <Pressable onPress={() => navigation.navigate('NotificationsInbox')}>
        <Card style={{ paddingVertical: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body strong>Notifications</Body>
            {unreadCount > 0 && <Badge count={unreadCount} variant="neutral" />}
          </View>
          <Body muted>Recent activity</Body>
        </Card>
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Members')}>
        <Card style={{ paddingVertical: 16 }}>
          <Body strong>Agents</Body>
          <Body muted>{members.length} paired</Body>
        </Card>
      </Pressable>

      <Pressable onPress={() => navigation.navigate('SubWalletsList')}>
        <Card style={{ paddingVertical: 16 }}>
          <Body strong>Sub-wallets</Body>
          <Body muted>Manage controlled spend</Body>
        </Card>
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Pairing')}>
        <Card style={{ paddingVertical: 16 }}>
          <Body strong>Pair an agent</Body>
          <Body muted>Issue a one-time code</Body>
        </Card>
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Settings')}>
        <Card style={{ paddingVertical: 16 }}>
          <Body strong>Settings</Body>
          <Body muted>Notifications, log out, and more</Body>
        </Card>
      </Pressable>
    </Screen>
  );
}
