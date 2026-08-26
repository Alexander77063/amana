import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient, AnchorHttpError } from '../../../src/integrations/anchor/client';
import { CircuitOpenError } from '../../../src/lib/circuit-breaker';
import { testDb, truncateAll } from '../../helpers/test-db';

/**
 * The circuit breaker exists to answer one question — is Anchor unwell? — and it is ONE
 * process-global breaker shared by name enquiry, transfers, VAS and virtual-account provisioning.
 * Before this, `breaker.exec` recorded a failure on any throw, so five
 * `GET /vendors/name-enquiry` calls with a garbage account number (five Anchor 404s, never
 * retried) reached `minSamples` at a failure rate of 1.0 and opened the breaker for 30s across
 * every Anchor call, real money transfers included — from one ordinary authenticated account,
 * repeatable forever. A total spend-path outage driven entirely by caller input.
 */

function buildClientWith(fetchImpl: typeof fetch): AnchorClient {
  return new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Production shape, but with `minSamples: 5` explicit so the count under test is visible here. */
const PROD_LIKE_CIRCUIT = {
  failureRateThreshold: 0.5,
  windowMs: 60_000,
  openMs: 30_000,
  minSamples: 5,
};

/**
 * The breaker's samples are private, so a single-sample circuit is the instrument that reads them:
 * `minSamples: 1` with `failureRateThreshold: 0` opens on the FIRST recorded failure (1.0 > 0) and
 * stays closed on a recorded success (0 > 0 is false). One call, then one probe, is then
 * unambiguous proof of which was recorded.
 */
const SINGLE_SAMPLE_CIRCUIT = {
  failureRateThreshold: 0,
  windowMs: 60_000,
  openMs: 30_000,
  minSamples: 1,
};

/** Retries are irrelevant to sample counting (one `execBreaker` = one sample) but not to speed. */
const FAST_RETRIES = [1, 1, 1, 1, 1, 1];

function buildAdapter(
  fetchImpl: typeof fetch,
  circuitConfig: typeof PROD_LIKE_CIRCUIT = PROD_LIKE_CIRCUIT,
): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: buildClientWith(fetchImpl),
    retryDelaysMs: FAST_RETRIES,
    circuitConfig,
  });
}

describe('AnchorAdapter: the breaker only trips on partner ill-health', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  /**
   * THE regression test. Note what it asserts second: not that the 404s came back as 404s, but
   * that an UNRELATED transfer still reaches the network afterwards. That is the blast radius the
   * defect actually had — one caller's bad input taking the whole payment path down — and it is
   * the assertion that fails when the classification is reverted.
   */
  it('five 404s do not open the breaker, and a real transfer still executes afterwards', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/nibss/name-enquiry')) return jsonResponse(404, { error: 'not_found' });
      return jsonResponse(200, { id: 't-1', status: 'COMPLETED' });
    }) as unknown as typeof fetch;
    const adapter = buildAdapter(fetchSpy);

    for (let i = 0; i < 5; i++) {
      await expect(
        adapter.nameEnquiry({ bankCode: '058', accountNumber: `00000000${i}` }),
      ).rejects.toBeInstanceOf(AnchorHttpError);
    }

    const transfer = await adapter.transfer(
      { amountKobo: 100n } as unknown as Parameters<AnchorAdapter['transfer']>[0],
      'idem-after-404s',
    );
    expect(transfer).toEqual({ id: 't-1', status: 'COMPLETED' });
  });

  it('five 500s still open the breaker — it has to keep working', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse(503, { error: 'down' })) as unknown as typeof fetch;
    const adapter = buildAdapter(fetchSpy);

    for (let i = 0; i < 5; i++) {
      await adapter
        .nameEnquiry({ bankCode: '058', accountNumber: `00000000${i}` })
        .catch(() => undefined);
    }

    await expect(
      adapter.nameEnquiry({ bankCode: '058', accountNumber: '000000009' }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('a 4xx still reaches the caller as AnchorHttpError, status and body intact', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(404, { error: 'account_not_found' }),
      ) as unknown as typeof fetch;
    const adapter = buildAdapter(fetchSpy);

    await expect(
      adapter.nameEnquiry({ bankCode: '058', accountNumber: '0123456789' }),
    ).rejects.toMatchObject({
      name: 'AnchorHttpError',
      status: 404,
      body: { error: 'account_not_found' },
    });
  });

  /**
   * 429 is the carve-out. It is a 4xx, but unlike a 404 no single request's payload produces it —
   * our aggregate volume does, which is exactly the load-shedding case a breaker is for.
   */
  it('429 DOES count as a failure — it is a volume signal, not bad input', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(429, { error: 'too_many_requests' }),
      ) as unknown as typeof fetch;
    const adapter = buildAdapter(fetchSpy, SINGLE_SAMPLE_CIRCUIT);

    await expect(
      adapter.nameEnquiry({ bankCode: '058', accountNumber: '0123456789' }),
    ).rejects.toBeInstanceOf(AnchorHttpError);
    await expect(
      adapter.nameEnquiry({ bankCode: '058', accountNumber: '0123456789' }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });

  /**
   * `findTransferByReference`'s old `try/catch` sat OUTSIDE `breaker.exec`, so the failure was
   * recorded before the 404 was ever converted to `null`. `reconciliationService.sweep` polls it
   * for every stuck in-flight spend — transfers Anchor may legitimately never have received — so
   * the platform was opening its own global breaker on a five-minute cron, no attacker involved.
   */
  it('findTransferByReference returns null on 404 and records no breaker failure', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/transfers/by-reference')) return jsonResponse(404, { error: 'unknown' });
      return jsonResponse(200, { id: 't-2', status: 'COMPLETED' });
    }) as unknown as typeof fetch;
    const adapter = buildAdapter(fetchSpy, SINGLE_SAMPLE_CIRCUIT);

    expect(await adapter.findTransferByReference('ref-never-sent')).toBeNull();

    // One recorded failure would already have opened this circuit. It has to still be closed.
    const transfer = await adapter.transfer(
      { amountKobo: 100n } as unknown as Parameters<AnchorAdapter['transfer']>[0],
      'idem-after-unknown-ref',
    );
    expect(transfer).toEqual({ id: 't-2', status: 'COMPLETED' });
  });

  it('findTransferByReference still propagates non-404 errors', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: 'forbidden' })) as unknown as typeof fetch;
    const adapter = buildAdapter(fetchSpy);

    await expect(adapter.findTransferByReference('ref-403')).rejects.toBeInstanceOf(
      AnchorHttpError,
    );
  });
});
