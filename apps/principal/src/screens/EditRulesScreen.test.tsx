import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { byLabel, render, textContent } from '../../test/render';

const h = vi.hoisted(() => ({
  publishRules: vi.fn().mockResolvedValue(undefined),
  rules: null as { rules: Array<{ kind: string; configJson: unknown }> } | null,
}));

vi.mock('../state/subwallets.store', () => ({
  useSubWalletsStore: (sel: (s: unknown) => unknown) =>
    sel({
      rulesById: { sw1: h.rules },
      busy: false,
      errorCode: null,
      refreshRules: () => Promise.resolve(),
      publishRules: h.publishRules,
    }),
}));

import { EditRulesScreen } from './EditRulesScreen';

function props(): ComponentProps<typeof EditRulesScreen> {
  return {
    navigation: { navigate: vi.fn(), goBack: vi.fn() },
    route: { params: { subWalletId: 'sw1' }, key: 'k', name: 'EditRules' },
  } as unknown as ComponentProps<typeof EditRulesScreen>;
}

describe('EditRulesScreen', () => {
  it('offers the daily limit, category lock and time window controls', () => {
    h.rules = null;
    const { root } = render(<EditRulesScreen {...props()} />);
    const text = textContent(root);

    expect(byLabel(root, 'AMOUNT (₦)')).toBeTruthy();
    expect(text).toContain('CATEGORY LOCK');
    expect(text).toContain('TIME WINDOW');
    expect(text).toContain('PUBLISH RULES');
  });

  it('hides the category picker until a lock mode is chosen', () => {
    h.rules = null;
    const { root } = render(<EditRulesScreen {...props()} />);
    // "Any" is the default, so the individual categories should not be on screen yet.
    expect(textContent(root)).not.toContain('Airtime & data');
    expect(byLabel(root, 'Only these')).toBeTruthy();
  });

  it('seeds the form from the published rule set, including category and time window', () => {
    h.rules = {
      rules: [
        { kind: 'limit', configJson: { windowKind: 'daily', maxKobo: '2500000' } },
        { kind: 'category', configJson: { mode: 'allowlist', categories: ['transport'] } },
        {
          kind: 'time_window',
          configJson: { startHour: 7, endHour: 19, daysOfWeek: [1, 2, 3, 4, 5] },
        },
      ],
    };
    const { root } = render(<EditRulesScreen {...props()} />);
    const text = textContent(root);

    // 2,500,000 kobo = ₦25,000. It lives in the input's value, not in rendered text.
    expect(byLabel(root, 'AMOUNT (₦)')?.props.value).toBe('25000');
    // Category mode was restored, so the individual categories are visible.
    expect(text).toContain('Transport');
    // Hours are shown on a 12-hour clock, and explicitly as Lagos time.
    expect(text).toContain('7am');
    expect(text).toContain('7pm');
    expect(text).toContain('Lagos time');
  });

  it('states that rules are enforced before money moves', () => {
    h.rules = null;
    const { root } = render(<EditRulesScreen {...props()} />);
    expect(textContent(root)).toContain('before any money moves');
  });
});
