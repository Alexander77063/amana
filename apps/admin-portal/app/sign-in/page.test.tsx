import { describe, expect, it } from 'vitest';
import { __setSearch } from '../../test/next.mock';
import { byRole, render, textContent } from '../../test/render';
import SignInPage from './page';

describe('sign-in', () => {
  it('links to the backend start route', () => {
    __setSearch('');
    const { root } = render(<SignInPage />);
    const link = byRole(root, 'link', 'Sign in with Google');
    expect(link.props.href).toBe('/admin/auth/start');
  });

  it('explains a failed sign-in without saying why', () => {
    __setSearch('error=sign_in_failed');
    const { root } = render(<SignInPage />);
    const text = textContent(root);
    expect(text).toContain("Sign-in didn't complete");
    expect(text).toContain('amana-ng.com');
    expect(text).not.toMatch(/not provisioned|suspended|domain/i);
  });
});
