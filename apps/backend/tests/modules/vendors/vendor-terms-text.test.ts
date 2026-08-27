import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CURRENT_TERMS_VERSION } from '../../../src/modules/vendors/vendor-consent.service';

/**
 * The constant and the document must not be able to drift apart.
 *
 * `CURRENT_TERMS_VERSION` shipped before any text existed — the claim rail enforced acceptance of a
 * version that pointed at nothing, which is a lawful basis on paper and none in fact. This binds the
 * two: bumping the constant without writing the text fails here, and so does deleting or renaming
 * the text under a live constant.
 *
 * It reads the repository rather than a bundled asset deliberately. The text is a legal document
 * whose review lives in version control, and a test that stubbed it would pass while the real thing
 * was missing.
 */
const TERMS_DIR = join(__dirname, '../../../../..', 'docs/legal/vendor-claim-terms');

describe('vendor terms text', () => {
  const path = join(TERMS_DIR, `${CURRENT_TERMS_VERSION}.md`);

  it('exists for the version the code enforces', () => {
    expect(existsSync(path), `no terms document for ${CURRENT_TERMS_VERSION} at ${path}`).toBe(
      true,
    );
  });

  it('names its own version, so a copied file cannot silently serve as another', () => {
    expect(readFileSync(path, 'utf8')).toContain(CURRENT_TERMS_VERSION);
  });

  it('covers the consent the code treats as optional and separate', () => {
    const text = readFileSync(path, 'utf8').toLowerCase();
    // Not a style check: NDPA consent must be specific and informed, so the optional purpose has to
    // be described in the text a merchant accepts — not only in the API field name.
    expect(text).toContain('lender');
    expect(text).toContain('withdraw');
  });

  it('states how to exercise rights, including the ops-only withdrawal limitation', () => {
    const text = readFileSync(path, 'utf8').toLowerCase();
    // Withdrawal is support-mediated until a self-serve path exists. A notice that implied
    // otherwise would be inaccurate, and inaccuracy in a privacy notice is the failure mode here.
    expect(text).toContain('support');
    expect(text).toContain('nigeria data protection');
  });
});
