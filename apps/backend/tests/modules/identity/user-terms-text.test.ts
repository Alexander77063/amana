import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_TERMS_VERSION,
  PRINCIPAL_TERMS_VERSION,
} from '../../../src/modules/identity/user-consent.service';

/**
 * Binds each role's version constant to a document that exists, the same way
 * `vendor-terms-text.test.ts` does — because the failure it prevents already happened once:
 * `CURRENT_TERMS_VERSION` shipped enforcing a version that pointed at nothing, and every test
 * passed. A constant can point at nothing indefinitely; only a check like this makes the absence
 * visible.
 */
const LEGAL = join(__dirname, '../../../../..', 'docs/legal');

const CASES = [
  { role: 'principal', version: PRINCIPAL_TERMS_VERSION, dir: 'principal-terms' },
  { role: 'agent', version: AGENT_TERMS_VERSION, dir: 'agent-terms' },
] as const;

describe('user terms text', () => {
  for (const { role, version, dir } of CASES) {
    describe(role, () => {
      const path = join(LEGAL, dir, `${version}.md`);

      it('exists for the version the code enforces', () => {
        expect(existsSync(path), `no ${role} terms for ${version} at ${path}`).toBe(true);
      });

      it('names its own version', () => {
        expect(readFileSync(path, 'utf8')).toContain(version);
      });

      it('states the rights route and the regulator', () => {
        const text = readFileSync(path, 'utf8').toLowerCase();
        expect(text).toContain('support');
        expect(text).toContain('nigeria data protection');
      });
    });
  }

  // The disclosure this whole document set exists for. An agent whose location is recorded and
  // shown to the principal, with nothing telling them, is the product's most serious gap — so the
  // agent text must say it, and a future edit must not quietly drop it.
  it('the agent text discloses that location is visible to the funder', () => {
    const text = readFileSync(
      join(LEGAL, 'agent-terms', `${AGENT_TERMS_VERSION}.md`),
      'utf8',
    ).toLowerCase();
    expect(text).toContain('where you were');
    expect(text).toContain('can see');
  });

  // The principal is told the other side of the same fact, and told that the agent knows.
  it('the principal text says the agent is told what the principal can see', () => {
    const text = readFileSync(
      join(LEGAL, 'principal-terms', `${PRINCIPAL_TERMS_VERSION}.md`),
      'utf8',
    ).toLowerCase();
    expect(text).toContain('they are told');
  });

  // Amana is not a bank and does not hold the money; saying otherwise in a financial notice is the
  // kind of inaccuracy that matters most.
  it('the principal text does not claim Amana holds the money', () => {
    const text = readFileSync(
      join(LEGAL, 'principal-terms', `${PRINCIPAL_TERMS_VERSION}.md`),
      'utf8',
    ).toLowerCase();
    expect(text).toContain('amana is not a bank');
  });
});
