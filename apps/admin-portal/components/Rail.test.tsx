import { describe, expect, it } from 'vitest';
import { MeProvider } from '../lib/me';
import type { Me } from '../lib/types';
import { __setPath } from '../test/next.mock';
import { allByRole, byRole, render, textContent } from '../test/render';
import { Rail } from './Rail';

const me = (over: Partial<Me>): Me => ({
  id: 'u',
  email: 'ops@amana-ng.com',
  displayName: null,
  roles: ['ops'],
  permissions: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'],
  ...over,
});

describe('Rail', () => {
  it('shows only the sections this person can use, and who they are', () => {
    __setPath('/ops/vendors');
    const { root } = render(
      <MeProvider me={me({})}>
        <Rail pendingCount={2} />
      </MeProvider>,
    );
    const names = allByRole(root, 'link').map((l) => textContent(l).replace(/\d+$/, '').trim());
    expect(names).toEqual(['Inbox', 'Vendors', 'Retailers']);
    expect(byRole(root, 'link', 'Vendors').props['aria-current']).toBe('page');
    expect(textContent(root)).toContain('ops@amana-ng.com');
    expect(textContent(root)).toContain('ops');
  });

  it('shows People to an admin and the pending count once', () => {
    __setPath('/');
    const { root } = render(
      <MeProvider me={me({ roles: ['admin'], permissions: ['iam.read', 'iam.write'] })}>
        <Rail pendingCount={3} />
      </MeProvider>,
    );
    expect(allByRole(root, 'link').map((l) => textContent(l))).toEqual(['Inbox3', 'People']);
  });

  it('a person with no role sees only the inbox', () => {
    const { root } = render(
      <MeProvider me={me({ roles: [], permissions: [] })}>
        <Rail pendingCount={0} />
      </MeProvider>,
    );
    expect(allByRole(root, 'link').map((l) => textContent(l))).toEqual(['Inbox']);
  });
});
