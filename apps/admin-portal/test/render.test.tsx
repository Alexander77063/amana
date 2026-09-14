import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { byLabel, byRole, change, flush, render, submit, textContent } from './render';

/**
 * The harness tests itself, because Tasks 6-9 select every control through it. Three of its
 * helpers — `byLabel`, `change`, `submit` — and the async `flush` are not exercised by any screen
 * test in this task, and a query helper that silently returns the wrong node is worse than no
 * helper at all. The fixture mirrors the shape those screens use: a label that interpolates a
 * business name, a select, a form, and a value that only arrives after an await.
 */
function Fixture({ name, onSave }: { name: string; onSave: (category: string) => void }) {
  const [category, setCategory] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoaded(await Promise.resolve(`${name} is claimed`));
    })();
  }, [name]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(category);
      }}
    >
      <label htmlFor="category">Category for {name}</label>
      <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">Choose one</option>
        <option value="food">Food &amp; market</option>
      </select>
      <p>{loaded ?? 'Loading…'}</p>
      <button type="submit">Save</button>
    </form>
  );
}

describe('the test harness', () => {
  it('resolves a label with an interpolated name to the control it names', () => {
    const { root } = render(<Fixture name="CORNER SHOP" onSave={() => {}} />);
    const label = root.find((n) => n.type === 'label');
    // React exposes the JSX prop, not the DOM attribute: `htmlFor`, never `for`.
    expect(label.props.htmlFor).toBe('category');
    expect(textContent(label)).toBe('Category for CORNER SHOP');
    expect(byLabel(root, 'Category for CORNER SHOP').props.id).toBe('category');
  });

  it('changes a control and submits the form it sits in', () => {
    const onSave = vi.fn();
    const { root } = render(<Fixture name="CORNER SHOP" onSave={onSave} />);
    change(byLabel(root, 'Category for CORNER SHOP'), 'food');
    expect(byLabel(root, 'Category for CORNER SHOP').props.value).toBe('food');
    submit(byRole(root, 'form'));
    expect(onSave).toHaveBeenCalledWith('food');
  });

  it('flushes an effect that awaits before it sets state', async () => {
    const { root } = render(<Fixture name="CORNER SHOP" onSave={() => {}} />);
    expect(textContent(root)).toContain('Loading…');
    await flush();
    expect(textContent(root)).toContain('CORNER SHOP is claimed');
  });

  it('finds a control by role and accessible name', () => {
    const { root } = render(<Fixture name="CORNER SHOP" onSave={() => {}} />);
    expect(byRole(root, 'button', 'Save').props.type).toBe('submit');
  });
});
