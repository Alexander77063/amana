import { describe, expect, it, vi } from 'vitest';
import { allByRole, byRole, click, render } from '../test/render';
import { Confirm } from './Confirm';

describe('Confirm', () => {
  it('asks once, then acts', () => {
    const onConfirm = vi.fn();
    const { root } = render(
      <Confirm
        label="Suspend CORNER SHOP"
        confirmLabel="suspend"
        onConfirm={onConfirm}
        tone="danger"
      />,
    );
    click(byRole(root, 'button', 'Suspend CORNER SHOP'));
    expect(onConfirm).not.toHaveBeenCalled();
    click(byRole(root, 'button', 'Yes, suspend'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('can be backed out of', () => {
    const { root } = render(<Confirm label="Revoke" confirmLabel="revoke" onConfirm={() => {}} />);
    click(byRole(root, 'button', 'Revoke'));
    click(byRole(root, 'button', 'Cancel'));
    expect(allByRole(root, 'button').map((b) => b.props.children)).toEqual(['Revoke']);
  });
});
