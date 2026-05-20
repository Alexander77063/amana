import type { ChannelPreference, NotificationChannel, NotificationKind } from '@amana/types';
import { Badge, Body, Card, Screen, SectionHeader, TextInput as UITextInput, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import {
  koboToNairaDisplay,
  nairaInputToKoboString,
  scorePercentInputToThresholdKobo,
  thresholdKoboToScorePercentDisplay,
} from '../lib/threshold-conversion';
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

export function NotificationKindDetailScreen({ route }: Props): JSX.Element {
  const { kind } = route.params;
  const getEffective = usePreferencesStore((s) => s.getEffective);
  const setPref = usePreferencesStore((s) => s.set);

  const isThreshold = isThresholdKind(kind);

  return (
    <Screen title={kindTitle(kind)} scrollable>
      {CHANNELS.map((channel) => {
        const eff = getEffective(kind, channel);
        return (
          <View key={channel} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <SectionHeader title={CHANNEL_LABELS[channel]} />
              {eff.isDefault && <Badge label="Default" variant="neutral" />}
            </View>
            <Card>
              {isThreshold ? (
                <ThresholdControl kind={kind} channel={channel} effective={eff} onSet={setPref} />
              ) : (
                <BinaryControl kind={kind} channel={channel} effective={eff} onSet={setPref} />
              )}
            </Card>
          </View>
        );
      })}
    </Screen>
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
  onSet: (input: {
    kind: NotificationKind;
    channel: NotificationChannel;
    preference: ChannelPreference;
    thresholdKobo?: string | null;
  }) => Promise<void>;
}): JSX.Element {
  const on = effective.preference !== 'silent';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Body muted>{on ? 'On' : 'Off'}</Body>
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
  onSet: (input: {
    kind: NotificationKind;
    channel: NotificationChannel;
    preference: ChannelPreference;
    thresholdKobo?: string | null;
  }) => Promise<void>;
}): JSX.Element {
  const theme = useTheme();
  const isAnomaly = kind === 'anomaly_alert';
  const [draft, setDraft] = useState(() => {
    if (effective.thresholdKobo === null) return '';
    return isAnomaly
      ? thresholdKoboToScorePercentDisplay(effective.thresholdKobo)
      : koboToNairaDisplay(effective.thresholdKobo);
  });

  // Re-sync draft when entering 'threshold' mode and a server-saved value is present.
  useEffect(() => {
    if (effective.preference !== 'threshold' || effective.thresholdKobo === null) return;
    setDraft(
      isAnomaly
        ? thresholdKoboToScorePercentDisplay(effective.thresholdKobo)
        : koboToNairaDisplay(effective.thresholdKobo),
    );
  }, [effective.preference, effective.thresholdKobo, isAnomaly]);

  const choose = (next: ChannelPreference) => {
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
    if (koboStr === null) return;
    void onSet({
      kind,
      channel,
      preference: 'threshold',
      thresholdKobo: koboStr,
    });
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', borderRadius: 999, backgroundColor: theme.colors['bg.raised'], padding: 4 }}>
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
        <View style={{ marginTop: 12, gap: 6 }}>
          <Body muted>
            {isAnomaly ? 'Score above (%, 0–100):' : 'Notify me above (₦):'}
          </Body>
          <TextInput
            style={{
              borderWidth: 0.5,
              borderColor: theme.colors.border,
              borderRadius: 8,
              padding: 12,
              fontSize: 16,
              color: theme.colors['text.primary'],
              backgroundColor: theme.colors['bg.surface'],
            }}
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
  const theme = useTheme();
  return (
    <Pressable
      style={[
        { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 999 },
        active && { backgroundColor: theme.colors.accent },
      ]}
      onPress={onPress}
    >
      <Body style={[{ fontSize: 13 }, active && { color: theme.colors['bg.base'] }]}>{label}</Body>
    </Pressable>
  );
}
