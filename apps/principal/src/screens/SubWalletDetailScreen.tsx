import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  useEffect(() => {
    void refreshOne(subWalletId);
    void refreshBalance(subWalletId);
    void refreshRules(subWalletId);
  }, [subWalletId, refreshOne, refreshBalance, refreshRules]);

  if (!sw) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const snoozedUntil = sw?.snoozedUntil ?? null;
  const isSnoozeActive = snoozedUntil !== null && new Date(snoozedUntil) > new Date();

  const renderSnoozeStatus = (): string => {
    if (!isSnoozeActive) return 'Off';
    const ends = new Date(snoozedUntil!);
    return `Snoozed until ${ends.toLocaleString()}`;
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{sw.name}</Text>
      <Text style={styles.muted}>Status: {sw.status}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Balance</Text>
        <Text style={styles.balance}>{formatKobo(balance)}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Notifications</Text>
        <View style={styles.snoozeRow}>
          <Text style={styles.snoozeStatus}>{renderSnoozeStatus()}</Text>
          {isSnoozeActive ? (
            <Pressable onPress={() => void unsnoozeAction(subWalletId)}>
              <Text style={styles.link}>Unmute</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setActionSheetOpen(true)}>
              <Text style={styles.link}>Snooze ▾</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Modal
        visible={actionSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setActionSheetOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setActionSheetOpen(false)}>
          <View style={styles.modalSheet}>
            {[
              { label: '1 hour', preset: 'one_hour' as SnoozePreset },
              { label: '4 hours', preset: 'four_hours' as SnoozePreset },
              { label: 'Until tomorrow morning', preset: 'tomorrow_morning' as SnoozePreset },
              { label: 'Until I unmute', preset: 'indefinite' as SnoozePreset },
            ].map(({ label, preset }) => (
              <Pressable
                key={preset}
                style={styles.sheetItem}
                onPress={() => {
                  const until = presetToExpiresAt(preset, new Date());
                  setActionSheetOpen(false);
                  void snoozeAction(subWalletId, until);
                }}
              >
                <Text style={styles.sheetItemText}>{label}</Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.sheetItem, styles.cancelItem]}
              onPress={() => setActionSheetOpen(false)}
            >
              <Text style={[styles.sheetItemText, styles.cancelText]}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <View style={styles.card}>
        <View style={styles.rowSpread}>
          <Text style={styles.label}>Active rules</Text>
          <Pressable onPress={() => navigation.navigate('EditRules', { subWalletId })}>
            <Text style={styles.link}>Edit</Text>
          </Pressable>
        </View>
        {rules === null && (
          <Text style={styles.muted}>
            No rules published yet — agent can spend without limit until you set one.
          </Text>
        )}
        {rules && rules.rules.length === 0 && <Text style={styles.muted}>(empty rule set)</Text>}
        {rules?.rules.map((r) => (
          <View key={r.id} style={styles.ruleRow}>
            <Text style={styles.ruleKind}>
              {r.kind} (priority {r.priority})
            </Text>
            <Text style={styles.muted}>{JSON.stringify(r.configJson)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        {sw.status !== 'suspended' && (
          <Pressable
            disabled={busy}
            style={({ pressed }) => [
              styles.button,
              styles.warning,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
            onPress={() => void setStatus(subWalletId, 'suspended')}
          >
            <Text style={styles.buttonText}>Suspend</Text>
          </Pressable>
        )}
        {sw.status === 'suspended' && (
          <Pressable
            disabled={busy}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
            onPress={() => void setStatus(subWalletId, 'active')}
          >
            <Text style={styles.buttonText}>Resume</Text>
          </Pressable>
        )}
        {sw.status !== 'closed' && (
          <Pressable
            disabled={busy}
            style={({ pressed }) => [
              styles.button,
              styles.danger,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
            onPress={() => void setStatus(subWalletId, 'closed')}
          >
            <Text style={styles.buttonText}>Close</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
  muted: { color: '#666' },
  label: { fontSize: 12, color: '#666' },
  link: { color: '#1c5fff', fontWeight: '600' },
  card: { padding: 16, gap: 8, borderRadius: 12, backgroundColor: '#f3f3f3' },
  balance: { fontSize: 32, fontWeight: '700' },
  rowSpread: { flexDirection: 'row', justifyContent: 'space-between' },
  ruleRow: { gap: 4, paddingVertical: 6 },
  ruleKind: { fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 16 },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
  },
  warning: { backgroundColor: '#a8590f' },
  danger: { backgroundColor: '#b00020' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
  snoozeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  snoozeStatus: { fontSize: 14, color: '#222' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 8,
  },
  sheetItem: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  sheetItemText: { fontSize: 16, color: '#222' },
  cancelItem: { borderBottomWidth: 0 },
  cancelText: { color: '#666', fontWeight: '600' },
});
