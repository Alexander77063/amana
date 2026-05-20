# Brand & UI Design System Spec

## Overview

Full visual overhaul of Amana's Agent and Principal apps. Introduces a shared component library (`packages/ui`) with the Midnight colour palette, Coin Seal brand mark, and a mixed Georgia/Plus Jakarta Sans typography system. Both apps are migrated screen by screen to use the new design system.

**Brand identity:** Private bank authority meets Nigerian fintech warmth. Deep navy, warm cream, gold. Serious but human.

---

## 1. Brand Tokens

### 1.1 Colour System — Midnight Palette

Tokens are consumed via `useTheme()` hook from `packages/ui`. The system follows React Native's `Appearance` API for dark/light resolution.

**Dark mode (`colorScheme === 'dark'` or explicit override):**

| Token | Value | Use |
|-------|-------|-----|
| `bg.base` | `#0D1B2A` | Page / screen background |
| `bg.surface` | `#152535` | Card background |
| `bg.raised` | `#1C3147` | Modals, elevated sheets |
| `text.primary` | `#F5F0E8` | Headings, body text |
| `text.secondary` | `#8BA3B8` | Labels, metadata |
| `text.muted` | `#5A8CA8` | Timestamps, captions |
| `accent` | `#C9A227` | Gold — CTAs, active tab, highlights |
| `accent.dim` | `rgba(201,162,39,0.18)` | Gold-tinted borders, backgrounds |
| `debit` | `#FF6B6B` | Negative / outgoing amounts |
| `credit` | `#52C49A` | Positive / incoming amounts |
| `border` | `rgba(255,255,255,0.06)` | Card edges, dividers |
| `border.accent` | `rgba(201,162,39,0.18)` | Gold-tinted card borders |

**Light mode:**

| Token | Value | Use |
|-------|-------|-----|
| `bg.base` | `#F5F0E8` | Warm cream page background |
| `bg.surface` | `#FFFFFF` | White cards |
| `bg.raised` | `#EDE8DF` | Elevated / secondary surfaces |
| `text.primary` | `#0D1B2A` | Headings, body text |
| `text.secondary` | `#8B9AAA` | Labels, metadata |
| `text.muted` | `#A0ADB8` | Captions |
| `accent` | `#C9A227` | Gold |
| `accent.dim` | `rgba(201,162,39,0.15)` | Gold-tinted backgrounds |
| `debit` | `#C0392B` | Negative amounts |
| `credit` | `#2E8B57` | Positive amounts |
| `border` | `rgba(0,0,0,0.06)` | Card edges |
| `border.accent` | `rgba(201,162,39,0.25)` | Gold-tinted borders |

### 1.2 Typography Scale

| Token | Font | Size | Weight | Extra | Use |
|-------|------|------|--------|-------|-----|
| `amount.xl` | Georgia | 32 | 700 | letterSpacing: -0.5 | Hero balance display |
| `amount.lg` | Georgia | 24 | 700 | letterSpacing: -0.5 | Secondary balances |
| `amount.md` | Georgia | 18 | 700 | — | Transaction rows |
| `amount.sm` | Georgia | 14 | 700 | — | Inline amounts |
| `heading.lg` | Georgia | 20 | 700 | — | Screen titles |
| `heading.md` | Georgia | 16 | 700 | — | Section headers, card titles |
| `label` | Plus Jakarta Sans | 10 | 600 | uppercase, letterSpacing: 1.5 | Field labels, tab labels |
| `body` | Plus Jakarta Sans | 14 | 400 | — | Body copy |
| `body.strong` | Plus Jakarta Sans | 14 | 600 | — | Merchant names, key data |
| `caption` | Plus Jakarta Sans | 11 | 400 | — | Timestamps, secondary info |
| `button` | Plus Jakarta Sans | 13 | 700 | uppercase, letterSpacing: 1 | CTA buttons |

Georgia is a system font on iOS. On Android it is included in AOSP on most devices but is not guaranteed — to be safe, bundle Georgia `.ttf` files via `expo-font` alongside Plus Jakarta Sans (Google Fonts distributes Georgia-licensed equivalents, or source the TTF from a licensed copy). Plus Jakarta Sans requires `expo-font` regardless.

### 1.3 Spacing System

8px base unit. All spacing values in the component library use this scale:

```
4   hairline gaps, icon internal padding
8   tight spacing within components
12  between related elements
16  card vertical padding
20  screen horizontal padding, card horizontal padding
24  between cards / list sections
32  between major page sections
48  bottom safe-area buffer before tab bar
```

---

## 2. Logo — The Coin Seal

### 2.1 Mark Anatomy

The mark is a hexagonal bullion coin seal built from 4 concentric layers:

1. **Outer rim** — thick hexagon stroke in `accent` gold. Stroke-width ~12% of diameter. Gives the coin-edge feel.
2. **Body fill** — solid hexagon fill in `#0D1B2A` (always navy, even in light mode — keeps the mark recognisable on any background).
3. **Inner ring** — thin hexagon stroke in `accent` gold, inset ~15% from outer rim.
4. **Khatam star** — 8-pointed Islamic geometric star (two overlapping squares rotated 45°), gold fill, centred.

### 2.2 Colour Variants

| Variant | Rim / star | Body | Use |
|---------|-----------|------|-----|
| Default | `#C9A227` gold | `#0D1B2A` navy | Primary brand usage |
| Agent | `#2563EB` blue | `#0D1B2A` navy | Agent-specific tinting |
| Principal | `#D97706` amber | `#0D1B2A` navy | Principal-specific tinting |
| Mono light | `#0D1B2A` navy | transparent | On light backgrounds |
| Mono white | `#FFFFFF` white | transparent | On dark backgrounds |

### 2.3 App Icons

- 1024×1024 PNG, navy (`#0D1B2A`) background, centred mark at ~60% canvas size in gold.
- Generated via `scripts/generate-icons.mjs` (already handles Expo icon resize chain).
- Android adaptive icon: same navy background, mark fills the safe zone (no crop loss).
- Agent icon: default gold variant. Principal icon: default gold variant (both use the same brand, not tinted variants).

---

## 3. Component Library — `packages/ui`

### 3.1 Package Setup

```
packages/ui/
  package.json          (@amana/ui, peer deps: react, react-native, react-native-svg)
  tsconfig.json
  src/
    index.ts            (barrel export)
    theme/
      tokens.ts         (raw colour + type constants, both modes)
      ThemeContext.tsx   (React context + useTheme hook)
      ThemeProvider.tsx  (wraps app, reads Appearance, exposes context)
    typography/
      AmountText.tsx
      Heading.tsx
      Label.tsx
      Body.tsx
      Caption.tsx
    layout/
      Screen.tsx
      Card.tsx
      Divider.tsx
    controls/
      Button.tsx
      IconButton.tsx
      TextInput.tsx
    data/
      BalanceCard.tsx
      TransactionRow.tsx
      SectionHeader.tsx
    feedback/
      Badge.tsx
      Skeleton.tsx
    brand/
      CoinSealMark.tsx
      CoinSealWordmark.tsx
```

### 3.2 ThemeProvider

```typescript
// Usage in each app's root
<ThemeProvider>
  <App />
</ThemeProvider>

// Usage in any component
const theme = useTheme();
// theme.colors.bg.base, theme.colors.accent, etc.
// theme.type.amount.xl, etc.
```

`ThemeProvider` listens to `Appearance.addChangeListener` and re-renders on system theme change.

### 3.3 Component Contracts

**`<Screen>`**
```typescript
type ScreenProps = {
  title?: string;           // Georgia heading.lg, centered
  headerRight?: ReactNode;  // right slot in custom header
  headerLeft?: ReactNode;   // left slot (back button added by navigator)
  scrollable?: boolean;     // wraps content in ScrollView (default false)
  children: ReactNode;
};
```
Background: `bg.base`. Horizontal padding: 20. Bottom padding: 48. Safe area applied.

**`<Card>`**
```typescript
type CardProps = {
  accent?: boolean;   // uses border.accent instead of border
  children: ReactNode;
  style?: ViewStyle;
};
```
Background: `bg.surface`. Border radius: 16. Padding: 16/20. Border: 1px `border` token.

**`<Button>`**
```typescript
type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'ghost';
  onPress: () => void;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;  // default true
};
```
- `primary`: `accent` gold background, `#0D1B2A` navy text, 48px height, 12px radius
- `secondary`: `bg.surface` background, `text.primary` text, `border` border
- `ghost`: transparent, `accent` gold text

**`<AmountText>`**
```typescript
type AmountTextProps = {
  size: 'xl' | 'lg' | 'md' | 'sm';
  value: string;          // pre-formatted: "₦ 2,450,000"
  sentiment?: 'debit' | 'credit' | 'neutral';  // default neutral
};
```
`neutral` uses `text.primary`. `debit` uses `debit` token. `credit` uses `credit` token.

**`<BalanceCard>`**
```typescript
type BalanceCardProps = {
  label: string;        // e.g. "TOTAL BALANCE"
  amount: string;       // e.g. "₦ 2,450,000"
  trend?: string;       // e.g. "↑ ₦180,000 this month"
  trendSentiment?: 'positive' | 'negative';
};
```

**`<TransactionRow>`**
```typescript
type TransactionRowProps = {
  merchant: string;
  timestamp: string;
  amount: string;       // pre-formatted with sign: "−₦12,500"
  sentiment: 'debit' | 'credit';
  onPress?: () => void;
};
```

**`<Badge>`**
```typescript
type BadgeProps = {
  count?: number;       // numeric badge (e.g. pending count)
  variant?: 'success' | 'error' | 'warning' | 'neutral';
  label?: string;       // text badge
};
```

**`<CoinSealMark>`**
```typescript
type CoinSealMarkProps = {
  size: number;
  variant?: 'default' | 'agent' | 'principal' | 'mono-light' | 'mono-white';
};
```

### 3.4 react-native-svg Dependency

`packages/ui` uses `react-native-svg` for `CoinSealMark`. Add it explicitly to both `apps/agent/package.json` and `apps/principal/package.json` (do not rely on transitive resolution). Declare it as a peer dependency in `packages/ui/package.json`.

---

## 4. Font Installation

Plus Jakarta Sans is not a system font. Install via `expo-font`:

```typescript
// In each app root (App.tsx), before rendering navigation:
const [fontsLoaded] = useFonts({
  'PlusJakartaSans-Regular': require('./assets/fonts/PlusJakartaSans-Regular.ttf'),
  'PlusJakartaSans-SemiBold': require('./assets/fonts/PlusJakartaSans-SemiBold.ttf'),
  'PlusJakartaSans-Bold': require('./assets/fonts/PlusJakartaSans-Bold.ttf'),
});
```

Font files downloaded from Google Fonts. Added to `apps/agent/assets/fonts/` and `apps/principal/assets/fonts/`.

`ThemeProvider` accepts a `fontsLoaded` prop and renders a splash-equivalent until fonts are ready (prevents FOUT).

---

## 5. Screen Migration

Each screen is migrated to use `packages/ui` components. Screens do not use `StyleSheet.create` with hardcoded colours after migration — all visual styling flows from `useTheme()` or component props.

### 5.1 Agent Screens (20 screens)

| Screen | Key components used |
|--------|---------------------|
| `PhoneScreen` | `Screen`, `TextInput`, `Button` |
| `AccountEntryScreen` | `Screen`, `TextInput`, `Button` |
| `HomeScreen` | `Screen`, `BalanceCard`, `TransactionRow`, `SectionHeader`, `Badge` |
| `TransactionListScreen` | `Screen`, `TransactionRow`, `SectionHeader` |
| `TransactionDetailScreen` | `Screen`, `Card`, `AmountText`, `Label`, `Body`, `Badge` |
| `ConfirmScreen` | `Screen`, `Card`, `AmountText`, `Button` |
| `SendingScreen` | `Screen`, `AmountText`, `Skeleton` |
| `FailedScreen` | `Screen`, `AmountText`, `Badge`, `Button` |
| `ReceiptScreen` | `Screen`, `Card`, `AmountText`, `Button` |
| `BumpWaitScreen` | `Screen`, `Card`, `Skeleton`, `Badge` |
| `PairingMethodScreen` | `Screen`, `Card`, `Button` |
| `NFCPairScreen` | `Screen`, `Card`, `Body` |
| `QRScanScreen` | `Screen` (custom camera layer) |
| `NQRScanScreen` | `Screen` (custom camera layer) |
| `CaptureMethodScreen` | `Screen`, `Card`, `Button` |
| `PhoneLookupScreen` | `Screen`, `TextInput`, `Card`, `Button` |
| `ShowRecipientScreen` | `Screen`, `Card`, `AmountText`, `Button` |
| `PairingSuccessScreen` | `Screen`, `CoinSealMark`, `Heading`, `Button` |
| `SettingsScreen` | `Screen`, `SectionHeader`, `Card` |
| `EnableNotificationsScreen` | `Screen`, `Body`, `Button` |

### 5.2 Principal Screens (19 screens)

| Screen | Key components used |
|--------|---------------------|
| `PhoneScreen` | `Screen`, `TextInput`, `Button` |
| `VerifyScreen` | `Screen`, `TextInput`, `Button` |
| `SplashScreen` | `Screen`, `CoinSealWordmark`, `Skeleton` |
| `HomeDashboardScreen` | `Screen`, `BalanceCard`, `Card`, `SectionHeader`, `Badge` |
| `HouseholdSetupScreen` | `Screen`, `TextInput`, `Button` |
| `BumpsInboxScreen` | `Screen`, `Card`, `AmountText`, `Badge`, `Button` |
| `TransactionDetailScreen` | `Screen`, `Card`, `AmountText`, `Label`, `Body`, `Badge` |
| `NotificationsInboxScreen` | `Screen`, `TransactionRow`, `SectionHeader`, `Badge` |
| `NotificationKindDetailScreen` | `Screen`, `Card`, `Body`, `Button` |
| `NotificationPreferencesScreen` | `Screen`, `SectionHeader`, `Card` |
| `QuietHoursScreen` | `Screen`, `Card`, `Button` |
| `MembersScreen` | `Screen`, `Card`, `SectionHeader`, `Badge` |
| `SubWalletsListScreen` | `Screen`, `Card`, `AmountText`, `SectionHeader` |
| `SubWalletDetailScreen` | `Screen`, `BalanceCard`, `TransactionRow` |
| `CreateSubWalletScreen` | `Screen`, `TextInput`, `Button` |
| `EditRulesScreen` | `Screen`, `Card`, `TextInput`, `Button` |
| `PairingScreen` | `Screen`, `Card`, `CoinSealMark`, `Body`, `Button` |
| `SettingsScreen` | `Screen`, `SectionHeader`, `Card` |
| `EnableNotificationsScreen` | `Screen`, `Body`, `Button` |

---

## 6. Navigation Styling

### 6.1 Tab Bar (Agent — `MainTabs.tsx`)

```typescript
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
tabBarLabelStyle: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, letterSpacing: 0.5 },
```

### 6.2 Stack Navigator Headers (both apps)

React Navigation's default header is **hidden** (`headerShown: false`) on all navigators. `<Screen>` renders its own header with Georgia title. This gives full control over typography and theming without fighting React Navigation's header system.

---

## 7. App Icon Generation

Update `scripts/generate-icons.mjs` to render the Coin Seal at 1024×1024 using `sharp`:

1. Inline the Coin Seal as an SVG string (same geometry as `CoinSealMark` — hexagon outer rim, body fill, inner ring, khatam star) at 614×614 (60% of 1024).
2. Create a 1024×1024 navy (`#0D1B2A`) PNG background with `sharp`.
3. Composite the SVG over the background, centred.
4. Write output to all four icon paths:
   - `apps/agent/assets/icon.png`
   - `apps/agent/assets/adaptive-icon.png`
   - `apps/principal/assets/icon.png`
   - `apps/principal/assets/adaptive-icon.png`

`sharp` supports SVG compositing natively — no canvas dependency needed. The Expo resize chain (notification icon, splash, etc.) remains unchanged.

---

## 8. Out of Scope

- Web / responsive layout (Principal web dashboard, if it comes)
- Custom animated transitions between screens
- Dark/light mode toggle in settings (system-only for now — `Appearance` API)
- Figma design file (SVG source of truth lives in `packages/ui/src/brand/`)
