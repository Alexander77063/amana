import {
  AmountText,
  Body,
  Button,
  Caption,
  Card,
  Label,
  Screen,
  Skeleton,
  useTheme,
} from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { type SnoozePreset, presetToExpiresAt } from '../lib/snooze-presets';
import type { MainStackParamList } from '../nav/MainStack';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'SubWalletDetail'>;

function formatKobo(koboStr: string | undefined): string {
  if (!koboStr) return '—';
  const naira = BigInt(koboStr) / 100n;
  const remainder = BigInt(koboStr) % 100n;
  return `₦${naira}.${String(remainder).padStart(2, '0')}`;
}

export function SubWalletDetailScreen({ navigation, route }: Props): JSX.Element {
  const { subWalletId } = route.params;
  const sw = useSubWalletsStore((s) => s.byId[subWalletId]);
  const balance = useSubWalletsStore((s) => s.balanceById[subWalletId]);
  const rules = useSubWalletsStore((s) => s.rulesById[subWalletId]);
  const busy = useSubWalletsStore((s) => s.busy);
  const refreshOne = useSubWalletsStore((s) => s.refreshOne);
  const refreshBalance = useSubWalletsStore((s) => s.refreshBalance);
  const refreshRules = useSubWalletsStore((s) => s.refreshRules);
  const setStatus = useSubWalletsStore((s) => s.setStatus);
  const snoozeAction = useSubWalletsStore((s) => s.snooze);
  const unsnoozeAction = useSubWalletsStore((s) => s.unsnooze);
  const theme = useTheme();

  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  useEffect(() => {
    void refreshOne(subWalletId);
    void refreshBalance(subWalletId);
    void refreshRules(subWalletId);
  }, [subWalletId, refreshOne, refreshBalance, refreshRules]);

  if (!sw) {
    return (
      <Screen title="Sub-wallet">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Skeleton />
        </View>
      </Screen>
    );
  }

  const snoozedUntil = sw?.snoozedUntil ?? null;
  const isSnoozeActive = snoozedUntil !== null && new Date(snoozedUntil) > new Date();

  const renderSnoozeStatus = (): string => {
    if (!isSnoozeActive) return 'Off';
    const ends = new Date(snoozedUntil as string);
    return `Snoozed until ${ends.toLocaleString()}`;
  };

  return (
    <Screen title={sw.name} scrollable>
      <Body muted>Status: {sw.status}</Body>

      <Card>
        <Label>BALANCE</Label>
        <AmountText size="xl" value={formatKobo(balance)} sentiment="neutral" />
      </Card>

      <Card>
        <Label>NOTIFICATIONS</Label>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 4,
          }}
        >
          <Body>{renderSnoozeStatus()}</Body>
          {isSnoozeActive ? (
            <Pressable onPress={() => void unsnoozeAction(subWalletId)}>
              <Body style={{ color: theme.colors.accent }}>Unmute</Body>
            </Pressable>
          ) : (
            <Pressable onPress={() => setActionSheetOpen(true)}>
              <Body style={{ color: theme.colors.accent }}>Snooze ▾</Body>
            </Pressable>
          )}
        </View>
      </Card>

      <Modal
        visible={actionSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setActionSheetOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          onPress={() => setActionSheetOpen(false)}
        >
          <View
            style={{
              backgroundColor: theme.colors.bg.surface,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              paddingVertical: 8,
            }}
          >
            {[
              { label: '1 hour', preset: 'one_hour' as SnoozePreset },
              { label: '4 hours', preset: 'four_hours' as SnoozePreset },
              { label: 'Until tomorrow morning', preset: 'tomorrow_morning' as SnoozePreset },
              { label: 'Until I unmute', preset: 'indefinite' as SnoozePreset },
            ].map(({ label, preset }) => (
              <Pressable
                key={preset}
                style={{
                  paddingVertical: 16,
                  paddingHorizontal: 24,
                  borderBottomWidth: 0.5,
                  borderBottomColor: theme.colors.border,
                }}
                onPress={() => {
                  const until = presetToExpiresAt(preset, new Date());
                  setActionSheetOpen(false);
                  void snoozeAction(subWalletId, until);
                }}
              >
                <Body>{label}</Body>
              </Pressable>
            ))}
            <Pressable
              style={{ paddingVertical: 16, paddingHorizontal: 24 }}
              onPress={() => setActionSheetOpen(false)}
            >
              <Body muted>Cancel</Body>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Label>ACTIVE RULES</Label>
          <Pressable onPress={() => navigation.navigate('EditRules', { subWalletId })}>
            <Body style={{ color: theme.colors.accent }}>Edit</Body>
          </Pressable>
        </View>
        {rules === null && (
          <Body muted>
            No rules published yet — agent can spend without limit until you set one.
          </Body>
        )}
        {rules && rules.rules.length === 0 && <Body muted>(empty rule set)</Body>}
        {rules?.rules.map((r) => (
          <View key={r.id} style={{ gap: 4, paddingVertical: 6 }}>
            <Body strong>{`${r.kind} (priority ${r.priority})`}</Body>
            <Caption>{JSON.stringify(r.configJson)}</Caption>
          </View>
        ))}
      </Card>

      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
        {sw.status !== 'suspended' && (
          <Button
            variant="secondary"
            label="SUSPEND"
            onPress={() => void setStatus(subWalletId, 'suspended')}
            disabled={busy}
            loading={busy}
          />
        )}
        {sw.status === 'suspended' && (
          <Button
            label="RESUME"
            onPress={() => void setStatus(subWalletId, 'active')}
            disabled={busy}
            loading={busy}
          />
        )}
        {sw.status !== 'closed' && (
          <Button
            variant="secondary"
            label="CLOSE"
            onPress={() => void setStatus(subWalletId, 'closed')}
            disabled={busy}
            loading={busy}
          />
        )}
      </View>
    </Screen>
  );
}
