import { SPEND_CATEGORIES, WEEKDAYS } from '@amana/types';
import type { RuleInput } from '@amana/types';
import {
  Body,
  Button,
  Caption,
  Card,
  Chip,
  Label,
  Screen,
  SectionHeader,
  TextInput as UITextInput,
  useTheme,
} from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'EditRules'>;

const nairaToKobo = (naira: string): string => {
  const [whole = '0', frac = ''] = naira.split('.');
  const fracPad = `${frac}00`.slice(0, 2);
  return `${BigInt(whole) * 100n + BigInt(fracPad || '0')}`;
};

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

/** 0..23 rendered as a 12-hour label, since that is how people describe their day. */
function hourLabel(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

type CategoryMode = 'off' | 'allowlist' | 'blocklist';

export function EditRulesScreen({ navigation, route }: Props): JSX.Element {
  const { subWalletId } = route.params;
  const rules = useSubWalletsStore((s) => s.rulesById[subWalletId]);
  const busy = useSubWalletsStore((s) => s.busy);
  const errorCode = useSubWalletsStore((s) => s.errorCode);
  const refreshRules = useSubWalletsStore((s) => s.refreshRules);
  const publishRules = useSubWalletsStore((s) => s.publishRules);
  const theme = useTheme();

  const [dailyLimitNaira, setDailyLimitNaira] = useState('');
  const [categoryMode, setCategoryMode] = useState<CategoryMode>('off');
  const [categories, setCategories] = useState<string[]>([]);
  const [windowOn, setWindowOn] = useState(false);
  const [startHour, setStartHour] = useState(6);
  const [endHour, setEndHour] = useState(20);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    void refreshRules(subWalletId);
  }, [subWalletId, refreshRules]);

  // Seed the form from whatever is currently published, so opening the editor shows the live
  // rules rather than defaults the parent never chose.
  useEffect(() => {
    if (!rules) return;
    const limit = rules.rules.find((r) => r.kind === 'limit');
    if (limit) {
      const cfg = limit.configJson as { windowKind?: string; maxKobo?: string | number };
      if (cfg.windowKind === 'daily' && cfg.maxKobo) {
        setDailyLimitNaira((BigInt(String(cfg.maxKobo)) / 100n).toString());
      }
    }
    const category = rules.rules.find((r) => r.kind === 'category');
    if (category) {
      const cfg = category.configJson as { mode?: CategoryMode; categories?: string[] };
      if (cfg.mode === 'allowlist' || cfg.mode === 'blocklist') setCategoryMode(cfg.mode);
      setCategories(cfg.categories ?? []);
    }
    const window = rules.rules.find((r) => r.kind === 'time_window');
    if (window) {
      const cfg = window.configJson as {
        startHour?: number;
        endHour?: number;
        daysOfWeek?: number[];
      };
      setWindowOn(true);
      if (typeof cfg.startHour === 'number') setStartHour(cfg.startHour);
      if (typeof cfg.endHour === 'number') setEndHour(cfg.endHour);
      if (cfg.daysOfWeek?.length) setDays(cfg.daysOfWeek);
    }
  }, [rules]);

  const toggle = (list: number[], v: number) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b);

  const amountValid = AMOUNT_RE.test(dailyLimitNaira);
  const categoryValid = categoryMode === 'off' || categories.length > 0;
  const daysValid = !windowOn || days.length > 0;
  const canPublish = amountValid && categoryValid && daysValid;

  // Publishing replaces the whole active rule set (the server versions it), so every rule the
  // parent still wants has to be included — not just the one they touched.
  const nextRules = useMemo((): RuleInput[] => {
    const out: RuleInput[] = [
      {
        kind: 'limit',
        priority: 10,
        config: { windowKind: 'daily', maxKobo: amountValid ? nairaToKobo(dailyLimitNaira) : '0' },
      },
    ];
    if (categoryMode !== 'off' && categories.length > 0) {
      out.push({ kind: 'category', priority: 20, config: { mode: categoryMode, categories } });
    }
    if (windowOn && days.length > 0) {
      out.push({
        kind: 'time_window',
        priority: 30,
        config: { startHour, endHour, daysOfWeek: days },
      });
    }
    return out;
  }, [amountValid, dailyLimitNaira, categoryMode, categories, windowOn, days, startHour, endHour]);

  const onSubmit = async () => {
    setTouched(true);
    if (!canPublish) return;
    try {
      await publishRules(subWalletId, nextRules);
      navigation.goBack();
    } catch {
      // errorCode is set on the store; the screen re-renders with it.
    }
  };

  // Three chips do not fit one line on a 390pt screen, so they share the row when they can
  // and wrap when they cannot, rather than the last one being clipped off the card.
  const modeButton = (mode: CategoryMode, label: string) => (
    <Chip
      key={mode}
      label={label}
      selected={categoryMode === mode}
      tone={mode === 'blocklist' ? 'debit' : 'accent'}
      onPress={() => setCategoryMode(mode)}
      style={{ flexGrow: 1, flexShrink: 1, flexBasis: 96 }}
    />
  );

  return (
    <Screen title="Spending rules" keyboardAvoiding scrollable>
      <Body muted>
        Rules are checked on every payment before any money moves. Anything over the limit or
        outside these rules asks you for approval instead of being silently blocked.
      </Body>

      {/* ── Daily limit ─────────────────────────────────────────────── */}
      <SectionHeader title="DAILY LIMIT" />
      <Card style={{ gap: 8 }}>
        <UITextInput
          label="AMOUNT (₦)"
          keyboardType="numeric"
          value={dailyLimitNaira}
          onChangeText={setDailyLimitNaira}
          placeholder="20000"
          error={touched && !amountValid ? 'e.g. 20000 or 20000.00' : undefined}
        />
        <Caption>Spend above this in 24 hours triggers a request to you.</Caption>
      </Card>

      {/* ── Category lock ───────────────────────────────────────────── */}
      <SectionHeader title="CATEGORY LOCK" />
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {modeButton('off', 'Any')}
          {modeButton('allowlist', 'Only these')}
          {modeButton('blocklist', 'Block these')}
        </View>

        {categoryMode !== 'off' && (
          <>
            <Caption>
              {categoryMode === 'allowlist'
                ? 'Payments must be tagged with one of these.'
                : 'Payments tagged with these are refused.'}
            </Caption>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SPEND_CATEGORIES.map((c) => (
                <Chip
                  key={c.value}
                  label={c.label}
                  selected={categories.includes(c.value)}
                  tone={categoryMode === 'blocklist' ? 'debit' : 'accent'}
                  onPress={() =>
                    setCategories((prev) =>
                      prev.includes(c.value)
                        ? prev.filter((x) => x !== c.value)
                        : [...prev, c.value],
                    )
                  }
                />
              ))}
            </View>
            {touched && !categoryValid && (
              <Body style={{ color: theme.colors.debit }}>Pick at least one category.</Body>
            )}
          </>
        )}
      </Card>

      {/* ── Time window ─────────────────────────────────────────────── */}
      <SectionHeader title="TIME WINDOW" />
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip
            label="Any time"
            selected={!windowOn}
            onPress={() => setWindowOn(false)}
            style={{ flexGrow: 1 }}
          />
          <Chip
            label="Only these hours"
            selected={windowOn}
            onPress={() => setWindowOn(true)}
            style={{ flexGrow: 1 }}
          />
        </View>

        {windowOn && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <HourPicker label="FROM" value={startHour} onChange={setStartHour} />
              <HourPicker label="UNTIL" value={endHour} onChange={setEndHour} />
            </View>
            <Caption>
              {startHour === endHour
                ? 'Start and end are the same — pick different hours.'
                : `Allowed ${hourLabel(startHour)} to ${hourLabel(endHour)}, Lagos time${
                    startHour > endHour ? ', overnight' : ''
                  }.`}
            </Caption>

            <Label>DAYS</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {WEEKDAYS.map((d) => (
                <Chip
                  key={d.value}
                  label={d.label}
                  selected={days.includes(d.value)}
                  onPress={() => setDays((prev) => toggle(prev, d.value))}
                />
              ))}
            </View>
            {touched && !daysValid && (
              <Body style={{ color: theme.colors.debit }}>Pick at least one day.</Body>
            )}
          </>
        )}
      </Card>

      {errorCode ? <Body style={{ color: theme.colors.debit }}>Server: {errorCode}</Body> : null}

      <Button
        label="PUBLISH RULES"
        onPress={() => void onSubmit()}
        loading={busy}
        disabled={busy}
      />
    </Screen>
  );
}

/** Hour stepper. A full time picker is overkill for a whole-hour window. */
function HourPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (h: number) => void;
}): JSX.Element {
  const theme = useTheme();
  const step = (delta: number) => onChange((value + delta + 24) % 24);

  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Label>{label}</Label>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 12,
          paddingHorizontal: 8,
          height: 48,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} earlier`}
          onPress={() => step(-1)}
          hitSlop={8}
          style={{ padding: 8 }}
        >
          <Body style={{ color: theme.colors.accent }}>−</Body>
        </Pressable>
        <Body strong>{hourLabel(value)}</Body>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} later`}
          onPress={() => step(1)}
          hitSlop={8}
          style={{ padding: 8 }}
        >
          <Body style={{ color: theme.colors.accent }}>+</Body>
        </Pressable>
      </View>
    </View>
  );
}
