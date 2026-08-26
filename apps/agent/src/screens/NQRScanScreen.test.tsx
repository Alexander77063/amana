import { ApiError } from '@amana/api-client';
import type { CreateIntentInput } from '@amana/api-client';
import type { ComponentProps } from 'react';
import { type ReactTestInstance, act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allByType, flush, render, textContent } from '../../test/render';

/**
 * Shallow label/role queries.
 *
 * The shared `allByLabel`/`allByRole` helpers call `findAll`, which defaults to `deep: true` and so
 * counts BOTH the react-native mock's forwardRef wrapper and the host element it renders — every
 * accessible node comes back twice. `find` uses `deep: false`; these mirror that, so "exactly one
 * TRY AGAIN button" is a countable assertion rather than a coin flip on 1 vs 2.
 */
const propsOf = (n: ReactTestInstance): Record<string, unknown> =>
  (n.props ?? {}) as Record<string, unknown>;
const allByLabel = (root: ReactTestInstance, label: string): ReactTestInstance[] =>
  root.findAll((n) => propsOf(n).accessibilityLabel === label, { deep: false });
const allByRole = (root: ReactTestInstance, role: string): ReactTestInstance[] =>
  root.findAll((n) => propsOf(n).accessibilityRole === role, { deep: false });

// `expo-camera` is aliased to `test/mocks/expo-camera.tsx` in vitest.config.ts, the same way
// `react-native` and `@react-navigation/native` are — see that file for why not a vi.mock factory.

// `vi.mock` factories are hoisted above every import, so the spies they close over must be hoisted
// with them — a plain `const` declared above the factory is still in its TDZ when the factory runs.
const { vendorCode, nqrDecode } = vi.hoisted(() => ({ vendorCode: vi.fn(), nqrDecode: vi.fn() }));

vi.mock('../lib/api', () => ({ api: { vendor: { vendorCode, nqrDecode } } }));

vi.mock('../state/agent.store', () => {
  const state = { selectedSubWallet: { id: 'sw1', name: 'Driver', masterWalletId: 'mw1' } };
  const useAgentStore = Object.assign(
    (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
    { getState: () => state },
  );
  return { useAgentStore };
});

import { NQRScanScreen } from './NQRScanScreen';

const CODE = 'AMNV-7QK2H-9PZ0R';
const URL = `https://pay.amana.ng/v/${CODE}`;
const TLV = '26200008NG.NIBSS0103058';

const RESOLVED = {
  bankCode: '058',
  accountNumber: '0123456789',
  accountName: 'MAMA PUT KITCHEN',
  source: 'vendor_code',
  suggestedAmountKobo: null,
  vendorId: 'v-1',
  category: 'food',
};

function props(navigate = vi.fn()): ComponentProps<typeof NQRScanScreen> {
  return {
    navigation: { navigate },
    route: { params: undefined, key: 'k', name: 'NQRScan' },
  } as unknown as ComponentProps<typeof NQRScanScreen>;
}

/** Fire the camera's barcode callback, then let the resulting promises settle. */
async function scan(root: ReactTestInstance, data: string): Promise<void> {
  // Re-read the CameraView each time: `onBarcodeScanned` is deliberately `undefined` while busy.
  const cam = allByType(root, 'CameraView')[0];
  const handler = cam?.props.onBarcodeScanned as ((e: { data: string }) => void) | undefined;
  if (!handler) throw new Error('camera is not armed');
  await act(async () => {
    handler({ data });
  });
  await flush();
}

async function press(node: ReactTestInstance): Promise<void> {
  await act(async () => {
    (node.props.onPress as () => void)();
  });
  await flush();
}

const RETRY_LABEL = 'TRY AGAIN';

beforeEach(() => {
  vendorCode.mockReset();
  nqrDecode.mockReset();
});

describe('NQRScanScreen — one camera, two payload kinds', () => {
  it('sends an Amana URL to vendorCode() and never to the NQR decoder', async () => {
    vendorCode.mockResolvedValue(RESOLVED);
    const { root } = render(<NQRScanScreen {...props()} />);
    await scan(root, URL);

    expect(vendorCode).toHaveBeenCalledWith(CODE, 'sw1');
    expect(nqrDecode).not.toHaveBeenCalled();
  });

  it('sends a NIBSS TLV to nqrDecode() and never to the code endpoint', async () => {
    nqrDecode.mockResolvedValue({ ...RESOLVED, source: 'nqr', vendorId: null, category: null });
    const { root } = render(<NQRScanScreen {...props()} />);
    await scan(root, TLV);

    expect(nqrDecode).toHaveBeenCalledWith(TLV, 'sw1');
    expect(vendorCode).not.toHaveBeenCalled();
  });

  it('sends the scanned code VERBATIM — the server owns the fold', async () => {
    vendorCode.mockResolvedValue(RESOLVED);
    const { root } = render(<NQRScanScreen {...props()} />);
    await scan(root, 'https://pay.amana.ng/v/amnv-7qk2h-9pz0r');

    expect(vendorCode).toHaveBeenCalledWith('amnv-7qk2h-9pz0r', 'sw1');
  });

  it('carries vendorId and category into the Confirm route', async () => {
    vendorCode.mockResolvedValue(RESOLVED);
    const navigate = vi.fn();
    const { root } = render(<NQRScanScreen {...props(navigate)} />);
    await scan(root, URL);

    expect(navigate).toHaveBeenCalledWith('Confirm', {
      resolvedName: 'MAMA PUT KITCHEN',
      bankCode: '058',
      accountNumber: '0123456789',
      accountMasked: '****6789',
      vendorId: 'v-1',
      category: 'food',
    });
  });

  it('leaves vendorId and category null for an NQR scan', async () => {
    nqrDecode.mockResolvedValue({ ...RESOLVED, source: 'nqr', vendorId: null, category: null });
    const navigate = vi.fn();
    const { root } = render(<NQRScanScreen {...props(navigate)} />);
    await scan(root, TLV);

    expect(navigate.mock.calls[0]?.[1]).toMatchObject({ vendorId: null, category: null });
  });
});

describe('NQRScanScreen — the error ladder', () => {
  const fail = (status: number, code: string) => {
    vendorCode.mockRejectedValue(ApiError.fromResponse(status, { error: code }));
  };

  async function scanFailing(status: number, code: string) {
    fail(status, code);
    const { root } = render(<NQRScanScreen {...props()} />);
    await scan(root, URL);
    return root;
  }

  it('410 tells the payer the shop cannot be paid, and offers NO retry', async () => {
    const root = await scanFailing(410, 'VENDOR_SUSPENDED');
    expect(textContent(root)).toContain('cannot be paid through Amana right now');
    expect(allByLabel(root, RETRY_LABEL)).toHaveLength(0);
  });

  it('409 blames the shop’s bank account, and offers NO retry', async () => {
    const root = await scanFailing(409, 'VENDOR_ACCOUNT_GONE');
    expect(textContent(root)).toContain('bank account is closed');
    expect(allByLabel(root, RETRY_LABEL)).toHaveLength(0);
  });

  it('404 says it is not an Amana code — different copy from 410', async () => {
    const notFound = textContent(await scanFailing(404, 'NOT_FOUND'));
    vendorCode.mockReset();
    const suspended = textContent(await scanFailing(410, 'VENDOR_SUSPENDED'));

    expect(notFound).toContain('not an Amana code');
    expect(notFound).not.toContain('cannot be paid through Amana right now');
    expect(suspended).not.toContain('not an Amana code');
  });

  it('403 is terminal and does not claim the code is unknown', async () => {
    const root = await scanFailing(403, 'forbidden');
    expect(textContent(root)).toContain('Something went wrong with that scan');
    expect(textContent(root)).not.toContain('not an Amana code');
    expect(allByLabel(root, RETRY_LABEL)).toHaveLength(0);
  });

  it('502 offers a retry that re-issues the SAME lookup', async () => {
    vendorCode.mockRejectedValueOnce(
      ApiError.fromResponse(502, { error: 'VENDOR_ENQUIRY_FAILED' }),
    );
    vendorCode.mockResolvedValueOnce(RESOLVED);
    const navigate = vi.fn();
    const { root } = render(<NQRScanScreen {...props(navigate)} />);
    await scan(root, URL);

    expect(textContent(root)).toContain('could not reach our banking partner');
    const retry = allByLabel(root, RETRY_LABEL);
    expect(retry).toHaveLength(1);
    expect(retry[0]?.props.accessibilityRole).toBe('button');

    await press(retry[0] as ReactTestInstance);
    expect(vendorCode).toHaveBeenCalledTimes(2);
    expect(vendorCode).toHaveBeenNthCalledWith(2, CODE, 'sw1');
    expect(navigate).toHaveBeenCalledWith('Confirm', expect.objectContaining({ vendorId: 'v-1' }));
  });

  it('429 offers a retry and says to wait', async () => {
    const root = await scanFailing(429, 'rate_limited');
    expect(textContent(root)).toContain('Too many scans');
    expect(allByLabel(root, RETRY_LABEL)).toHaveLength(1);
  });

  it('announces the failure through an alert role', async () => {
    const root = await scanFailing(410, 'VENDOR_SUSPENDED');
    expect(allByRole(root, 'alert')).toHaveLength(1);
  });

  it('takes the camera down while the error is shown, so it cannot re-fire the dead code', async () => {
    const root = await scanFailing(410, 'VENDOR_SUSPENDED');
    expect(allByType(root, 'CameraView')).toHaveLength(0);
    expect(vendorCode).toHaveBeenCalledTimes(1);
  });

  it('offers a way back to the camera without retrying the dead code', async () => {
    const root = await scanFailing(410, 'VENDOR_SUSPENDED');
    const back = allByLabel(root, 'SCAN A DIFFERENT CODE');
    expect(back).toHaveLength(1);

    await press(back[0] as ReactTestInstance);
    expect(allByType(root, 'CameraView')).toHaveLength(1);
    expect(vendorCode).toHaveBeenCalledTimes(1);
  });

  it('does not borrow the code ladder’s copy for an NQR decode failure', async () => {
    nqrDecode.mockRejectedValue(ApiError.fromResponse(400, { error: 'BAD_INPUT' }));
    const { root } = render(<NQRScanScreen {...props()} />);
    await scan(root, TLV);

    expect(textContent(root)).toContain('could not read that QR code');
    expect(textContent(root)).not.toContain('Amana code');
  });
});

/**
 * `vendorId` is an OUTPUT. It rides the navigation params so the confirm screen can show a
 * verified badge, and it must never reach the spend intent: a client-chosen vendor id would let a
 * payer select which merchant's category rules get applied to their own spend. The server
 * re-resolves the vendor from the bank code and account number for exactly that reason.
 *
 * This is a compile-time assertion, checked by `pnpm --filter @amana/agent typecheck`: the day
 * `CreateIntentInput` grows a `vendorId`, this line goes red.
 */
type IntentAcceptsVendorId = 'vendorId' extends keyof CreateIntentInput ? true : false;
const INTENT_ACCEPTS_VENDOR_ID: IntentAcceptsVendorId = false;

describe('vendorId is output-only', () => {
  it('is absent from the spend-intent wire type', () => {
    expect(INTENT_ACCEPTS_VENDOR_ID).toBe(false);
  });
});
