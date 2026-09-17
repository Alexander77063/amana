import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../lib/me';
import type { Me, StuckTransaction } from '../../../lib/types';
import { byLabel, byRole, change, click, flush, render, textContent } from '../../../test/render';

vi.mock('../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../lib/api')>();
  return {
    ...real,
    api: {
      ...real.api,
      money: { stuck: vi.fn(), elevate: vi.fn(), resolve: vi.fn() },
    },
  };
});
import { api } from '../../../lib/api';
import MoneyPage from './page';

const owner: Me = {
  id: 'me',
  email: 'owner@amana-ng.com',
  displayName: null,
  roles: ['owner'],
  permissions: ['money.operate', 'iam.read'],
};

const adminUser: Me = {
  id: 'me2',
  email: 'admin@amana-ng.com',
  displayName: null,
  roles: ['admin'],
  permissions: ['iam.read', 'iam.write'],
};

const oneStuck: StuckTransaction[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    kind: 'spend',
    amountKobo: '500000',
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    vendorResolvedName: 'Mama Put Kitchen',
  },
];

const oneStuckPayout: StuckTransaction[] = [
  {
    id: '22222222-2222-2222-2222-222222222222',
    kind: 'redemption',
    amountKobo: '1234500',
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    vendorResolvedName: null,
  },
];

const mounted = (me: Me) =>
  render(
    <MeProvider me={me}>
      <MoneyPage />
    </MeProvider>,
  ).root;

afterEach(() => {
  vi.clearAllMocks();
});

describe('money page', () => {
  it('lists stuck transactions with the amount and who they were going to', async () => {
    vi.mocked(api.money.stuck).mockResolvedValue({ transactions: oneStuck });

    const el = mounted(owner);
    await flush();

    const text = textContent(el);
    expect(text).toContain('Mama Put Kitchen');
    expect(text).toContain('5,000.00');
  });

  // The whole design: Anchor decides the outcome, the operator authorises the attempt.
  it('never offers a choice between settling and reversing', async () => {
    vi.mocked(api.money.stuck).mockResolvedValue({ transactions: oneStuck });

    const el = mounted(owner);
    await flush();

    const text = textContent(el);
    expect(text).not.toMatch(/mark as settled/i);
    expect(text).not.toMatch(/force settle/i);
    expect(text).toMatch(/Anchor decides/i);
  });

  // A failed customer payment refunds the customer; a failed retailer payout does not. An operator
  // cannot follow the runbook without being able to tell which row is which.
  it('distinguishes a retailer payout from a customer payment', async () => {
    vi.mocked(api.money.stuck).mockResolvedValue({ transactions: oneStuckPayout });

    const el = mounted(owner);
    await flush();

    const text = textContent(el);
    expect(text).toContain('Retailer payout');
    expect(text).toMatch(/pay this retailer another way/i);
  });

  it('refuses the screen to someone without money.operate', async () => {
    const el = mounted(adminUser);
    await flush();

    expect(textContent(el)).toContain('You do not have money operations access');
    expect(api.money.stuck).not.toHaveBeenCalled();
  });

  it('will not submit an elevation until a real reason is typed', async () => {
    vi.mocked(api.money.stuck).mockResolvedValue({ transactions: oneStuck });

    const el = mounted(owner);
    await flush();
    click(byRole(el, 'button', 'Elevate'));
    await flush();

    const submitButton = byRole(el, 'button', 'Raise elevation');
    expect(submitButton.props.disabled).toBe(true);

    change(byLabel(el, 'Why are you doing this?'), 'customer called about this payment');
    await flush();
    expect(byRole(el, 'button', 'Raise elevation').props.disabled).toBe(false);
  });

  // An Anchor outage is the one refusal where retrying is the wrong instinct.
  it('tells the operator to check Anchor rather than retry when Anchor is unreachable', async () => {
    const { ApiError } = await import('../../../lib/api');
    vi.mocked(api.money.stuck).mockResolvedValue({ transactions: oneStuck });
    vi.mocked(api.money.resolve).mockRejectedValue(new ApiError(503, 'anchor_unreachable', null));

    const el = mounted(owner);
    await flush();
    click(byRole(el, 'button', 'Resolve'));
    await flush();

    const text = textContent(el);
    expect(text).toMatch(/could not reach Anchor/i);
    expect(text).toMatch(/do not retry/i);
  });

  it('explains an elevation refusal specifically, not as a generic permission error', async () => {
    const { ApiError } = await import('../../../lib/api');
    vi.mocked(api.money.stuck).mockResolvedValue({ transactions: oneStuck });
    vi.mocked(api.money.resolve).mockRejectedValue(new ApiError(403, 'elevation_required', null));

    const el = mounted(owner);
    await flush();
    click(byRole(el, 'button', 'Resolve'));
    await flush();

    const text = textContent(el);
    expect(text).toMatch(/needs a live elevation/i);
    // The generic 403 copy would be wrong and unhelpful here.
    expect(text).not.toContain("You don't have permission for that.");
  });

  it('reports the outcome Anchor produced', async () => {
    vi.mocked(api.money.stuck).mockResolvedValue({ transactions: oneStuck });
    vi.mocked(api.money.resolve).mockResolvedValue({ outcome: 'reversed' });

    const el = mounted(owner);
    await flush();
    click(byRole(el, 'button', 'Resolve'));
    await flush();

    expect(textContent(el)).toMatch(/returned to the customer/i);
  });
});
