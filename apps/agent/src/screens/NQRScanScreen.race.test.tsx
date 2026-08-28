import type { ComponentProps } from 'react';
import { type ReactTestInstance, act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireFocus } from '../../test/mocks/react-navigation-native';
import { allByType, flush, render, textContent } from '../../test/render';

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
const URL = `https://pay.amana-ng.com/v/${CODE}`;

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

const camera = (root: ReactTestInstance) => allByType(root, 'CameraView')[0];

beforeEach(() => {
  vendorCode.mockReset();
  nqrDecode.mockReset();
});

/**
 * `expo-camera` drives `onBarcodeScanned` from the native emitter, several times a second, at a
 * sticker the payer is holding the phone steady against. The handler is a CLOSURE captured at
 * render, so a `busy` STATE guard inside it reads the value from the render that installed it: two
 * events arriving before React can re-render both see `busy === false`, and both proceed.
 *
 * The cost is not theoretical. Each duplicate is a second rate-limited lookup against a paid
 * partner call, on the very code path whose whole design rationale was not spending one per
 * mis-scan — and it pushes `Confirm` onto the stack twice.
 */
describe('NQRScanScreen — one sticker, one lookup', () => {
  it('resolves ONCE when the camera fires twice in a single tick', async () => {
    vendorCode.mockResolvedValue(RESOLVED);
    const navigate = vi.fn();
    const { root } = render(<NQRScanScreen {...props(navigate)} />);

    // Grab the handler ONCE and call it twice, with no re-render in between. Re-reading it (as the
    // other suite's `scan` helper does) would pick up the post-setState render and hide the race.
    const handler = camera(root)?.props.onBarcodeScanned as (e: { data: string }) => void;
    expect(handler).toBeTruthy();
    await act(async () => {
      handler({ data: URL });
      handler({ data: URL });
    });
    await flush();

    expect(vendorCode).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('holds the lock across a burst of five events', async () => {
    vendorCode.mockResolvedValue(RESOLVED);
    const { root } = render(<NQRScanScreen {...props()} />);
    const handler = camera(root)?.props.onBarcodeScanned as (e: { data: string }) => void;
    await act(async () => {
      for (let i = 0; i < 5; i++) handler({ data: URL });
    });
    await flush();

    expect(vendorCode).toHaveBeenCalledTimes(1);
  });

  it('releases the lock so a later, deliberate scan still works', async () => {
    vendorCode.mockRejectedValueOnce(new Error('boom'));
    vendorCode.mockResolvedValueOnce(RESOLVED);
    const { root } = render(<NQRScanScreen {...props()} />);

    const first = camera(root)?.props.onBarcodeScanned as (e: { data: string }) => void;
    await act(async () => {
      first({ data: URL });
    });
    await flush();

    // Back on the camera after the failure, a fresh scan must not be swallowed by a stuck lock.
    const back = root.findAll(
      (n) =>
        (n.props as { accessibilityLabel?: string }).accessibilityLabel === 'SCAN A DIFFERENT CODE',
      { deep: false },
    )[0];
    await act(async () => {
      (back?.props.onPress as () => void)();
    });
    await flush();

    const second = camera(root)?.props.onBarcodeScanned as (e: { data: string }) => void;
    await act(async () => {
      second({ data: URL });
    });
    await flush();

    expect(vendorCode).toHaveBeenCalledTimes(2);
  });
});

/**
 * A native stack keeps this screen mounted underneath `Confirm`. Backing out of `Confirm` is a
 * focus event, not a remount, so any state left set at navigation time is still set — and `busy`
 * with no `failure` renders the armed camera UNDER a dark overlay and "Resolving vendor…", with no
 * button on it. It reads as a request that never finished, and the only way out is leaving the Pay
 * stack entirely.
 */
describe('NQRScanScreen — coming back from Confirm', () => {
  it('clears the resolving overlay when the payer returns', async () => {
    vendorCode.mockResolvedValue(RESOLVED);
    const { root } = render(<NQRScanScreen {...props()} />);
    const handler = camera(root)?.props.onBarcodeScanned as (e: { data: string }) => void;
    await act(async () => {
      handler({ data: URL });
    });
    await flush();

    // Still spinning: we navigated away and never reset.
    expect(textContent(root)).toContain('Resolving vendor…');

    await act(async () => {
      fireFocus();
    });
    await flush();

    expect(textContent(root)).not.toContain('Resolving vendor…');
  });

  it('re-arms the camera on return, so the next sticker scans', async () => {
    vendorCode.mockResolvedValue(RESOLVED);
    const { root } = render(<NQRScanScreen {...props()} />);
    const handler = camera(root)?.props.onBarcodeScanned as (e: { data: string }) => void;
    await act(async () => {
      handler({ data: URL });
    });
    await flush();
    await act(async () => {
      fireFocus();
    });
    await flush();

    expect(camera(root)?.props.onBarcodeScanned).toBeTruthy();
  });

  it('clears a stale failure too, rather than greeting the payer with the last error', async () => {
    vendorCode.mockRejectedValue(new Error('boom'));
    const { root } = render(<NQRScanScreen {...props()} />);
    const handler = camera(root)?.props.onBarcodeScanned as (e: { data: string }) => void;
    await act(async () => {
      handler({ data: URL });
    });
    await flush();
    expect(allByType(root, 'CameraView')).toHaveLength(0);

    await act(async () => {
      fireFocus();
    });
    await flush();

    expect(allByType(root, 'CameraView')).toHaveLength(1);
  });
});

/**
 * NQR tag 54 carries an amount the vendor already typed into their own terminal. Making the payer
 * re-key a figure that arrived in the payload is the error the backend's Kobo serialization fix
 * (99faccb) exists to prevent, and it only pays off if the client forwards the value.
 */
describe('NQRScanScreen — the suggested amount', () => {
  it('carries suggestedAmountKobo into the Confirm route', async () => {
    nqrDecode.mockResolvedValue({
      ...RESOLVED,
      source: 'nqr',
      vendorId: null,
      category: null,
      suggestedAmountKobo: '200000',
    });
    const navigate = vi.fn();
    const { root } = render(<NQRScanScreen {...props(navigate)} />);
    const handler = camera(root)?.props.onBarcodeScanned as (e: { data: string }) => void;
    await act(async () => {
      handler({ data: '26200008NG.NIBSS0103058' });
    });
    await flush();

    expect(navigate.mock.calls[0]?.[1]).toMatchObject({ suggestedAmountKobo: '200000' });
  });

  it('passes null through when the QR carried no amount', async () => {
    vendorCode.mockResolvedValue(RESOLVED);
    const navigate = vi.fn();
    const { root } = render(<NQRScanScreen {...props(navigate)} />);
    const handler = camera(root)?.props.onBarcodeScanned as (e: { data: string }) => void;
    await act(async () => {
      handler({ data: URL });
    });
    await flush();

    expect(navigate.mock.calls[0]?.[1]).toMatchObject({ suggestedAmountKobo: null });
  });
});
