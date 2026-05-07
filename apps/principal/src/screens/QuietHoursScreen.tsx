import type { QuietHours } from '@amana/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
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

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Quiet hours' });
  }, [navigation]);

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

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>Quiet hours</Text>
        <Switch value={enabled} onValueChange={setEnabled} />
      </View>

      <View style={styles.timeBlock}>
        <Text style={styles.subLabel}>Start</Text>
        <View style={styles.timeRow}>
          <TextInput
            style={styles.timeInput}
            value={startHH}
            onChangeText={setStartHH}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="22"
          />
          <Text style={styles.colon}>:</Text>
          <TextInput
            style={styles.timeInput}
            value={startMM}
            onChangeText={setStartMM}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="00"
          />
        </View>
      </View>

      <View style={styles.timeBlock}>
        <Text style={styles.subLabel}>End</Text>
        <View style={styles.timeRow}>
          <TextInput
            style={styles.timeInput}
            value={endHH}
            onChangeText={setEndHH}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="07"
          />
          <Text style={styles.colon}>:</Text>
          <TextInput
            style={styles.timeInput}
            value={endMM}
            onChangeText={setEndMM}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="00"
          />
        </View>
      </View>

      <Text style={styles.help}>
        Notifications about anomaly alerts and bump requests will still come through.
      </Text>

      {errorCode && <Text style={styles.err}>Couldn&apos;t save: {errorCode}</Text>}

      <Pressable
        style={[styles.button, (!valid || saving) && styles.buttonDisabled]}
        onPress={onSave}
        disabled={!valid || saving}
      >
        <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 16, fontWeight: '600' },
  subLabel: { color: '#666', fontSize: 13, marginBottom: 6 },
  timeBlock: { gap: 4 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bbb',
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    width: 60,
    textAlign: 'center',
  },
  colon: { fontSize: 20, fontWeight: '600' },
  help: { color: '#666', fontSize: 13 },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#222',
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
});
