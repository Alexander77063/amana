import type React from 'react';
import TestRenderer, { type ReactTestInstance, act } from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeProvider';

export type Rendered = {
  root: ReactTestInstance;
  unmount: () => void;
};

/** Render a component inside the ThemeProvider and return its root instance. */
export function render(ui: React.ReactElement): Rendered {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<ThemeProvider fontsLoaded>{ui}</ThemeProvider>);
  });
  return {
    root: renderer.root,
    unmount: () => act(() => renderer.unmount()),
  };
}

const propsOf = (n: ReactTestInstance): Record<string, unknown> =>
  (n.props ?? {}) as Record<string, unknown>;

/** All instances with the given accessibilityRole. */
export function allByRole(root: ReactTestInstance, role: string): ReactTestInstance[] {
  return root.findAll((n) => propsOf(n).accessibilityRole === role);
}

/** Single instance with the given accessibilityRole (throws if not exactly one). */
export function byRole(root: ReactTestInstance, role: string): ReactTestInstance {
  return root.find((n) => propsOf(n).accessibilityRole === role);
}

/** All instances carrying the given accessibilityLabel. */
export function allByLabel(root: ReactTestInstance, label: string): ReactTestInstance[] {
  return root.findAll((n) => propsOf(n).accessibilityLabel === label);
}

/** Single instance with the given accessibilityLabel (throws if not exactly one). */
export function byLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => propsOf(n).accessibilityLabel === label);
}

/** All host instances whose element type matches the given name (e.g. 'ActivityIndicator'). */
export function allByType(root: ReactTestInstance, type: string): ReactTestInstance[] {
  return root.findAll((n) => (n.type as unknown as string) === type);
}

/** Concatenated string content of every Text-like node under root. */
export function textContent(root: ReactTestInstance): string {
  const strings: string[] = [];
  const walk = (node: ReactTestInstance | string): void => {
    if (typeof node === 'string') {
      strings.push(node);
      return;
    }
    const children = node.children as Array<ReactTestInstance | string> | undefined;
    children?.forEach(walk);
  };
  walk(root);
  return strings.join('');
}
