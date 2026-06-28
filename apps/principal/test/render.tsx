import { ThemeProvider } from '@amana/ui';
import type { ReactElement } from 'react';
import TestRenderer, { type ReactTestInstance, act } from 'react-test-renderer';

export type Rendered = { root: ReactTestInstance; unmount: () => void };

export function render(ui: ReactElement): Rendered {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<ThemeProvider fontsLoaded>{ui}</ThemeProvider>);
  });
  return { root: renderer.root, unmount: () => act(() => renderer.unmount()) };
}

const propsOf = (n: ReactTestInstance): Record<string, unknown> =>
  (n.props ?? {}) as Record<string, unknown>;

export function allByRole(root: ReactTestInstance, role: string): ReactTestInstance[] {
  return root.findAll((n) => propsOf(n).accessibilityRole === role);
}
export function allByLabel(root: ReactTestInstance, label: string): ReactTestInstance[] {
  return root.findAll((n) => propsOf(n).accessibilityLabel === label);
}
export function byLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => propsOf(n).accessibilityLabel === label);
}
export function allByType(root: ReactTestInstance, type: string): ReactTestInstance[] {
  return root.findAll((n) => (n.type as unknown as string) === type);
}

/** Flush pending promises + effects so async data-loading state lands. */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function textContent(root: ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: ReactTestInstance | string): void => {
    if (typeof node === 'string') return void out.push(node);
    (node.children as Array<ReactTestInstance | string> | undefined)?.forEach(walk);
  };
  walk(root);
  return out.join('');
}
