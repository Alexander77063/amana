export type Colors = {
  bg: { base: string; surface: string; raised: string };
  text: { primary: string; secondary: string; muted: string };
  accent: string;
  accentDim: string;
  debit: string;
  credit: string;
  border: string;
  borderAccent: string;
};

export const darkColors: Colors = {
  bg: { base: '#0D1B2A', surface: '#152535', raised: '#1C3147' },
  text: { primary: '#F5F0E8', secondary: '#8BA3B8', muted: '#5A8CA8' },
  accent: '#C9A227',
  accentDim: 'rgba(201,162,39,0.18)',
  debit: '#FF6B6B',
  credit: '#52C49A',
  border: 'rgba(255,255,255,0.06)',
  borderAccent: 'rgba(201,162,39,0.18)',
};

export const lightColors: Colors = {
  bg: { base: '#F5F0E8', surface: '#FFFFFF', raised: '#EDE8DF' },
  text: { primary: '#0D1B2A', secondary: '#8B9AAA', muted: '#A0ADB8' },
  accent: '#C9A227',
  accentDim: 'rgba(201,162,39,0.15)',
  debit: '#C0392B',
  credit: '#2E8B57',
  border: 'rgba(0,0,0,0.06)',
  borderAccent: 'rgba(201,162,39,0.25)',
};

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
