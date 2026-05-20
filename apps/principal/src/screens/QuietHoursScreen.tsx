import type { QuietHours } from '@amana/types';
import { Body, Button, Card, Caption, Screen, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Switch, TextInput, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { usePreferencesStore } from '../state/preferences.store';

type Props = NativeStackScreenProps<MainStackParamList, 'QuietHours'>;

function minutesToHHMM(min: number): { hh: string; mm: string } {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return { hh: h.toString().padStart(2, '0'), mm: m.toString().padStart(2, '0') };
}

function hhmmToMinutes(hh: string, mm: string): number | null {
  const h = Number.parseInt(hh, 10);
  const m = Number.parseInt(mm, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function QuietHoursScreen({ navigation }: Props): JSX.Element {
  const quietHours = usePreferencesStore((s) => s.quietHours);
  const saveQuietHours = usePreferencesStore((s) => s.saveQuietHours);
  const errorCode = usePreferencesStore((s) => s.errorCode);
  const theme = useTheme();

  const initial: QuietHours = quietHours ?? {
    enabled: false,
    startMinute: 1320,
    endMinute: 420,
  };
  const start0 = minutesToHHMM(initial.startMinute);
  const end0 = minutesToHHMM(initial.endMinute);

  const [enabled, setEnabled] = useState(initial.enabled);
  const [startHH, setStartHH] = useState(start0.hh);
  const [startMM, setStartMM] = useState(start0.mm);
  const [endHH, setEndHH] = useState(end0.hh);
  const [endMM, setEndMM] = useState(end0.mm);
  const [saving, setSaving] = useState(false);

  // Re-sync if the store reloads (parallel bootstrap finished after mount).
  useEffect(() => {
    if (!quietHours) return;
    setEnabled(quietHours.enabled);
    const s = minutesToHHMM(quietHours.startMinute);
    const e = minutesToHHMM(quietHours.endMinute);
    setStartHH(s.hh);
    setStartMM(s.mm);
    setEndHH(e.hh);
    setEndMM(e.mm);
  }, [quietHours]);

  const startMin = hhmmToMinutes(startHH, startMM);
  const endMin = hhmmToMinutes(endHH, endMM);
  const valid = startMin !== null && endMin !== null && startMin !== endMin;

  const onSave = async (): Promise<void> => {
    if (!valid || startMin === null || endMin === null) return;
    setSaving(true);
    await saveQuietHours({ enabled, startMinute: startMin, endMinute: endMin });
    setSaving(false);
  };

  const timeInputStyle = {
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    width: 60,
    textAlign: 'center' as const,
    color: theme.colors['text.primary'],
    backgroundColor: theme.colors['bg.surface'],
  };

  return (
    <Screen title="Quiet hours" scrollable keyboardAvoiding>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Body strong>Quiet hours</Body>
          <Switch value={enabled} onValueChange={setEnabled} />
        </View>
      </Card>

      <Card>
        <Caption>Start</Caption>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <TextInput
            style={timeInputStyle}
            value={startHH}
            onChangeText={setStartHH}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="22"
          />
          <Body strong>:</Body>
          <TextInput
            style={timeInputStyle}
            value={startMM}
            onChangeText={setStartMM}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="00"
          />
        </View>
      </Card>

      <Card>
        <Caption>End</Caption>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <TextInput
            style={timeInputStyle}
            value={endHH}
            onChangeText={setEndHH}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="07"
          />
          <Body strong>:</Body>
          <TextInput
            style={timeInputStyle}
            value={endMM}
            onChangeText={setEndMM}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="00"
          />
        </View>
      </Card>

      <Body muted>
        Notifications about anomaly alerts and bump requests will still come through.
      </Body>

      {errorCode ? (
        <Body style={{ color: theme.colors.debit }}>Couldn&apos;t save: {errorCode}</Body>
      ) : null}

      <Button
        label="SAVE"
        onPress={onSave}
        loading={saving}
        disabled={!valid || saving}
        fullWidth
      />
    </Screen>
  );
}
