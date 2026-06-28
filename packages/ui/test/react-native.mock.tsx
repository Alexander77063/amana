/**
 * Lightweight `react-native` stand-in for unit-testing components with
 * react-test-renderer under Vitest (node env). RN ships Flow-typed source that
 * esbuild can't transform, so we alias the module (see vitest.config.ts) to this
 * mock, which exposes the small surface our components actually use. Each host
 * component simply forwards its props (including all accessibility* props) onto
 * a named host element so tests can query the tree by role/label.
 */
import React, { type ReactNode } from 'react';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

function host(name: string) {
  const Comp = React.forwardRef<unknown, AnyProps>((props, ref) =>
    React.createElement(name, { ...props, ref }, props.children as ReactNode),
  );
  Comp.displayName = name;
  return Comp;
}

export const View = host('View');
export const Text = host('Text');
export const Pressable = host('Pressable');
export const TouchableOpacity = host('TouchableOpacity');
export const ActivityIndicator = host('ActivityIndicator');
export const TextInput = host('TextInput');
export const ScrollView = host('ScrollView');
export const KeyboardAvoidingView = host('KeyboardAvoidingView');
export const Image = host('Image');
export const FlatList = host('FlatList');

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (style: unknown): Record<string, unknown> => {
    if (Array.isArray(style)) {
      return style.reduce<Record<string, unknown>>(
        (acc, s) => Object.assign(acc, StyleSheet.flatten(s)),
        {},
      );
    }
    return (style as Record<string, unknown>) ?? {};
  },
  hairlineWidth: 1,
  absoluteFill: {},
};

export const Platform = {
  OS: 'ios' as const,
  select: <T,>(specifics: { ios?: T; android?: T; default?: T }): T | undefined =>
    specifics.ios ?? specifics.default,
};

export const Appearance = {
  getColorScheme: (): 'light' | 'dark' | null => 'light',
  addChangeListener: (): { remove: () => void } => ({ remove: () => {} }),
};

export const Dimensions = {
  get: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
};

const noopAnimation = { start: (cb?: () => void) => cb?.(), stop: () => {}, reset: () => {} };

class AnimatedValue {
  constructor(private _value: number) {}
  setValue(v: number): void {
    this._value = v;
  }
  interpolate(): AnimatedValue {
    return this;
  }
}

export const Animated = {
  Value: AnimatedValue,
  View: host('Animated.View'),
  Text: host('Animated.Text'),
  timing: () => noopAnimation,
  sequence: () => noopAnimation,
  loop: () => noopAnimation,
  parallel: () => noopAnimation,
};

// Type-only re-exports are erased by esbuild at runtime; declaring them keeps
// any accidental runtime access from throwing.
export type ViewStyle = Record<string, unknown>;
export type TextStyle = Record<string, unknown>;
export type ViewProps = AnyProps;
export type TextInputProps = AnyProps;

export default {
  View,
  Text,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Image,
  FlatList,
  StyleSheet,
  Platform,
  Appearance,
  Dimensions,
  Animated,
};
