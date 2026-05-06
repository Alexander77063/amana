import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  ChannelPreference,
  NotificationChannel,
  NotificationKind,
} from '@amana/types';
import { useLayoutEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { usePreferencesStore } from '../state/preferences.store';

type Props = NativeStackScreenProps<MainStackParamList, 'NotificationKindDetail'>;

const CHANNELS: NotificationChannel[] = ['push', 'in_app', 'sms'];

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: 'Push',
  in_app: 'In-app',
  sms: 'SMS',
};

const THRESHOLD_KINDS: NotificationKind[] = ['txn_settled', 'txn_failed', 'anomaly_alert'];

function isThresholdKind(kind: NotificationKind): boolean {
  return THRESHOLD_KINDS.includes(kind);
}

function kindTitle(kind: NotificationKind): string {
  switch (kind) {
    case 'bump_requested':
      return 'Bump requests';
    case 'bump_decided':
      return 'Bump decisions';
    case 'txn_settled':
      return 'Payments sent';
    case 'txn_failed':
      return 'Failed payments';
    case 'anomaly_alert':
      return 'Anomaly alerts';
    case 'refund_received':
      return 'Refunds received';
  }
}

/** Convert naira (string from input) → kobo (string). Returns null on empty/invalid. */
function nairaInputToKoboString(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const naira = Number(trimmed);
  if (!Number.isFinite(naira) || naira < 0) return null;
  return Math.round(naira * 100).toString();
}

/** Convert kobo string → naira display string. */
function koboToNairaDisplay(kobo: string | null): string {
  if (kobo === null) return '';
  const kn = BigInt(kobo);
  const naira = kn / 100n;
  const remainder = kn % 100n;
  if (remainder === 0n) return naira.toString();
  return `${naira}.${remainder.toString().padStart(2, '0')}`;
}

/** For anomaly_alert: backend stores percent×100 in thresholdKobo (e.g., 8500 = 0.85 score). */
function thresholdKoboToScorePercentDisplay(kobo: string | null): string {
  if (kobo === null) return '';
  return (Number(kobo) / 100).toString();
}

function scorePercentInputToThresholdKobo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return Math.round(pct * 100).toString();
}

export function NotificationKindDetailScreen({ route, navigation }: Props): JSX.Element {
  const { kind } = route.params;
  const getEffective = usePreferencesStore((s) => s.getEffective);
  const setPref = usePreferencesStore((s) => s.set);

  useLayoutEffect(() => {
    navigation.setOptions({ title: kindTitle(kind) });
  }, [navigation, kind]);

  const isThreshold = isThresholdKind(kind);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {CHANNELS.map((channel) => {
        const eff = getEffective(kind, channel);
        return (
          <View key={channel} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{CHANNEL_LABELS[channel]}</Text>
              {eff.isDefault && (
                <View style={styles.defaultPill}>
                  <Text style={styles.defaultPillText}>Default</Text>
                </View>
              )}
            </View>
            {isThreshold ? (
              <ThresholdControl
                kind={kind}
                channel={channel}
                effective={eff}
                onSet={setPref}
              />
            ) : (
              <BinaryControl
                kind={kind}
                channel={channel}
                effective={eff}
                onSet={setPref}
              />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function BinaryControl({
  kind,
  channel,
  effective,
  onSet,
}: {
  kind: NotificationKind;
  channel: NotificationChannel;
  effective: { preference: ChannelPreference };
  onSet: (input: { kind: NotificationKind; channel: NotificationChannel; preference: ChannelPreference; thresholdKobo?: string | null }) => Promise<void>;
}): JSX.Element {
  const on = effective.preference !== 'silent';
  return (
    <View style={styles.controlRow}>
      <Text style={styles.muted}>{on ? 'On' : 'Off'}</Text>
      <Switch
        value={on}
        onValueChange={(next) => {
          void onSet({
            kind,
            channel,
            preference: next ? 'real_time' : 'silent',
            thresholdKobo: null,
          });
        }}
      />
    </View>
  );
}

function ThresholdControl({
  kind,
  channel,
  effective,
  onSet,
}: {
  kind: NotificationKind;
  channel: NotificationChannel;
  effective: { preference: ChannelPreference; thresholdKobo: string | null };
  onSet: (input: { kind: NotificationKind; channel: NotificationChannel; preference: ChannelPreference; thresholdKobo?: string | null }) => Promise<void>;
}): JSX.Element {
  const isAnomaly = kind === 'anomaly_alert';
  const initial =
    effective.preference === 'threshold'
      ? isAnomaly
        ? thresholdKoboToScorePercentDisplay(effective.thresholdKobo)
        : koboToNairaDisplay(effective.thresholdKobo)
      : '';
  const [draft, setDraft] = useState(initial);

  const choose = (next: ChannelPreference) => {
    // Preserve the saved thresholdKobo across all mode toggles. Backend stores it
    // regardless of preference; shouldSend only consults it when preference === 'threshold',
    // so the saved value is harmless when off and ready when the user toggles back.
    void onSet({
      kind,
      channel,
      preference: next,
      thresholdKobo: effective.thresholdKobo,
    });
  };

  const commitThreshold = () => {
    const koboStr = isAnomaly
      ? scorePercentInputToThresholdKobo(draft)
      : nairaInputToKoboString(draft);
    if (koboStr === null) return; // ignore invalid input; user can correct
    void onSet({
      kind,
      channel,
      preference: 'threshold',
      thresholdKobo: koboStr,
    });
  };

  return (
    <View>
      <View style={styles.segmented}>
        <SegBtn
          label="Real-time"
          active={effective.preference === 'real_time'}
          onPress={() => choose('real_time')}
        />
        <SegBtn
          label={isAnomaly ? 'Above score' : 'Above amount'}
          active={effective.preference === 'threshold'}
          onPress={() => choose('threshold')}
        />
        <SegBtn
          label="Off"
          active={effective.preference === 'silent'}
          onPress={() => choose('silent')}
        />
      </View>
      {effective.preference === 'threshold' && (
        <View style={styles.thresholdInput}>
          <Text style={styles.muted}>
            {isAnomaly ? 'Score above (%, 0–100):' : 'Notify me above (₦):'}
          </Text>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            onBlur={commitThreshold}
            keyboardType="numeric"
            placeholder={isAnomaly ? '85' : '5000'}
          />
        </View>
      )}
    </View>
  );
}

function SegBtn({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable style={[styles.seg, active && styles.segActive]} onPress={onPress}>
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 24 },
  section: { gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  defaultPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#e0e0e0',
  },
  defaultPillText: { fontSize: 11, fontWeight: '600', color: '#444' },
  controlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  muted: { color: '#666' },
  segmented: { flexDirection: 'row', borderRadius: 999, backgroundColor: '#f3f3f3', padding: 4 },
  seg: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 999 },
  segActive: { backgroundColor: '#222' },
  segText: { fontSize: 13, color: '#444', fontWeight: '500' },
  segTextActive: { color: 'white' },
  thresholdInput: { marginTop: 12, gap: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bbb',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
});
