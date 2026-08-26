import { describe, expectTypeOf, it } from 'vitest';
import type { ResolvedVendorResponse } from '../src/vendor-api';
import { VendorApi } from '../src/vendor-api';

/**
 * `ResolvedVendorResponse` is a hand-written structural mirror of the backend's `ResolvedVendor`
 * (`apps/backend/src/modules/vendors/types.ts`). The two are in different packages with no
 * dependency between them, so no compiler can prove they agree — the mirror silently drifted once
 * already, when SP-V3 Task 1 added `vendorId`, `category` and `source: 'vendor_code'` to the
 * backend type and four already-shipped endpoints started returning fields the client denied.
 *
 * These assertions are the substitute for that missing compiler link: they pin the mirror's exact
 * shape so a future edit to the backend type is a diff someone has to make here too, deliberately.
 * Keep them exhaustive — a `toMatchTypeOf` would let a dropped field pass.
 *
 * RUN THIS WITH `pnpm --filter @amana/api-client typecheck`, not `test` — CI runs it as part of
 * the repo-wide `pnpm typecheck`. Vitest never loads this file: `vitest.config.ts` includes only
 * `tests/**\/*.test.ts`, and enabling its `typecheck` option would be a downgrade, not a fix.
 * Vitest 2.1.2's experimental typechecker drops multi-line `tsc` diagnostics — measured on this
 * very file while the mirror was still out of sync, `tsc` reported all five errors and
 * `vitest --typecheck.only` reported three, marking the two `toEqualTypeOf` union assertions
 * below as PASSING. A green assertion over a wrong type is worse than no assertion at all.
 *
 * The gate is `tsconfig.typecheck.json`: `tsconfig.json` plus this file, and only this file. The
 * ordinary `*.test.ts` files pass loosely-typed `{ request: vi.fn(...) }` stubs where an
 * `AuthedClient` is expected and were never written to compile, so widening the glob would break
 * the build to no purpose. That config also widens `rootDir` from `./src` to `.` (otherwise these
 * tests sit outside it — TS6059) and turns `declaration` off, since it emits nothing.
 */
describe('ResolvedVendorResponse mirrors the backend ResolvedVendor', () => {
  it('carries the registry vendor id as a nullable string', () => {
    expectTypeOf<ResolvedVendorResponse['vendorId']>().toEqualTypeOf<string | null>();
  });

  it('carries the registry category as a nullable string', () => {
    expectTypeOf<ResolvedVendorResponse['category']>().toEqualTypeOf<string | null>();
  });

  it('admits vendor_code as a resolution source, alongside the four older paths', () => {
    expectTypeOf<ResolvedVendorResponse['source']>().toEqualTypeOf<
      'name_enquiry' | 'phone_lookup' | 'sticker' | 'nqr' | 'recents' | 'vendor_code'
    >();
  });

  /**
   * The whole shape in one assertion, and it has to be the whole shape rather than a list of
   * `keyof`s: a `keyof` pin names the fields but says nothing about their types or their optional
   * modifiers, so `suggestedAmountKobo?: string | null` slips past it — verified, that mutation
   * survived the `keyof` version of this test. An optional field is exactly the drift that hurts
   * here, because it makes a missing field on the wire look deliberate.
   */
  it('declares exactly the backend type’s shape — every field, type and modifier', () => {
    expectTypeOf<ResolvedVendorResponse>().toEqualTypeOf<{
      bankCode: string;
      accountNumber: string;
      accountName: string;
      source: 'name_enquiry' | 'phone_lookup' | 'sticker' | 'nqr' | 'recents' | 'vendor_code';
      suggestedAmountKobo: string | null;
      vendorId: string | null;
      category: string | null;
    }>();
  });
});

describe('VendorApi.vendorCode', () => {
  it('takes a code and a sub-wallet id and resolves to a ResolvedVendorResponse', () => {
    expectTypeOf(VendorApi.prototype.vendorCode).toEqualTypeOf<
      (code: string, subWalletId: string) => Promise<ResolvedVendorResponse>
    >();
  });
});
