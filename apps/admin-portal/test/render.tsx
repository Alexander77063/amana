import type { ReactElement } from 'react';
import TestRenderer, { type ReactTestInstance, act } from 'react-test-renderer';

/**
 * A very small web-flavoured testing harness over react-test-renderer.
 *
 * The portal has no jsdom: components render under node and are queried the way a screen reader
 * would find them — by role and accessible name, by the label that points at a control. That keeps
 * the selectors identical to the accessibility contract the design plan requires, so a test fails
 * when the label or the `aria-current` goes missing, not just when the markup moves.
 */
export type Rendered = { root: ReactTestInstance; unmount: () => void };

export function render(ui: ReactElement): Rendered {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(ui);
  });
  return {
    root: renderer.root,
    unmount: () =>
      act(() => {
        renderer.unmount();
      }),
  };
}

/** Let pending promises inside effects settle. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const props = (n: ReactTestInstance) => (n.props ?? {}) as Record<string, unknown>;
const isHost = (n: ReactTestInstance) => typeof n.type === 'string';

/**
 * Concatenated text under a node. Interpolated children (`Category for {name}`) arrive as several
 * string children, and a rendered number (`{pendingCount}`) arrives as a number, so anything that
 * is not an object is stringified rather than descended into.
 */
export function textContent(node: ReactTestInstance): string {
  const out: string[] = [];
  const walk = (c: unknown): void => {
    if (c === null || c === undefined || typeof c === 'boolean') return;
    if (typeof c === 'object') {
      const kids = (c as ReactTestInstance).children;
      if (Array.isArray(kids)) for (const k of kids) walk(k);
      return;
    }
    out.push(String(c));
  };
  const children = node.children as unknown[];
  for (const c of children) walk(c);
  return out.join('');
}

const ROLE_TAGS: Record<string, string[]> = {
  button: ['button'],
  link: ['a'],
  heading: ['h1', 'h2', 'h3'],
  row: ['tr'],
  textbox: ['input', 'textarea'],
  combobox: ['select'],
  form: ['form'],
};

/** Web-flavoured byRole: host element type (or explicit role prop) plus accessible name. */
export function allByRole(
  root: ReactTestInstance,
  role: string,
  name?: string,
): ReactTestInstance[] {
  return root.findAll((n) => {
    if (!isHost(n)) return false;
    const p = props(n);
    const roleMatch = p.role === role || (ROLE_TAGS[role] ?? []).includes(n.type as string);
    if (!roleMatch) return false;
    if (name === undefined) return true;
    const accessible = (p['aria-label'] as string | undefined) ?? textContent(n).trim();
    return accessible === name;
  });
}

export function byRole(root: ReactTestInstance, role: string, name?: string): ReactTestInstance {
  const all = allByRole(root, role, name);
  if (all.length !== 1) {
    throw new Error(`expected 1 ${role}${name ? ` "${name}"` : ''}, found ${all.length}`);
  }
  return all[0] as ReactTestInstance;
}

/**
 * The control a `<label htmlFor>` points at. The label is matched on its trimmed text exactly as
 * written, interpolation included. A label with no `htmlFor` is an error rather than a silent
 * match on the first id-less element, which is what makes a missing label fail loudly.
 */
export function byLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  const lab = root.find((n) => isHost(n) && n.type === 'label' && textContent(n).trim() === label);
  const id = props(lab).htmlFor;
  if (typeof id !== 'string') {
    throw new Error(`label "${label}" has no htmlFor, so it names no control`);
  }
  return root.find((n) => isHost(n) && props(n).id === id);
}

export function click(n: ReactTestInstance): void {
  act(() => {
    (props(n).onClick as ((e: unknown) => void) | undefined)?.({ preventDefault() {} });
  });
}

export function submit(form: ReactTestInstance): void {
  act(() => {
    (props(form).onSubmit as ((e: unknown) => void) | undefined)?.({ preventDefault() {} });
  });
}

export function change(n: ReactTestInstance, value: string): void {
  act(() => {
    (props(n).onChange as ((e: unknown) => void) | undefined)?.({ target: { value } });
  });
}
