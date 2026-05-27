# Brand & UI Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@amana/ui` shared component library (21 components, Midnight palette, Coin Seal brand) and migrate all 41 screens across Agent and Principal apps to use it.

**Architecture:** `packages/ui` is a pure TypeScript source package resolved directly by Metro (no build step — same pattern as `@amana/types`). `ThemeProvider` reads the `Appearance` API for dark/light. `Screen` component renders its own Georgia header and replaces React Navigation's built-in header (`headerShown: false` on all navigators).

**Tech Stack:** Expo SDK 51, React Native 0.74.5, react-navigation v6, react-native-svg v15.2.0, expo-font, @expo-google-fonts/plus-jakarta-sans, react-native-safe-area-context, sharp (icon generation)

---

## File Map

### Created
- `packages/ui/package.json`
- `packages/ui/tsconfig.json`
- `packages/ui/src/index.ts`
- `packages/ui/src/theme/tokens.ts`
- `packages/ui/src/theme/ThemeContext.tsx`
- `packages/ui/src/theme/ThemeProvider.tsx`
- `packages/ui/src/typography/AmountText.tsx`
- `packages/ui/src/typography/Heading.tsx`
- `packages/ui/src/typography/Label.tsx`
- `packages/ui/src/typography/Body.tsx`
- `packages/ui/src/typography/Caption.tsx`
- `packages/ui/src/layout/Screen.tsx`
- `packages/ui/src/layout/Card.tsx`
- `packages/ui/src/layout/Divider.tsx`
- `packages/ui/src/controls/Button.tsx`
- `packages/ui/src/controls/IconButton.tsx`
- `packages/ui/src/controls/TextInput.tsx`
- `packages/ui/src/data/BalanceCard.tsx`
- `packages/ui/src/data/TransactionRow.tsx`
- `packages/ui/src/data/SectionHeader.tsx`
- `packages/ui/src/feedback/Badge.tsx`
- `packages/ui/src/feedback/Skeleton.tsx`
- `packages/ui/src/brand/CoinSealMark.tsx`
- `packages/ui/src/brand/CoinSealWordmark.tsx`

### Modified
- `apps/agent/package.json`
- `apps/principal/package.json`
- `apps/agent/App.tsx`
- `apps/principal/App.tsx`
- `apps/agent/src/nav/MainTabs.tsx`
- `apps/agent/src/nav/AuthStack.tsx`
- `apps/agent/src/nav/PayStack.tsx`
- `apps/principal/src/nav/MainStack.tsx`
- `apps/principal/src/nav/RootNavigator.tsx` (if headerShown missing)
- `scripts/generate-icons.mjs`
- All 41 screen files (see tasks 12–25)

---

### Task 1: `packages/ui` scaffold + workspace registration

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`

- [ ] **Step 1: Create `packages/ui/package.json`**

```json
{
  "name": "@amana/ui",
  "version": "0.0.1",
  "description": "Amana shared UI component library",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {},
  "peerDependencies": {
    "react": "*",
    "react-native": "*",
    "react-native-svg": ">=13"
  }
}
```

- [ ] **Step 2: Create `packages/ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {}
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/ui/src/index.ts` (empty barrel — filled in later tasks)**

```typescript
// barrel — exports added per task
```

- [ ] **Step 4: Run `pnpm install` from the repo root**

```bash
pnpm install
```

Expected: `node_modules/@amana/ui` is a symlink to `packages/ui`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): scaffold @amana/ui package"
```

---

### Task 2: Theme tokens + ThemeContext + ThemeProvider

**Files:**
- Create: `packages/ui/src/theme/tokens.ts`
- Create: `packages/ui/src/theme/ThemeContext.tsx`
- Create: `packages/ui/src/theme/ThemeProvider.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create `packages/ui/src/theme/tokens.ts`**

```typescript
export const darkColors = {
  bg: { base: '#0D1B2A', surface: '#152535', raised: '#1C3147' },
  text: { primary: '#F5F0E8', secondary: '#8BA3B8', muted: '#5A8CA8' },
  accent: '#C9A227',
  accentDim: 'rgba(201,162,39,0.18)',
  debit: '#FF6B6B',
  credit: '#52C49A',
  border: 'rgba(255,255,255,0.06)',
  borderAccent: 'rgba(201,162,39,0.18)',
} as const;

export const lightColors = {
  bg: { base: '#F5F0E8', surface: '#FFFFFF', raised: '#EDE8DF' },
  text: { primary: '#0D1B2A', secondary: '#8B9AAA', muted: '#A0ADB8' },
  accent: '#C9A227',
  accentDim: 'rgba(201,162,39,0.15)',
  debit: '#C0392B',
  credit: '#2E8B57',
  border: 'rgba(0,0,0,0.06)',
  borderAccent: 'rgba(201,162,39,0.25)',
} as const;

export type Colors = typeof darkColors;

export const typeScale = {
  amount: {
    xl: { fontFamily: 'Georgia', fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
    lg: { fontFamily: 'Georgia', fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.5 },
    md: { fontFamily: 'Georgia', fontSize: 18, fontWeight: '700' as const },
    sm: { fontFamily: 'Georgia', fontSize: 14, fontWeight: '700' as const },
  },
  heading: {
    lg: { fontFamily: 'Georgia', fontSize: 20, fontWeight: '700' as const },
    md: { fontFamily: 'Georgia', fontSize: 16, fontWeight: '700' as const },
  },
  label: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 10,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.5,
  },
  body: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, fontWeight: '400' as const },
  bodyStrong: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, fontWeight: '600' as const },
  caption: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, fontWeight: '400' as const },
  button: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 13,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
} as const;

export type TypeScale = typeof typeScale;

export const spacing = {
  hairline: 4,
  tight: 8,
  related: 12,
  cardV: 16,
  screenH: 20,
  section: 24,
  major: 32,
  safeBottom: 48,
} as const;
```

- [ ] **Step 2: Create `packages/ui/src/theme/ThemeContext.tsx`**

```typescript
import { createContext, useContext } from 'react';
import { darkColors, typeScale } from './tokens';
import type { Colors, TypeScale } from './tokens';

export type Theme = {
  colors: Colors;
  type: TypeScale;
  isDark: boolean;
};

export const ThemeContext = createContext<Theme>({
  colors: darkColors,
  type: typeScale,
  isDark: true,
});

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
```

- [ ] **Step 3: Create `packages/ui/src/theme/ThemeProvider.tsx`**

```typescript
import { type ReactNode, useEffect, useState } from 'react';
import { Appearance, View } from 'react-native';
import { ThemeContext } from './ThemeContext';
import { darkColors, lightColors, typeScale } from './tokens';

type Props = {
  children: ReactNode;
  fontsLoaded?: boolean;
};

export function ThemeProvider({ children, fontsLoaded = true }: Props) {
  const [isDark, setIsDark] = useState(
    (Appearance.getColorScheme() ?? 'light') === 'dark',
  );

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setIsDark((colorScheme ?? 'light') === 'dark');
    });
    return () => sub.remove();
  }, []);

  const colors = isDark ? darkColors : lightColors;

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg.base }} />;
  }

  return (
    <ThemeContext.Provider value={{ colors, type: typeScale, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

- [ ] **Step 4: Update `packages/ui/src/index.ts`**

```typescript
export { ThemeProvider } from './theme/ThemeProvider';
export { useTheme } from './theme/ThemeContext';
export type { Theme } from './theme/ThemeContext';
export type { Colors } from './theme/tokens';
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/theme/ packages/ui/src/index.ts
git commit -m "feat(ui): theme tokens, ThemeContext, ThemeProvider"
```

---

### Task 3: Typography components

**Files:**
- Create: `packages/ui/src/typography/AmountText.tsx`
- Create: `packages/ui/src/typography/Heading.tsx`
- Create: `packages/ui/src/typography/Label.tsx`
- Create: `packages/ui/src/typography/Body.tsx`
- Create: `packages/ui/src/typography/Caption.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create `packages/ui/src/typography/AmountText.tsx`**

```typescript
import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  size: 'xl' | 'lg' | 'md' | 'sm';
  value: string;
  sentiment?: 'debit' | 'credit' | 'neutral';
  style?: TextStyle;
};

export function AmountText({ size, value, sentiment = 'neutral', style }: Props) {
  const theme = useTheme();
  const color =
    sentiment === 'debit'
      ? theme.colors.debit
      : sentiment === 'credit'
        ? theme.colors.credit
        : theme.colors.text.primary;

  return (
    <Text style={[theme.type.amount[size], { color }, style]}>{value}</Text>
  );
}
```

- [ ] **Step 2: Create `packages/ui/src/typography/Heading.tsx`**

```typescript
import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  size?: 'lg' | 'md';
  children: string;
  style?: TextStyle;
};

export function Heading({ size = 'lg', children, style }: Props) {
  const theme = useTheme();
  return (
    <Text style={[theme.type.heading[size], { color: theme.colors.text.primary }, style]}>
      {children}
    </Text>
  );
}
```

- [ ] **Step 3: Create `packages/ui/src/typography/Label.tsx`**

```typescript
import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  children: string;
  style?: TextStyle;
};

export function Label({ children, style }: Props) {
  const theme = useTheme();
  return (
    <Text style={[theme.type.label, { color: theme.colors.text.secondary }, style]}>
      {children}
    </Text>
  );
}
```

- [ ] **Step 4: Create `packages/ui/src/typography/Body.tsx`**

```typescript
import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  strong?: boolean;
  children: string | string[];
  style?: TextStyle;
  muted?: boolean;
};

export function Body({ strong = false, children, style, muted = false }: Props) {
  const theme = useTheme();
  const ts = strong ? theme.type.bodyStrong : theme.type.body;
  const color = muted ? theme.colors.text.muted : theme.colors.text.primary;
  return <Text style={[ts, { color }, style]}>{children}</Text>;
}
```

- [ ] **Step 5: Create `packages/ui/src/typography/Caption.tsx`**

```typescript
import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  children: string;
  style?: TextStyle;
};

export function Caption({ children, style }: Props) {
  const theme = useTheme();
  return (
    <Text style={[theme.type.caption, { color: theme.colors.text.muted }, style]}>
      {children}
    </Text>
  );
}
```

- [ ] **Step 6: Update `packages/ui/src/index.ts`**

```typescript
export { ThemeProvider } from './theme/ThemeProvider';
export { useTheme } from './theme/ThemeContext';
export type { Theme } from './theme/ThemeContext';
export type { Colors } from './theme/tokens';

export { AmountText } from './typography/AmountText';
export { Heading } from './typography/Heading';
export { Label } from './typography/Label';
export { Body } from './typography/Body';
export { Caption } from './typography/Caption';
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/typography/ packages/ui/src/index.ts
git commit -m "feat(ui): typography components — AmountText, Heading, Label, Body, Caption"
```

---

### Task 4: Layout components — Screen, Card, Divider

**Files:**
- Create: `packages/ui/src/layout/Screen.tsx`
- Create: `packages/ui/src/layout/Card.tsx`
- Create: `packages/ui/src/layout/Divider.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create `packages/ui/src/layout/Screen.tsx`**

```typescript
import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  title?: string;
  headerRight?: ReactNode;
  headerLeft?: ReactNode;
  scrollable?: boolean;
  noPadding?: boolean;
  keyboardAvoiding?: boolean;
  children: ReactNode;
  style?: ViewStyle;
};

export function Screen({
  title,
  headerRight,
  headerLeft,
  scrollable = false,
  noPadding = false,
  keyboardAvoiding = false,
  children,
  style,
}: Props) {
  const theme = useTheme();

  const header =
    title || headerRight || headerLeft ? (
      <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
        <View style={styles.headerSide}>{headerLeft ?? null}</View>
        {title ? (
          <Text
            style={[theme.type.heading.lg, { color: theme.colors.text.primary }]}
            numberOfLines={1}
          >
            {title}
          </Text>
        ) : (
          <View />
        )}
        <View style={styles.headerSide}>{headerRight ?? null}</View>
      </View>
    ) : null;

  const contentStyle: ViewStyle = noPadding
    ? { flex: 1 }
    : { flex: 1, paddingHorizontal: 20, paddingBottom: 48 };

  const body = scrollable ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={noPadding ? undefined : { paddingHorizontal: 20, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[contentStyle, style]}>{children}</View>
  );

  const inner = (
    <SafeAreaView style={[{ flex: 1, backgroundColor: theme.colors.bg.base }]}>
      {header}
      {body}
    </SafeAreaView>
  );

  if (keyboardAvoiding) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {inner}
      </KeyboardAvoidingView>
    );
  }

  return inner;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: {
    minWidth: 40,
    alignItems: 'center',
  },
});
```

- [ ] **Step 2: Create `packages/ui/src/layout/Card.tsx`**

```typescript
import { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  accent?: boolean;
  children: ReactNode;
  style?: ViewStyle;
};

export function Card({ accent = false, children, style }: Props) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.bg.surface,
          borderRadius: 16,
          paddingVertical: 16,
          paddingHorizontal: 20,
          borderWidth: 1,
          borderColor: accent ? theme.colors.borderAccent : theme.colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
```

- [ ] **Step 3: Create `packages/ui/src/layout/Divider.tsx`**

```typescript
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function Divider() {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.divider,
        { backgroundColor: theme.colors.border },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
});
```

- [ ] **Step 4: Update `packages/ui/src/index.ts`**

```typescript
export { ThemeProvider } from './theme/ThemeProvider';
export { useTheme } from './theme/ThemeContext';
export type { Theme } from './theme/ThemeContext';
export type { Colors } from './theme/tokens';

export { AmountText } from './typography/AmountText';
export { Heading } from './typography/Heading';
export { Label } from './typography/Label';
export { Body } from './typography/Body';
export { Caption } from './typography/Caption';

export { Screen } from './layout/Screen';
export { Card } from './layout/Card';
export { Divider } from './layout/Divider';
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/layout/ packages/ui/src/index.ts
git commit -m "feat(ui): layout components — Screen, Card, Divider"
```

---

### Task 5: Controls — Button, IconButton, TextInput

**Files:**
- Create: `packages/ui/src/controls/Button.tsx`
- Create: `packages/ui/src/controls/IconButton.tsx`
- Create: `packages/ui/src/controls/TextInput.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create `packages/ui/src/controls/Button.tsx`**

```typescript
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  variant?: 'primary' | 'secondary' | 'ghost';
  onPress: () => void;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
};

export function Button({
  variant = 'primary',
  onPress,
  label,
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
}: Props) {
  const theme = useTheme();

  const bg =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'secondary'
        ? theme.colors.bg.surface
        : 'transparent';

  const textColor =
    variant === 'primary'
      ? '#0D1B2A'
      : variant === 'secondary'
        ? theme.colors.text.primary
        : theme.colors.accent;

  const borderColor =
    variant === 'secondary' ? theme.colors.border : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor,
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[theme.type.button, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
```

- [ ] **Step 2: Create `packages/ui/src/controls/IconButton.tsx`**

```typescript
import { type ReactNode } from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  onPress: () => void;
  children: ReactNode;
  style?: ViewStyle;
};

export function IconButton({ onPress, children, style }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          padding: 8,
          borderRadius: 8,
          backgroundColor: pressed ? theme.colors.accentDim : 'transparent',
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
```

- [ ] **Step 3: Create `packages/ui/src/controls/TextInput.tsx`**

```typescript
import {
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = TextInputProps & {
  label?: string;
  error?: string;
};

export function TextInput({ label, error, style, ...rest }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text style={[theme.type.label, { color: theme.colors.text.secondary, marginBottom: 6 }]}>
          {label}
        </Text>
      ) : null}
      <RNTextInput
        placeholderTextColor={theme.colors.text.muted}
        style={[
          theme.type.body,
          {
            color: theme.colors.text.primary,
            backgroundColor: theme.colors.bg.surface,
            borderWidth: 1,
            borderColor: error ? theme.colors.debit : theme.colors.border,
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
            height: 48,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[theme.type.caption, { color: theme.colors.debit, marginTop: 4 }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 12 },
});
```

- [ ] **Step 4: Update `packages/ui/src/index.ts`**

```typescript
export { ThemeProvider } from './theme/ThemeProvider';
export { useTheme } from './theme/ThemeContext';
export type { Theme } from './theme/ThemeContext';
export type { Colors } from './theme/tokens';

export { AmountText } from './typography/AmountText';
export { Heading } from './typography/Heading';
export { Label } from './typography/Label';
export { Body } from './typography/Body';
export { Caption } from './typography/Caption';

export { Screen } from './layout/Screen';
export { Card } from './layout/Card';
export { Divider } from './layout/Divider';

export { Button } from './controls/Button';
export { IconButton } from './controls/IconButton';
export { TextInput } from './controls/TextInput';
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/controls/ packages/ui/src/index.ts
git commit -m "feat(ui): controls — Button, IconButton, TextInput"
```

---

### Task 6: Data components — BalanceCard, TransactionRow, SectionHeader

**Files:**
- Create: `packages/ui/src/data/BalanceCard.tsx`
- Create: `packages/ui/src/data/TransactionRow.tsx`
- Create: `packages/ui/src/data/SectionHeader.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create `packages/ui/src/data/BalanceCard.tsx`**

```typescript
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Card } from '../layout/Card';
import { AmountText } from '../typography/AmountText';
import { Label } from '../typography/Label';
import { Caption } from '../typography/Caption';

type Props = {
  label: string;
  amount: string;
  trend?: string;
  trendSentiment?: 'positive' | 'negative';
};

export function BalanceCard({ label, amount, trend, trendSentiment }: Props) {
  const theme = useTheme();
  const trendColor =
    trendSentiment === 'positive'
      ? theme.colors.credit
      : trendSentiment === 'negative'
        ? theme.colors.debit
        : theme.colors.text.muted;

  return (
    <Card accent>
      <Label>{label}</Label>
      <AmountText size="xl" value={amount} style={{ marginTop: 4, marginBottom: 4 }} />
      {trend ? <Caption style={{ color: trendColor }}>{trend}</Caption> : null}
    </Card>
  );
}
```

- [ ] **Step 2: Create `packages/ui/src/data/TransactionRow.tsx`**

```typescript
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { AmountText } from '../typography/AmountText';
import { Body } from '../typography/Body';
import { Caption } from '../typography/Caption';

type Props = {
  merchant: string;
  timestamp: string;
  amount: string;
  sentiment: 'debit' | 'credit';
  onPress?: () => void;
};

export function TransactionRow({ merchant, timestamp, amount, sentiment, onPress }: Props) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 20,
        backgroundColor: pressed ? theme.colors.bg.raised : 'transparent',
      })}
    >
      <View style={{ flex: 1, marginRight: 8 }}>
        <Body strong>{merchant}</Body>
        <Caption>{timestamp}</Caption>
      </View>
      <AmountText size="sm" value={amount} sentiment={sentiment} />
    </Pressable>
  );
}
```

- [ ] **Step 3: Create `packages/ui/src/data/SectionHeader.tsx`**

```typescript
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Label } from '../typography/Label';

type Props = {
  title: string;
};

export function SectionHeader({ title }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 8,
        backgroundColor: theme.colors.bg.base,
      }}
    >
      <Label>{title}</Label>
    </View>
  );
}
```

- [ ] **Step 4: Update `packages/ui/src/index.ts`**

```typescript
export { ThemeProvider } from './theme/ThemeProvider';
export { useTheme } from './theme/ThemeContext';
export type { Theme } from './theme/ThemeContext';
export type { Colors } from './theme/tokens';

export { AmountText } from './typography/AmountText';
export { Heading } from './typography/Heading';
export { Label } from './typography/Label';
export { Body } from './typography/Body';
export { Caption } from './typography/Caption';

export { Screen } from './layout/Screen';
export { Card } from './layout/Card';
export { Divider } from './layout/Divider';

export { Button } from './controls/Button';
export { IconButton } from './controls/IconButton';
export { TextInput } from './controls/TextInput';

export { BalanceCard } from './data/BalanceCard';
export { TransactionRow } from './data/TransactionRow';
export { SectionHeader } from './data/SectionHeader';
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/data/ packages/ui/src/index.ts
git commit -m "feat(ui): data components — BalanceCard, TransactionRow, SectionHeader"
```

---

### Task 7: Feedback components — Badge, Skeleton

**Files:**
- Create: `packages/ui/src/feedback/Badge.tsx`
- Create: `packages/ui/src/feedback/Skeleton.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create `packages/ui/src/feedback/Badge.tsx`**

```typescript
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  count?: number;
  variant?: 'success' | 'error' | 'warning' | 'neutral';
  label?: string;
};

export function Badge({ count, variant = 'neutral', label }: Props) {
  const theme = useTheme();

  const bg =
    variant === 'success'
      ? theme.colors.credit
      : variant === 'error'
        ? theme.colors.debit
        : variant === 'warning'
          ? theme.colors.accent
          : theme.colors.bg.raised;

  const textColor =
    variant === 'warning' ? '#0D1B2A' : theme.colors.text.primary;

  const text = count !== undefined ? String(count) : label ?? '';

  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={[
          theme.type.caption,
          { color: textColor, fontFamily: 'PlusJakartaSans_700Bold' },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}
```

- [ ] **Step 2: Create `packages/ui/src/feedback/Skeleton.tsx`**

```typescript
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
};

export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: Props) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as number,
          height,
          borderRadius,
          backgroundColor: theme.colors.bg.raised,
          opacity,
        },
        style,
      ]}
    />
  );
}
```

- [ ] **Step 3: Update `packages/ui/src/index.ts`**

```typescript
export { ThemeProvider } from './theme/ThemeProvider';
export { useTheme } from './theme/ThemeContext';
export type { Theme } from './theme/ThemeContext';
export type { Colors } from './theme/tokens';

export { AmountText } from './typography/AmountText';
export { Heading } from './typography/Heading';
export { Label } from './typography/Label';
export { Body } from './typography/Body';
export { Caption } from './typography/Caption';

export { Screen } from './layout/Screen';
export { Card } from './layout/Card';
export { Divider } from './layout/Divider';

export { Button } from './controls/Button';
export { IconButton } from './controls/IconButton';
export { TextInput } from './controls/TextInput';

export { BalanceCard } from './data/BalanceCard';
export { TransactionRow } from './data/TransactionRow';
export { SectionHeader } from './data/SectionHeader';

export { Badge } from './feedback/Badge';
export { Skeleton } from './feedback/Skeleton';
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/feedback/ packages/ui/src/index.ts
git commit -m "feat(ui): feedback components — Badge, Skeleton"
```

---

### Task 8: Brand components — CoinSealMark, CoinSealWordmark

**Files:**
- Create: `packages/ui/src/brand/CoinSealMark.tsx`
- Create: `packages/ui/src/brand/CoinSealWordmark.tsx`
- Modify: `packages/ui/src/index.ts`

The Coin Seal is a hexagonal bullion coin with 4 SVG layers in a 100×100 viewBox (pointy-top orientation):
1. Outer gold hexagon fill (R=47, acts as thick gold rim)
2. Navy body hexagon fill (R=40, sits on top of gold rim)
3. Inner gold ring stroke (hexagon at R=33)
4. Centred 8-pointed khatam star (two overlapping squares)

- [ ] **Step 1: Create `packages/ui/src/brand/CoinSealMark.tsx`**

```typescript
import { G, Polygon, Svg } from 'react-native-svg';

const OUTER_HEX = '50,3 90.7,26.5 90.7,73.5 50,97 9.3,73.5 9.3,26.5';
const BODY_HEX = '50,10 84.6,30 84.6,70 50,90 15.4,70 15.4,30';
const INNER_RING = '50,17 78.6,33.5 78.6,66.5 50,83 21.4,66.5 21.4,33.5';
const KHATAM =
  '50,38 51.91,45.38 58.49,41.51 54.62,48.09 62,50 54.62,51.91 58.49,58.49 51.91,54.62 50,62 48.09,54.62 41.51,58.49 45.38,51.91 38,50 45.38,48.09 41.51,41.51 48.09,45.38';

type Variant = 'default' | 'agent' | 'principal' | 'mono-light' | 'mono-white';

const VARIANT_COLORS: Record<Variant, { rim: string; body: string }> = {
  default: { rim: '#C9A227', body: '#0D1B2A' },
  agent: { rim: '#2563EB', body: '#0D1B2A' },
  principal: { rim: '#D97706', body: '#0D1B2A' },
  'mono-light': { rim: '#0D1B2A', body: 'transparent' },
  'mono-white': { rim: '#FFFFFF', body: 'transparent' },
};

type Props = {
  size: number;
  variant?: Variant;
};

export function CoinSealMark({ size, variant = 'default' }: Props) {
  const { rim, body } = VARIANT_COLORS[variant];
  const isTransparent = body === 'transparent';

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Layer 1: outer rim (thick gold hexagon) */}
      <Polygon points={OUTER_HEX} fill={rim} />
      {/* Layer 2: navy body (sits on rim, creates border effect) */}
      {!isTransparent && <Polygon points={BODY_HEX} fill={body} />}
      {/* Layer 3: inner ring stroke */}
      <Polygon points={INNER_RING} fill="none" stroke={rim} strokeWidth="1.5" />
      {/* Layer 4: 8-pointed khatam star */}
      <Polygon points={KHATAM} fill={rim} />
    </Svg>
  );
}
```

- [ ] **Step 2: Create `packages/ui/src/brand/CoinSealWordmark.tsx`**

```typescript
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { CoinSealMark } from './CoinSealMark';

type Props = {
  size?: number;
};

export function CoinSealWordmark({ size = 32 }: Props) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <CoinSealMark size={size} />
      <Text
        style={{
          fontFamily: 'PlusJakartaSans_700Bold',
          fontSize: size * 0.5,
          fontWeight: '700',
          letterSpacing: size * 0.16,
          color: theme.colors.text.primary,
          textTransform: 'uppercase',
        }}
      >
        AMANA
      </Text>
    </View>
  );
}
```

- [ ] **Step 3: Update `packages/ui/src/index.ts` (final state)**

```typescript
export { ThemeProvider } from './theme/ThemeProvider';
export { useTheme } from './theme/ThemeContext';
export type { Theme } from './theme/ThemeContext';
export type { Colors } from './theme/tokens';

export { AmountText } from './typography/AmountText';
export { Heading } from './typography/Heading';
export { Label } from './typography/Label';
export { Body } from './typography/Body';
export { Caption } from './typography/Caption';

export { Screen } from './layout/Screen';
export { Card } from './layout/Card';
export { Divider } from './layout/Divider';

export { Button } from './controls/Button';
export { IconButton } from './controls/IconButton';
export { TextInput } from './controls/TextInput';

export { BalanceCard } from './data/BalanceCard';
export { TransactionRow } from './data/TransactionRow';
export { SectionHeader } from './data/SectionHeader';

export { Badge } from './feedback/Badge';
export { Skeleton } from './feedback/Skeleton';

export { CoinSealMark } from './brand/CoinSealMark';
export { CoinSealWordmark } from './brand/CoinSealWordmark';
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/brand/ packages/ui/src/index.ts
git commit -m "feat(ui): brand components — CoinSealMark, CoinSealWordmark"
```

---

### Task 9: Font installation + App.tsx wiring (both apps)

**Files:**
- Modify: `apps/agent/package.json`
- Modify: `apps/principal/package.json`
- Modify: `apps/agent/App.tsx`
- Modify: `apps/principal/App.tsx`

- [ ] **Step 1: Add dependencies to `apps/agent/package.json`**

In `apps/agent/package.json`, add to `dependencies`:

```json
"@amana/ui": "workspace:*",
"@expo-google-fonts/plus-jakarta-sans": "^0.2.3",
"expo-font": "~12.0.10",
"react-native-svg": "~15.2.0"
```

- [ ] **Step 2: Add dependencies to `apps/principal/package.json`**

In `apps/principal/package.json`, add to `dependencies`:

```json
"@amana/ui": "workspace:*",
"@expo-google-fonts/plus-jakarta-sans": "^0.2.3",
"expo-font": "~12.0.10"
```

Note: `react-native-svg` is already present in `apps/principal/package.json` at `~15.2.0` — do not add it again.

- [ ] **Step 3: Run `pnpm install`**

```bash
pnpm install
```

Expected: `expo-font` and `@expo-google-fonts/plus-jakarta-sans` resolved in both app node_modules.

- [ ] **Step 4: Replace `apps/agent/App.tsx`**

```typescript
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { Component, type ReactNode, useEffect, useRef } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@amana/ui';
import { deepLinkFor, isBumpKind, setupForegroundListener, setupResponseListener } from './src/lib/push';
import { RootNavigator, navigationRef } from './src/nav/RootNavigator';
import { useAuthStore } from './src/state/auth.store';
import { useBumpsStore } from './src/state/bumps.store';
import { useNotificationsStore } from './src/state/notifications.store';
import { usePushStore } from './src/state/push.store';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error),
    };
  }
  render() {
    if (this.state.error) {
      return (
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
          <Text style={{ color: 'red', fontWeight: '700', marginBottom: 8 }}>CRASH</Text>
          <Text style={{ color: 'red', fontFamily: 'monospace', fontSize: 12 }}>
            {this.state.error}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

function navigateForResponse(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data as Record<string, unknown> | undefined;
  if (!data) return;
  const kind = data.kind;
  if (typeof kind !== 'string') return;
  const link = deepLinkFor(kind as Parameters<typeof deepLinkFor>[0], data);
  if (!navigationRef.isReady()) return;
  if (link.kind === 'bump') {
    navigationRef.navigate('BumpsInbox');
  } else if (link.kind === 'transaction') {
    navigationRef.navigate('TransactionDetail', { transactionId: link.transactionId });
  }
}

export default function App(): JSX.Element {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const authStatus = useAuthStore((s) => s.status);
  const bootstrapPush = usePushStore((s) => s.bootstrap);
  const refreshBumps = useBumpsStore((s) => s.refresh);
  const refreshNotifications = useNotificationsStore((s) => s.refresh);
  const fgSubRef = useRef<Notifications.Subscription | null>(null);
  const responseSubRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    if (authStatus !== 'logged_in') return;
    void bootstrapPush();

    fgSubRef.current = setupForegroundListener((n) => {
      if (useAuthStore.getState().status !== 'logged_in') return;
      const kind = (n.request.content.data as Record<string, unknown> | undefined)?.kind;
      if (isBumpKind(kind)) void refreshBumps();
      else void refreshNotifications();
    });

    responseSubRef.current = setupResponseListener((response) => {
      if (useAuthStore.getState().status !== 'logged_in') return;
      navigateForResponse(response);
    });

    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (!r) return;
      if (useAuthStore.getState().status !== 'logged_in') return;
      navigateForResponse(r);
    });

    return () => {
      fgSubRef.current?.remove();
      responseSubRef.current?.remove();
      fgSubRef.current = null;
      responseSubRef.current = null;
    };
  }, [authStatus, bootstrapPush, refreshBumps, refreshNotifications]);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <ThemeProvider fontsLoaded={fontsLoaded}>
          <RootNavigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 5: Replace `apps/principal/App.tsx`**

```typescript
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { Component, type ReactNode, useEffect, useRef } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@amana/ui';
import {
  deepLinkFor,
  isBumpKind,
  setupForegroundListener,
  setupResponseListener,
} from './src/lib/push';
import { RootNavigator, navigationRef } from './src/nav/RootNavigator';
import { useAuthStore } from './src/state/auth.store';
import { useBumpsStore } from './src/state/bumps.store';
import { useNotificationsStore } from './src/state/notifications.store';
import { usePushStore } from './src/state/push.store';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error),
    };
  }
  render() {
    if (this.state.error) {
      return (
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
          <Text style={{ color: 'red', fontWeight: '700', marginBottom: 8 }}>CRASH</Text>
          <Text style={{ color: 'red', fontFamily: 'monospace', fontSize: 12 }}>
            {this.state.error}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

function navigateForResponse(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data as Record<string, unknown> | undefined;
  if (!data) return;
  const kind = data.kind;
  if (typeof kind !== 'string') return;
  const link = deepLinkFor(kind as Parameters<typeof deepLinkFor>[0], data);
  if (!navigationRef.isReady()) return;
  if (link.kind === 'bump') {
    navigationRef.navigate('BumpsInbox');
  } else if (link.kind === 'transaction') {
    navigationRef.navigate('TransactionDetail', { transactionId: link.transactionId });
  }
}

export default function App(): JSX.Element {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const authStatus = useAuthStore((s) => s.status);
  const bootstrapPush = usePushStore((s) => s.bootstrap);
  const refreshBumps = useBumpsStore((s) => s.refresh);
  const refreshNotifications = useNotificationsStore((s) => s.refresh);
  const fgSubRef = useRef<Notifications.Subscription | null>(null);
  const responseSubRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    if (authStatus !== 'logged_in') return;
    void bootstrapPush();

    fgSubRef.current = setupForegroundListener((n) => {
      if (useAuthStore.getState().status !== 'logged_in') return;
      const kind = (n.request.content.data as Record<string, unknown> | undefined)?.kind;
      if (isBumpKind(kind)) void refreshBumps();
      else void refreshNotifications();
    });

    responseSubRef.current = setupResponseListener((response) => {
      if (useAuthStore.getState().status !== 'logged_in') return;
      navigateForResponse(response);
    });

    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (!r) return;
      if (useAuthStore.getState().status !== 'logged_in') return;
      navigateForResponse(r);
    });

    return () => {
      fgSubRef.current?.remove();
      responseSubRef.current?.remove();
      fgSubRef.current = null;
      responseSubRef.current = null;
    };
  }, [authStatus, bootstrapPush, refreshBumps, refreshNotifications]);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <ThemeProvider fontsLoaded={fontsLoaded}>
          <RootNavigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/agent/package.json apps/principal/package.json apps/agent/App.tsx apps/principal/App.tsx pnpm-lock.yaml
git commit -m "feat(ui): install fonts + wire ThemeProvider into both apps"
```

---

### Task 10: App icon generation — Coin Seal

**Files:**
- Modify: `scripts/generate-icons.mjs`

- [ ] **Step 1: Replace `scripts/generate-icons.mjs`**

Read the current file first (`scripts/generate-icons.mjs`), then replace it entirely with:

```javascript
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Coin Seal SVG — viewBox 0 0 100 100 scaled to target size
function coinSealSvg(size, rimColor = '#C9A227', bodyColor = '#0D1B2A') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    <polygon points="50,3 90.7,26.5 90.7,73.5 50,97 9.3,73.5 9.3,26.5" fill="${rimColor}"/>
    <polygon points="50,10 84.6,30 84.6,70 50,90 15.4,70 15.4,30" fill="${bodyColor}"/>
    <polygon points="50,17 78.6,33.5 78.6,66.5 50,83 21.4,66.5 21.4,33.5" fill="none" stroke="${rimColor}" stroke-width="1.5"/>
    <polygon points="50,38 51.91,45.38 58.49,41.51 54.62,48.09 62,50 54.62,51.91 58.49,58.49 51.91,54.62 50,62 48.09,54.62 41.51,58.49 45.38,51.91 38,50 45.38,48.09 41.51,41.51 48.09,45.38" fill="${rimColor}"/>
  </svg>`;
}

async function generateIcon(outputPath, canvasSize, markSize) {
  const navy = { r: 13, g: 27, b: 42, alpha: 1 };
  const offset = Math.round((canvasSize - markSize) / 2);

  await sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: navy },
  })
    .composite([{
      input: Buffer.from(coinSealSvg(markSize)),
      top: offset,
      left: offset,
    }])
    .png()
    .toFile(outputPath);

  console.log(`✓ ${outputPath}`);
}

async function generateSplash(outputPath, canvasSize, markSize) {
  // Splash uses transparent background + white mark
  const offset = Math.round((canvasSize - markSize) / 2);

  await sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: Buffer.from(coinSealSvg(markSize, '#FFFFFF', 'transparent')),
      top: offset,
      left: offset,
    }])
    .png()
    .toFile(outputPath);

  console.log(`✓ ${outputPath}`);
}

const apps = ['agent', 'principal'];

for (const app of apps) {
  const assets = path.join(root, 'apps', app, 'assets');

  // 1024×1024 app icon — mark at 60% (614px)
  await generateIcon(path.join(assets, 'icon.png'), 1024, 614);

  // 1024×1024 adaptive icon (Android)
  await generateIcon(path.join(assets, 'adaptive-icon.png'), 1024, 614);

  // 512×512 splash icon — transparent bg, white mark at 60% (307px)
  await generateSplash(path.join(assets, 'splash-icon.png'), 512, 307);
}

console.log('All icons generated.');
```

- [ ] **Step 2: Run the script**

```bash
node scripts/generate-icons.mjs
```

Expected output:
```
✓ apps/agent/assets/icon.png
✓ apps/agent/assets/adaptive-icon.png
✓ apps/agent/assets/splash-icon.png
✓ apps/principal/assets/icon.png
✓ apps/principal/assets/adaptive-icon.png
✓ apps/principal/assets/splash-icon.png
All icons generated.
```

If sharp fails with SVG input, install `sharp` with libvips SVG support: `pnpm add -D sharp` at root. The existing `sharp` in root devDependencies should already handle this.

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-icons.mjs apps/agent/assets/icon.png apps/agent/assets/adaptive-icon.png apps/agent/assets/splash-icon.png apps/principal/assets/icon.png apps/principal/assets/adaptive-icon.png apps/principal/assets/splash-icon.png
git commit -m "feat(brand): Coin Seal app icons via generate-icons.mjs"
```

---

### Task 11: Navigation theming — headers + tab bar

**Files:**
- Modify: `apps/agent/src/nav/AuthStack.tsx`
- Modify: `apps/agent/src/nav/PayStack.tsx`
- Modify: `apps/agent/src/nav/MainTabs.tsx`
- Modify: `apps/principal/src/nav/MainStack.tsx`
- Modify: `apps/principal/src/nav/RootNavigator.tsx`

For each navigator: add `screenOptions={{ headerShown: false }}` and remove all per-screen `options={{ title: '...' }}` overrides. For `MainTabs.tsx` also add tab bar theme.

- [ ] **Step 1: Read then update `apps/agent/src/nav/AuthStack.tsx`**

Read the file, then add `screenOptions={{ headerShown: false }}` to the `Stack.Navigator`. Remove any per-screen `options={{ title: '...' }}` that only set a title (screens will render their own header via `<Screen title="...">` after migration).

- [ ] **Step 2: Read then update `apps/agent/src/nav/PayStack.tsx`**

Same: add `screenOptions={{ headerShown: false }}` to `Stack.Navigator`, remove per-screen title options.

- [ ] **Step 3: Replace `apps/agent/src/nav/MainTabs.tsx`**

Read the current file first. The key changes:
1. Remove `options={{ headerShown: true, title: 'Home' }}` from the Home screen.
2. Add `useTheme()` import and tab bar styling to `screenOptions`.

The complete replacement:

```typescript
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme } from '@amana/ui';
import { HomeScreen } from '../screens/HomeScreen';
import { PayStack } from './PayStack';
import { SettingsScreen } from '../screens/SettingsScreen';
// Import any other tab screens that exist in the current file

const Tab = createBottomTabNavigator();

export function MainTabs() {
  const theme = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.bg.surface,
          borderTopWidth: 0,
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 12,
        },
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.text.muted,
        tabBarLabelStyle: {
          fontFamily: 'PlusJakartaSans_600SemiBold',
          fontSize: 10,
          letterSpacing: 0.5,
        },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Pay" component={PayStack} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
```

IMPORTANT: Read the actual current `MainTabs.tsx` to get the exact list of screens and their names before writing the replacement. Preserve all existing `Tab.Screen` entries — only change `screenOptions` and remove the Home header override.

- [ ] **Step 4: Read then update `apps/principal/src/nav/MainStack.tsx`**

Add `screenOptions={{ headerShown: false }}` to `Stack.Navigator`. Remove `options={{ title: '...' }}` from every `Stack.Screen`. The navigator becomes:

```typescript
<Stack.Navigator screenOptions={{ headerShown: false }}>
  <Stack.Screen name="HomeDashboard" component={HomeDashboardScreen} />
  <Stack.Screen name="HouseholdSetup" component={HouseholdSetupScreen} />
  {/* ... all other screens without options={{ title }} */}
</Stack.Navigator>
```

- [ ] **Step 5: Read then update `apps/principal/src/nav/RootNavigator.tsx`**

Same: ensure `Stack.Navigator` (or whatever navigator type is used) has `screenOptions={{ headerShown: false }}`. Read the file first.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/nav/ apps/principal/src/nav/
git commit -m "feat(ui): navigation — headerShown false + tab bar theme"
```

---

### Task 12: Agent auth screens — PhoneScreen, VerifyScreen, AccountEntryScreen

**Files:**
- Modify: `apps/agent/src/screens/PhoneScreen.tsx`
- Modify: `apps/agent/src/screens/VerifyScreen.tsx`
- Modify: `apps/agent/src/screens/AccountEntryScreen.tsx`

Context: These screens are KeyboardAvoidingView-based form screens. After migration they use `<Screen keyboardAvoiding scrollable>` + `<TextInput>` + `<Button>` from `@amana/ui`. All hardcoded `#1a1a2e` / `#ccc` / `#fff` style values are replaced with theme tokens.

- [ ] **Step 1: Migrate `apps/agent/src/screens/PhoneScreen.tsx`**

Read the current file. Apply these changes:
1. Remove all `StyleSheet.create` entries that set colors/backgrounds.
2. Add `import { Screen, TextInput, Button, useTheme, Body, Heading } from '@amana/ui';`
3. Inside the component, add `const theme = useTheme();`
4. Replace the outer `KeyboardAvoidingView + SafeAreaView` wrapper with `<Screen title="Welcome" keyboardAvoiding scrollable>`.
5. Replace the raw `TextInput` with `<TextInput>` from `@amana/ui`, setting `label="Mobile Number"`.
6. Replace the submit `TouchableOpacity`/`Pressable` with `<Button label="SEND CODE" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />`.
7. Replace hardcoded color style values with `theme.colors.*` references.
8. Keep all `react-hook-form` + zod logic unchanged.

- [ ] **Step 2: Migrate `apps/agent/src/screens/VerifyScreen.tsx`**

Read the current file. Same pattern as PhoneScreen:
1. Remove color `StyleSheet` entries.
2. Import `{ Screen, TextInput, Button, useTheme, Body }` from `@amana/ui`.
3. Replace outer wrapper with `<Screen title="Enter Code" keyboardAvoiding scrollable>`.
4. Replace OTP `TextInput` with UI `<TextInput label="Verification Code" keyboardType="number-pad" />`.
5. Replace submit button with `<Button label="VERIFY" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />`.
6. Keep navigation and form logic unchanged.

- [ ] **Step 3: Migrate `apps/agent/src/screens/AccountEntryScreen.tsx`**

Read the current file. This screen has two modes: a bank-picker FlatList and an account-entry form. Changes:
1. Import `{ Screen, TextInput, Button, useTheme, Body, Label, Card }` from `@amana/ui`.
2. Add `const theme = useTheme();`.
3. Replace outer View/SafeAreaView with `<Screen title="Link Account" noPadding>` (noPadding because FlatList needs to manage its own scroll).
4. Replace bank picker items' hardcoded background/text colors with `theme.colors.*`.
5. Replace account number `TextInput` + confirm button with UI components.
6. Keep all API calls and navigation logic unchanged.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/screens/PhoneScreen.tsx apps/agent/src/screens/VerifyScreen.tsx apps/agent/src/screens/AccountEntryScreen.tsx
git commit -m "feat(ui): migrate agent auth screens to @amana/ui"
```

---

### Task 13: Agent home + transaction screens — HomeScreen, TransactionListScreen, TransactionDetailScreen

**Files:**
- Modify: `apps/agent/src/screens/HomeScreen.tsx`
- Modify: `apps/agent/src/screens/TransactionListScreen.tsx`
- Modify: `apps/agent/src/screens/TransactionDetailScreen.tsx`

- [ ] **Step 1: Migrate `apps/agent/src/screens/HomeScreen.tsx`**

Read the current file. Changes:
1. Import `{ Screen, BalanceCard, TransactionRow, SectionHeader, Badge, useTheme, Body, Heading }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Amana" noPadding>` (contains a FlatList).
3. Replace the balance/wallet name card with `<BalanceCard label="WALLET" amount={walletName} />` or similar based on what data is displayed.
4. Replace pending bump indicator with `<Badge count={pendingCount} variant="warning" />`.
5. Replace transaction list items with `<TransactionRow>`.
6. Replace hardcoded `#1a1a2e` background with `theme.colors.bg.base`.
7. Keep all store selectors and navigation calls unchanged.

- [ ] **Step 2: Migrate `apps/agent/src/screens/TransactionListScreen.tsx`**

Read the current file. This screen returns a FlatList at the top level. Changes:
1. Import `{ Screen, TransactionRow, SectionHeader, useTheme }` from `@amana/ui`.
2. Wrap the FlatList in `<Screen title="Transactions" noPadding>`.
3. Replace `renderItem` with `<TransactionRow>` component.
4. Replace section headers with `<SectionHeader title={section} />`.
5. Replace hardcoded status badge colors with `variant` prop on `<Badge>`.
6. Keep pagination logic unchanged.

- [ ] **Step 3: Migrate `apps/agent/src/screens/TransactionDetailScreen.tsx`**

Read the current file. This is a ScrollView screen. Changes:
1. Import `{ Screen, Card, AmountText, Label, Body, Badge, Button, useTheme }` from `@amana/ui`.
2. Replace outer ScrollView with `<Screen title="Transaction" scrollable>`.
3. Wrap the amount display in `<AmountText size="xl" value={formattedAmount} sentiment={isDebit ? 'debit' : 'credit'} />`.
4. Wrap detail fields in `<Card>` with `<Label>` + `<Body>` pairs.
5. Replace status indicator with `<Badge variant={statusVariant} label={status} />`.
6. Replace "Add photo" button with `<Button variant="secondary" label="ADD PHOTO" onPress={...} />`.
7. Keep all API calls and navigation unchanged.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/screens/HomeScreen.tsx apps/agent/src/screens/TransactionListScreen.tsx apps/agent/src/screens/TransactionDetailScreen.tsx
git commit -m "feat(ui): migrate agent home + transaction screens to @amana/ui"
```

---

### Task 14: Agent payment flow screens — ConfirmScreen, SendingScreen, FailedScreen, ReceiptScreen

**Files:**
- Modify: `apps/agent/src/screens/ConfirmScreen.tsx`
- Modify: `apps/agent/src/screens/SendingScreen.tsx`
- Modify: `apps/agent/src/screens/FailedScreen.tsx`
- Modify: `apps/agent/src/screens/ReceiptScreen.tsx`

- [ ] **Step 1: Migrate `apps/agent/src/screens/ConfirmScreen.tsx`**

Read the current file. This screen has a KeyboardAvoidingView + ScrollView + amount/note/GPS. Changes:
1. Import `{ Screen, Card, AmountText, Button, TextInput, useTheme, Label, Body }` from `@amana/ui`.
2. Replace outer wrapper with `<Screen title="Confirm Payment" keyboardAvoiding scrollable>`.
3. Wrap amount + recipient in `<Card>` with `<AmountText size="xl">`.
4. Replace note TextInput with `<TextInput label="Note (optional)" />` from `@amana/ui`.
5. Replace confirm button with `<Button label="CONFIRM PAYMENT" onPress={...} loading={isSubmitting} />`.
6. Keep GPS toggle (Switch) + all business logic unchanged.

- [ ] **Step 2: Migrate `apps/agent/src/screens/SendingScreen.tsx`**

Read the current file. This is a loading/polling screen. Changes:
1. Import `{ Screen, AmountText, Skeleton, Body, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen>` (no title — use centered layout).
3. Replace custom spinner/loading indicators with `<Skeleton>` rows.
4. Replace amount display with `<AmountText size="xl" value={amount} />`.
5. Keep polling logic + push listener unchanged.

- [ ] **Step 3: Migrate `apps/agent/src/screens/FailedScreen.tsx`**

Read the current file. Changes:
1. Import `{ Screen, AmountText, Badge, Button, Body, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Payment Failed">`.
3. Replace error indicator with `<Badge variant="error" label="FAILED" />`.
4. Replace amount with `<AmountText size="xl" value={amount} sentiment="debit" />`.
5. Replace retry + dismiss buttons with `<Button>` components.
6. Keep error message and navigation unchanged.

- [ ] **Step 4: Migrate `apps/agent/src/screens/ReceiptScreen.tsx`**

Read the current file. This is a ScrollView with amount + recipient + NIBSS session. Changes:
1. Import `{ Screen, Card, AmountText, Label, Body, Button, useTheme }` from `@amana/ui`.
2. Replace outer ScrollView with `<Screen title="Receipt" scrollable>`.
3. Wrap receipt fields in `<Card accent>` with `<Label>` + `<Body>` pairs.
4. Replace amount with `<AmountText size="xl" value={amount} sentiment="credit" />`.
5. Replace "Show recipient" + "Add photo" with `<Button variant="secondary">` components.
6. Keep NIBSS session display and navigation unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/screens/ConfirmScreen.tsx apps/agent/src/screens/SendingScreen.tsx apps/agent/src/screens/FailedScreen.tsx apps/agent/src/screens/ReceiptScreen.tsx
git commit -m "feat(ui): migrate agent payment flow screens to @amana/ui"
```

---

### Task 15: Agent pairing/wait screens — BumpWaitScreen, PairingMethodScreen, NFCPairScreen, PairingSuccessScreen

**Files:**
- Modify: `apps/agent/src/screens/BumpWaitScreen.tsx`
- Modify: `apps/agent/src/screens/PairingMethodScreen.tsx`
- Modify: `apps/agent/src/screens/NFCPairScreen.tsx`
- Modify: `apps/agent/src/screens/PairingSuccessScreen.tsx`

- [ ] **Step 1: Migrate `apps/agent/src/screens/BumpWaitScreen.tsx`**

Read the current file. This screen has a countdown timer and waits for `bump_decided` push. Changes:
1. Import `{ Screen, Card, Skeleton, Badge, Button, Body, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Waiting for Approval">`.
3. Wrap countdown in `<Card>` with styled timer text using `theme.type.amount.xl`.
4. Replace status indicators with `<Badge>`.
5. Replace cancel button with `<Button variant="ghost" label="CANCEL" onPress={...} />`.
6. Keep countdown logic + push listener unchanged.

- [ ] **Step 2: Migrate `apps/agent/src/screens/PairingMethodScreen.tsx`**

Read the current file. This screen has three method cards (QR, NFC, SMS). Changes:
1. Import `{ Screen, Card, Button, Body, Heading, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Pair with Principal">`.
3. Replace each method option with a `<Card>` containing `<Heading size="md">` + `<Body>` + `<Button>`.
4. Keep pendingToken detection and navigation unchanged.

- [ ] **Step 3: Migrate `apps/agent/src/screens/NFCPairScreen.tsx`**

Read the current file. This screen has three phases (waiting/reading/error) driven by NFC state. Changes:
1. Import `{ Screen, Card, Body, Badge, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="NFC Pairing">`.
3. Wrap NFC phase content in `<Card>` with status `<Badge>` and `<Body>` instruction text.
4. Keep react-native-nfc-manager logic completely unchanged.

- [ ] **Step 4: Migrate `apps/agent/src/screens/PairingSuccessScreen.tsx`**

Read the current file. This screen shows a checkmark + wallet name + principal phone. Changes:
1. Import `{ Screen, CoinSealMark, Heading, Body, Button, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Paired">`.
3. Replace checkmark with `<CoinSealMark size={80} variant="default" />` centered.
4. Replace wallet name text with `<Heading size="lg">{walletName}</Heading>`.
5. Replace "Let's go" button with `<Button label="LET'S GO" onPress={onPaired} />`.
6. Keep onPaired callback logic unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/screens/BumpWaitScreen.tsx apps/agent/src/screens/PairingMethodScreen.tsx apps/agent/src/screens/NFCPairScreen.tsx apps/agent/src/screens/PairingSuccessScreen.tsx
git commit -m "feat(ui): migrate agent pairing/wait screens to @amana/ui"
```

---

### Task 16: Agent capture screens — QRScanScreen, NQRScanScreen, CaptureMethodScreen, PhotoAttachScreen

**Files:**
- Modify: `apps/agent/src/screens/QRScanScreen.tsx`
- Modify: `apps/agent/src/screens/NQRScanScreen.tsx`
- Modify: `apps/agent/src/screens/CaptureMethodScreen.tsx`
- Modify: `apps/agent/src/screens/PhotoAttachScreen.tsx`

Note: QRScan, NQRScan, and PhotoAttach use a camera view that fills the screen. They cannot be wrapped in `<Screen>` for the camera state itself. Apply theme only to the permission-denied overlay and status indicators.

- [ ] **Step 1: Migrate `apps/agent/src/screens/QRScanScreen.tsx`**

Read the current file. Changes:
1. Import `{ useTheme, Body, Button }` from `@amana/ui`.
2. Add `const theme = useTheme();`.
3. In the permission-denied branch: replace hardcoded View background with `theme.colors.bg.base`, replace text with `<Body>` + `<Button label="GRANT PERMISSION" onPress={requestPermission} />`.
4. The active camera view (`<CameraView style={{ flex: 1 }}>`): keep as-is, no Screen wrapper around the camera itself.
5. Replace any hardcoded color values in overlays with theme tokens.

- [ ] **Step 2: Migrate `apps/agent/src/screens/NQRScanScreen.tsx`**

Read the current file. Same pattern as QRScanScreen — theme only the permission UI and overlays, leave camera view untouched.

- [ ] **Step 3: Migrate `apps/agent/src/screens/CaptureMethodScreen.tsx`**

Read the current file. This is a regular list screen (three action cards + recents FlatList). Changes:
1. Import `{ Screen, Card, SectionHeader, Body, Heading, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Capture Payment" noPadding>`.
3. Replace each action card with `<Card>` containing `<Heading size="md">` + `<Body>`.
4. Replace recents list items with styled rows using theme tokens.
5. Keep navigation callbacks unchanged.

- [ ] **Step 4: Migrate `apps/agent/src/screens/PhotoAttachScreen.tsx`**

Read the current file. This is a full camera flow (capture → preview → upload). Changes:
1. Import `{ useTheme, Button, Body }` from `@amana/ui`.
2. Add `const theme = useTheme();` and apply `theme.colors.*` to all non-camera UI (buttons overlay, permission screen).
3. Replace action buttons in the preview/upload stages with `<Button>`.
4. Keep the CameraView and ImagePreview logic completely unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/screens/QRScanScreen.tsx apps/agent/src/screens/NQRScanScreen.tsx apps/agent/src/screens/CaptureMethodScreen.tsx apps/agent/src/screens/PhotoAttachScreen.tsx
git commit -m "feat(ui): migrate agent capture screens to @amana/ui"
```

---

### Task 17: Agent misc screens — PhoneLookupScreen, ShowRecipientScreen, SettingsScreen, EnableNotificationsScreen

**Files:**
- Modify: `apps/agent/src/screens/PhoneLookupScreen.tsx`
- Modify: `apps/agent/src/screens/ShowRecipientScreen.tsx`
- Modify: `apps/agent/src/screens/SettingsScreen.tsx`
- Modify: `apps/agent/src/screens/EnableNotificationsScreen.tsx`

- [ ] **Step 1: Migrate `apps/agent/src/screens/PhoneLookupScreen.tsx`**

Read the current file. Changes:
1. Import `{ Screen, TextInput, Button, Card, useTheme, Body }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Find Recipient" keyboardAvoiding>`.
3. Replace phone TextInput with `<TextInput label="Phone Number" keyboardType="phone-pad" />`.
4. Replace lookup button with `<Button label="LOOK UP" onPress={...} loading={loading} />`.
5. Show result in a `<Card>` with `<Body>`.

- [ ] **Step 2: Migrate `apps/agent/src/screens/ShowRecipientScreen.tsx`**

Read the current file. Changes:
1. Import `{ Screen, Card, AmountText, Label, Body, Button, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Recipient">`.
3. Wrap amount + recipient name + NIBSS session in `<Card accent>` with `<Label>` + `<Body>` pairs.
4. Replace amount with `<AmountText size="xl" value={amount} />`.

- [ ] **Step 3: Migrate `apps/agent/src/screens/SettingsScreen.tsx`**

Read the current file. This screen has two sections (Wallet, Notifications) + sign out. Changes:
1. Import `{ Screen, SectionHeader, Card, Body, Button, useTheme }` from `@amana/ui`.
2. Replace outer View/ScrollView with `<Screen title="Settings" scrollable>`.
3. Replace section titles with `<SectionHeader title="WALLET" />`, `<SectionHeader title="NOTIFICATIONS" />`.
4. Wrap settings items in `<Card>`.
5. Replace sign out button with `<Button variant="ghost" label="SIGN OUT" onPress={signOut} />`.

- [ ] **Step 4: Migrate `apps/agent/src/screens/EnableNotificationsScreen.tsx`**

Read the current file. Changes:
1. Import `{ Screen, Body, Button, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Notifications">`.
3. Replace body text with `<Body>` components.
4. Replace enable button with `<Button label="ENABLE NOTIFICATIONS" onPress={...} />`.
5. Replace "Not now" with `<Button variant="ghost" label="NOT NOW" onPress={...} />`.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/screens/PhoneLookupScreen.tsx apps/agent/src/screens/ShowRecipientScreen.tsx apps/agent/src/screens/SettingsScreen.tsx apps/agent/src/screens/EnableNotificationsScreen.tsx
git commit -m "feat(ui): migrate agent misc screens to @amana/ui"
```

---

### Task 18: Principal auth + splash screens — PhoneScreen, VerifyScreen, SplashScreen

**Files:**
- Modify: `apps/principal/src/screens/PhoneScreen.tsx`
- Modify: `apps/principal/src/screens/VerifyScreen.tsx`
- Modify: `apps/principal/src/screens/SplashScreen.tsx`

- [ ] **Step 1: Migrate `apps/principal/src/screens/PhoneScreen.tsx`**

Read the current file. Same pattern as agent PhoneScreen:
1. Import `{ Screen, TextInput, Button, useTheme, Body }` from `@amana/ui`.
2. Replace outer wrapper with `<Screen title="Amana" keyboardAvoiding scrollable>`.
3. Replace phone TextInput with `<TextInput label="Mobile Number" keyboardType="phone-pad" />`.
4. Replace submit button with `<Button label="SEND CODE" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />`.
5. Keep `useAuthStore.requestOtp` logic unchanged.

- [ ] **Step 2: Migrate `apps/principal/src/screens/VerifyScreen.tsx`**

Read the current file. This screen has NIN + BVN fields for new principal signup. Changes:
1. Import `{ Screen, TextInput, Button, useTheme, Body, Heading }` from `@amana/ui`.
2. Replace outer wrapper with `<Screen title="Verify" keyboardAvoiding scrollable>`.
3. Replace OTP TextInput with `<TextInput label="Verification Code" keyboardType="number-pad" />`.
4. Replace NIN TextInput with `<TextInput label="NIN" keyboardType="number-pad" />`.
5. Replace BVN TextInput with `<TextInput label="BVN" keyboardType="number-pad" />`.
6. Replace verify button with `<Button label="VERIFY" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />`.
7. Keep `useAuthStore.verifyOtp` logic unchanged.

- [ ] **Step 3: Migrate `apps/principal/src/screens/SplashScreen.tsx`**

Read the current file. Currently just "Amana" text + ActivityIndicator. Replace entirely with the Coin Seal wordmark:
1. Import `{ Screen, CoinSealWordmark, Skeleton, useTheme }` from `@amana/ui`.
2. Replace the "Amana" Text + ActivityIndicator with a centered layout:

```typescript
import { View, ActivityIndicator } from 'react-native';
import { Screen, CoinSealWordmark, useTheme } from '@amana/ui';

export function SplashScreen() {
  const theme = useTheme();
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32 }}>
        <CoinSealWordmark size={48} />
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    </Screen>
  );
}
```

Keep any navigation/auth bootstrap logic that currently lives in SplashScreen.

- [ ] **Step 4: Commit**

```bash
git add apps/principal/src/screens/PhoneScreen.tsx apps/principal/src/screens/VerifyScreen.tsx apps/principal/src/screens/SplashScreen.tsx
git commit -m "feat(ui): migrate principal auth + splash screens to @amana/ui"
```

---

### Task 19: Principal home screens — HomeDashboardScreen, HouseholdSetupScreen

**Files:**
- Modify: `apps/principal/src/screens/HomeDashboardScreen.tsx`
- Modify: `apps/principal/src/screens/HouseholdSetupScreen.tsx`

- [ ] **Step 1: Migrate `apps/principal/src/screens/HomeDashboardScreen.tsx`**

Read the current file. This is a ScrollView screen with household name, top-up info, pending bumps badge. Changes:
1. Import `{ Screen, BalanceCard, Card, SectionHeader, Badge, Body, Heading, Button, useTheme }` from `@amana/ui`.
2. Replace outer ScrollView/View with `<Screen title="Amana" scrollable>`.
3. Replace balance/household display with `<BalanceCard label="HOUSEHOLD" amount={householdName} />`.
4. Replace pending bumps indicator with `<Badge count={pendingCount} variant="warning" />`.
5. Wrap navigation link cards in `<Card>`.
6. Keep all store selectors and navigation calls unchanged.

- [ ] **Step 2: Migrate `apps/principal/src/screens/HouseholdSetupScreen.tsx`**

Read the current file. This is a react-hook-form screen. Changes:
1. Import `{ Screen, TextInput, Button, useTheme, Body }` from `@amana/ui`.
2. Replace outer wrapper with `<Screen title="Set Up Household" keyboardAvoiding scrollable>`.
3. Replace household name TextInput with `<TextInput label="Household Name" />`.
4. Replace submit button with `<Button label="CREATE HOUSEHOLD" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />`.
5. Keep API call and navigation unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/principal/src/screens/HomeDashboardScreen.tsx apps/principal/src/screens/HouseholdSetupScreen.tsx
git commit -m "feat(ui): migrate principal home screens to @amana/ui"
```

---

### Task 20: Principal transaction screens — BumpsInboxScreen, TransactionDetailScreen

**Files:**
- Modify: `apps/principal/src/screens/BumpsInboxScreen.tsx`
- Modify: `apps/principal/src/screens/TransactionDetailScreen.tsx`

- [ ] **Step 1: Migrate `apps/principal/src/screens/BumpsInboxScreen.tsx`**

Read the current file. FlatList at top level with pending + history sections, approve/deny buttons. Changes:
1. Import `{ Screen, Card, AmountText, Badge, Button, SectionHeader, Label, Body, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Approvals" noPadding>`.
3. Replace bump row items with `<Card>` containing `<AmountText size="md">`, `<Label>`, `<Badge variant="warning">`, and `<Button>` approve/deny pair.
4. Replace section headers with `<SectionHeader>`.
5. Keep approve/deny API calls and FlatList pagination unchanged.

- [ ] **Step 2: Migrate `apps/principal/src/screens/TransactionDetailScreen.tsx`**

Read the current file. Complex ScrollView with Row helper, bump_pending alert, geo link. Changes:
1. Import `{ Screen, Card, AmountText, Label, Body, Badge, Button, Divider, useTheme }` from `@amana/ui`.
2. Replace outer ScrollView with `<Screen title="Transaction" scrollable>`.
3. Replace amount display with `<AmountText size="xl" value={formattedAmount} sentiment={isDebit ? 'debit' : 'credit'} />`.
4. Wrap transaction fields in `<Card>` with `<Label>` + `<Body>` pairs; replace Row helper with inline View rows.
5. Replace status badge with `<Badge variant={...} label={status} />`.
6. Keep bump alert and geo link logic unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/principal/src/screens/BumpsInboxScreen.tsx apps/principal/src/screens/TransactionDetailScreen.tsx
git commit -m "feat(ui): migrate principal transaction screens to @amana/ui"
```

---

### Task 21: Principal notification screens — NotificationsInboxScreen, NotificationKindDetailScreen, NotificationPreferencesScreen, QuietHoursScreen

**Files:**
- Modify: `apps/principal/src/screens/NotificationsInboxScreen.tsx`
- Modify: `apps/principal/src/screens/NotificationKindDetailScreen.tsx`
- Modify: `apps/principal/src/screens/NotificationPreferencesScreen.tsx`
- Modify: `apps/principal/src/screens/QuietHoursScreen.tsx`

- [ ] **Step 1: Migrate `apps/principal/src/screens/NotificationsInboxScreen.tsx`**

Read the current file. FlatList with `useLayoutEffect` for "Mark all read" headerRight. Changes:
1. Import `{ Screen, TransactionRow, SectionHeader, Badge, useTheme, IconButton }` from `@amana/ui`.
2. Remove the `useLayoutEffect` / `navigation.setOptions` call — move header button to `<Screen headerRight={...}>`.
3. Replace outer View with `<Screen title="Notifications" noPadding headerRight={<IconButton onPress={markAllRead}><Body>Mark all</Body></IconButton>} />`.
4. Replace notification rows with `<TransactionRow>` where merchant=title, timestamp=time, amount='' sentiment='credit'`.
5. Replace section headers with `<SectionHeader>`.
6. Keep `markAllRead` logic and FlatList unchanged.

- [ ] **Step 2: Migrate `apps/principal/src/screens/NotificationKindDetailScreen.tsx`**

Read the current file. Per-channel controls with `useLayoutEffect` for title. Changes:
1. Import `{ Screen, Card, Body, Button, useTheme }` from `@amana/ui`.
2. Remove `useLayoutEffect` / `navigation.setOptions` title-setting; replace with `<Screen title={channelName}>`.
3. Wrap toggle controls in `<Card>`.
4. Keep per-channel threshold/toggle logic unchanged.

- [ ] **Step 3: Migrate `apps/principal/src/screens/NotificationPreferencesScreen.tsx`**

Read the current file. A View with FlatList inside + quiet hours row at top. Changes:
1. Import `{ Screen, SectionHeader, Card, Body, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Notification Preferences" scrollable>`.
3. Wrap quiet hours row in `<Card>`.
4. Replace channel list items with `<Card>` rows.
5. Keep navigation callbacks unchanged.

- [ ] **Step 4: Migrate `apps/principal/src/screens/QuietHoursScreen.tsx`**

Read the current file. Toggle + time inputs with `useLayoutEffect` for title. Changes:
1. Import `{ Screen, Card, Body, Button, TextInput, useTheme }` from `@amana/ui`.
2. Remove `useLayoutEffect` title; use `<Screen title="Quiet Hours">`.
3. Wrap toggle + time inputs in `<Card>`.
4. Replace time TextInputs with UI `<TextInput>`.
5. Replace save button with `<Button label="SAVE" onPress={...} />`.
6. Keep quiet hours API logic unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/principal/src/screens/NotificationsInboxScreen.tsx apps/principal/src/screens/NotificationKindDetailScreen.tsx apps/principal/src/screens/NotificationPreferencesScreen.tsx apps/principal/src/screens/QuietHoursScreen.tsx
git commit -m "feat(ui): migrate principal notification screens to @amana/ui"
```

---

### Task 22: Principal member + sub-wallet screens — MembersScreen, SubWalletsListScreen, SubWalletDetailScreen, CreateSubWalletScreen, EditRulesScreen

**Files:**
- Modify: `apps/principal/src/screens/MembersScreen.tsx`
- Modify: `apps/principal/src/screens/SubWalletsListScreen.tsx`
- Modify: `apps/principal/src/screens/SubWalletDetailScreen.tsx`
- Modify: `apps/principal/src/screens/CreateSubWalletScreen.tsx`
- Modify: `apps/principal/src/screens/EditRulesScreen.tsx`

- [ ] **Step 1: Migrate `apps/principal/src/screens/MembersScreen.tsx`**

Read the current file. FlatList at top level. Changes:
1. Import `{ Screen, Card, Body, Badge, SectionHeader, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Members" noPadding>`.
3. Replace member row items with `<Card>` containing `<Body strong>` + `<Badge>`.
4. Keep FlatList and navigation unchanged.

- [ ] **Step 2: Migrate `apps/principal/src/screens/SubWalletsListScreen.tsx`**

Read the current file. View wrapping FlatList + FAB (position: absolute). Changes:
1. Import `{ Screen, Card, AmountText, SectionHeader, Button, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Sub-Wallets" noPadding>`.
3. Replace sub-wallet rows with `<Card>` containing `<Body strong>` + `<AmountText size="sm">`.
4. Keep FAB button; replace with `<Button>` in absolute-positioned wrapper using `theme.colors.accent`.
5. Keep FlatList and navigation unchanged.

- [ ] **Step 3: Migrate `apps/principal/src/screens/SubWalletDetailScreen.tsx`**

Read the current file. ScrollView with balance card, rules, snooze Modal, suspend/close buttons. Changes:
1. Import `{ Screen, BalanceCard, TransactionRow, Card, Body, Label, Button, useTheme }` from `@amana/ui`.
2. Replace outer ScrollView with `<Screen title={walletName} scrollable>`.
3. Replace balance display with `<BalanceCard label="BALANCE" amount={formattedBalance} />`.
4. Replace rule display with `<Card>` + `<Label>` + `<Body>` pairs.
5. Replace transaction rows with `<TransactionRow>`.
6. Replace suspend/close with `<Button variant="secondary">` / `<Button variant="ghost">`.
7. Keep Modal (snooze) and API calls unchanged.

- [ ] **Step 4: Migrate `apps/principal/src/screens/CreateSubWalletScreen.tsx`**

Read the current file. react-hook-form + agent picker FlatList + name TextInput. Changes:
1. Import `{ Screen, TextInput, Button, Card, Body, Label, useTheme }` from `@amana/ui`.
2. Replace outer wrapper with `<Screen title="New Sub-Wallet" keyboardAvoiding scrollable>`.
3. Replace name TextInput with `<TextInput label="Wallet Name" />`.
4. Replace agent picker items (FlatList rows) with `<Card>` rows using theme colors.
5. Replace create button with `<Button label="CREATE WALLET" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />`.

- [ ] **Step 5: Migrate `apps/principal/src/screens/EditRulesScreen.tsx`**

Read the current file. react-hook-form + daily limit TextInput + BigInt kobo conversion. Changes:
1. Import `{ Screen, TextInput, Button, useTheme, Body, Label }` from `@amana/ui`.
2. Replace outer wrapper with `<Screen title="Edit Rules" keyboardAvoiding scrollable>`.
3. Replace daily limit TextInput with `<TextInput label="Daily Limit (₦)" keyboardType="number-pad" />`.
4. Replace save button with `<Button label="SAVE RULES" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />`.
5. Keep BigInt naira→kobo conversion unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/principal/src/screens/MembersScreen.tsx apps/principal/src/screens/SubWalletsListScreen.tsx apps/principal/src/screens/SubWalletDetailScreen.tsx apps/principal/src/screens/CreateSubWalletScreen.tsx apps/principal/src/screens/EditRulesScreen.tsx
git commit -m "feat(ui): migrate principal member + sub-wallet screens to @amana/ui"
```

---

### Task 23: Principal misc screens — PairingScreen, SettingsScreen, EnableNotificationsScreen

**Files:**
- Modify: `apps/principal/src/screens/PairingScreen.tsx`
- Modify: `apps/principal/src/screens/SettingsScreen.tsx`
- Modify: `apps/principal/src/screens/EnableNotificationsScreen.tsx`

- [ ] **Step 1: Migrate `apps/principal/src/screens/PairingScreen.tsx`**

Read the current file. Issues pairing code via API, shows QR code (`react-native-qrcode-svg`), NFC emit on Android. Changes:
1. Import `{ Screen, Card, CoinSealMark, Body, Label, Button, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Pair Agent">`.
3. Wrap QR code in `<Card accent>` with `<Label>` instruction text above it.
4. Add `<CoinSealMark size={32} variant="principal" />` as visual header.
5. Replace refresh button with `<Button variant="secondary" label="REFRESH CODE" onPress={...} />`.
6. Keep `react-native-qrcode-svg` + NFC emit logic completely unchanged.

- [ ] **Step 2: Migrate `apps/principal/src/screens/SettingsScreen.tsx`**

Read the current file. ScrollView with notification preferences link + logout + app version. Changes:
1. Import `{ Screen, SectionHeader, Card, Body, Button, Caption, useTheme }` from `@amana/ui`.
2. Replace outer ScrollView with `<Screen title="Settings" scrollable>`.
3. Replace section titles with `<SectionHeader>`.
4. Wrap settings rows in `<Card>`.
5. Replace logout with `<Button variant="ghost" label="SIGN OUT" onPress={signOut} />`.
6. Replace version text with `<Caption>{version}</Caption>`.

- [ ] **Step 3: Migrate `apps/principal/src/screens/EnableNotificationsScreen.tsx`**

Read the current file. Bell icon + bullet points + "Enable"/"Not now" buttons. Changes:
1. Import `{ Screen, Body, Button, useTheme }` from `@amana/ui`.
2. Replace outer View with `<Screen title="Notifications">`.
3. Replace bell icon circle with `<CoinSealMark size={64} variant="principal" />` (or keep existing icon if it's a meaningful asset).
4. Replace body text + bullet points with `<Body>` components.
5. Replace "Enable" with `<Button label="ENABLE NOTIFICATIONS" onPress={enable} />`.
6. Replace "Not now" with `<Button variant="ghost" label="NOT NOW" onPress={dismiss} />`.

- [ ] **Step 4: Commit**

```bash
git add apps/principal/src/screens/PairingScreen.tsx apps/principal/src/screens/SettingsScreen.tsx apps/principal/src/screens/EnableNotificationsScreen.tsx
git commit -m "feat(ui): migrate principal misc screens to @amana/ui"
```

---

### Task 24: TypeScript check + smoke test

**Files:**
- No new files

- [ ] **Step 1: Run TypeScript check for agent app**

```bash
cd apps/agent && npx tsc --noEmit
```

Expected: 0 errors. If errors exist, fix them before continuing.

- [ ] **Step 2: Run TypeScript check for principal app**

```bash
cd apps/principal && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Run TypeScript check for packages/ui**

```bash
cd packages/ui && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Start the agent Expo dev server and verify it boots**

```bash
cd apps/agent && npx expo start --no-dev
```

Expected: Expo bundler starts without Metro errors. Watch for any module resolution errors for `@amana/ui`. If `@amana/ui` fails to resolve, verify `metro.config.js` has the `resolveRequest` override (it should — this is the existing pattern used for `@amana/types`).

- [ ] **Step 5: Commit any TypeScript fixes**

```bash
git add -A
git commit -m "fix(ui): TypeScript errors from design system migration"
```

---

### Task 25: Final wiring — register @amana/ui in pnpm-workspace + turbo pipeline

**Files:**
- Verify: `pnpm-workspace.yaml`
- Verify: `turbo.json`

- [ ] **Step 1: Check `pnpm-workspace.yaml`**

Read `pnpm-workspace.yaml`. Verify it includes `packages/*`. If it only includes `apps/*`, add `packages/*`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

`packages/ui` should already be covered if `packages/*` is present (same as `packages/types`).

- [ ] **Step 2: Check `turbo.json`**

Read `turbo.json`. No changes needed for `packages/ui` specifically since it has no build script. Turbo only needs to know about pipelines with `build` / `test` tasks. `packages/ui` is source-only.

- [ ] **Step 3: Verify the complete installation**

```bash
pnpm install
```

Expected: clean install with no version conflicts.

- [ ] **Step 4: Final commit**

```bash
git add pnpm-workspace.yaml turbo.json pnpm-lock.yaml
git commit -m "feat(ui): brand + design system migration complete"
```

---

## Self-Review

**Spec coverage:**

| Spec Section | Tasks |
|---|---|
| 1.1 Colour tokens (dark + light) | Task 2 |
| 1.2 Typography scale | Tasks 2, 3 |
| 1.3 Spacing | Task 2 (tokens.ts) |
| 2.1–2.3 Coin Seal mark + variants | Task 8 |
| 3.1 Package setup | Task 1 |
| 3.2 ThemeProvider | Task 2 |
| 3.3 All 21 component contracts | Tasks 3–8 |
| 3.4 react-native-svg peer dep | Tasks 1, 9 |
| 4. Font installation | Task 9 |
| 5.1 Agent screens (20) | Tasks 12–17 |
| 5.2 Principal screens (19) | Tasks 18–23 |
| 6.1 Tab bar theme | Task 11 |
| 6.2 headerShown: false | Task 11 |
| 7. App icon generation | Task 10 |

All spec sections covered.

**Type consistency:** `ThemeContext.tsx` imports `Colors` from `tokens.ts` (not re-exporting conflicting type). `ThemeProvider` uses `darkColors`/`lightColors` directly. Component files import `useTheme` from `'../theme/ThemeContext'`. Barrel export in `index.ts` re-exports all public types.

**No placeholders detected.**
