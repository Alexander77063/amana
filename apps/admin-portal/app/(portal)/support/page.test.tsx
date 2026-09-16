import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../lib/me';
import type { Me } from '../../../lib/types';
import { byLabel, byRole, change, flush, render, submit, textContent } from '../../../test/render';

vi.mock('../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../lib/api')>();
  return {
    ...real,
    api: {
      ...real.api,
      support: {
        start: vi.fn(),
        status: vi.fn(),
        confirmCode: vi.fn(),
        overview: vi.fn(),
        transactions: vi.fn(),
        rules: vi.fn(),
      },
    },
  };
});
import { api } from '../../../lib/api';
import SupportPage from './page';

const supportStaff: Me = {
  id: 'me',
  email: 'support@amana-ng.com',
  displayName: null,
  roles: ['support'],
  permissions: ['support.verify', 'support.read'],
};

const ops: Me = {
  id: 'me2',
  email: 'ops@amana-ng.com',
  displayName: null,
  roles: ['ops'],
  permissions: ['vendor.read'],
};

const mounted = (me: Me) =>
  render(
    <MeProvider me={me}>
      <SupportPage />
    </MeProvider>,
  ).root;

afterEach(() => {
  vi.clearAllMocks();
});

describe('support page', () => {
  it('shows the number to read aloud, and never a rail or decoys', async () => {
    vi.mocked(api.support.start).mockResolvedValue({ verificationId: 'v1', matchNumber: 47 });
    vi.mocked(api.support.status).mockResolvedValue({
      status: 'pending',
      expiresAt: new Date(Date.now() + 180_000).toISOString(),
      sessionExpiresAt: null,
    });

    const el = mounted(supportStaff);
    change(byLabel(el, 'The number the caller gives you'), '+2348012345678');
    submit(byRole(el, 'form', 'Start a verification'));
    await flush();

    const text = textContent(el);
    expect(text).toContain('47');
    expect(text).toContain('Waiting for them');
    // Copy must not state which rail was used — that leaks whether the app is installed.
    expect(text).not.toMatch(/\bpush\b/i);
    expect(text).not.toMatch(/\bsms\b/i);
  });

  it('tells the operator plainly what is never shown', async () => {
    const el = mounted(supportStaff);
    expect(textContent(el)).toContain('BVN');
    expect(textContent(el)).toContain('verification unlocks helping, not looking');
  });

  it('refuses the screen to someone without support.verify', async () => {
    const el = mounted(ops);
    expect(textContent(el)).toContain('You do not have the support role');
    expect(textContent(el)).not.toContain('The number the caller gives you');
  });

  it('surfaces a rate limit as a message rather than silence', async () => {
    const { ApiError } = await import('../../../lib/api');
    vi.mocked(api.support.start).mockRejectedValue(new ApiError(429, 'rate_limited', null));

    const el = mounted(supportStaff);
    change(byLabel(el, 'The number the caller gives you'), '+2348012345678');
    submit(byRole(el, 'form', 'Start a verification'));
    await flush();

    const text = textContent(el);
    expect(text).toMatch(/limit reached/i);
    // The operator must not be left thinking the caller caused it.
    expect(text).toContain('not the caller');
  });
});
