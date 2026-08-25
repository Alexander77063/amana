import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ConsensusConfig,
  type HouseholdCategoryCounts,
  computeConsensus,
} from '../../../src/modules/vendors/consensus';

const CFG: ConsensusConfig = {
  minHouseholds: 3,
  ratio: 0.6,
  sensitiveCategories: ['pharmacy', 'clinic'],
};

describe('computeConsensus', () => {
  it('returns null below the household floor', () => {
    const votes: HouseholdCategoryCounts[] = [{ food: 1 }, { food: 1 }];
    expect(computeConsensus(votes, CFG)).toEqual({ category: null, householdCount: 2 });
  });

  it('elects a unanimous category at the floor', () => {
    const votes: HouseholdCategoryCounts[] = [{ food: 1 }, { food: 1 }, { food: 1 }];
    expect(computeConsensus(votes, CFG)).toEqual({ category: 'food', householdCount: 3 });
  });

  it('ONE HOUSEHOLD, ONE VOTE — a frequent customer cannot outvote the others', () => {
    // 50 payments from one household vs one payment each from three others.
    const votes: HouseholdCategoryCounts[] = [
      { food: 50 },
      { transport: 1 },
      { transport: 1 },
      { transport: 1 },
    ];
    expect(computeConsensus(votes, CFG).category).toBe('transport');
  });

  it('uses each household modal category as its single vote', () => {
    const votes: HouseholdCategoryCounts[] = [
      { food: 9, transport: 1 }, // votes food
      { food: 1, transport: 9 }, // votes transport
      { transport: 4 }, // votes transport
      { transport: 2 }, // votes transport
    ];
    expect(computeConsensus(votes, CFG).category).toBe('transport');
  });

  it('returns null when no category clears the ratio', () => {
    const votes: HouseholdCategoryCounts[] = [
      { food: 1 },
      { transport: 1 },
      { airtime: 1 },
      { school: 1 },
    ];
    expect(computeConsensus(votes, CFG)).toEqual({ category: null, householdCount: 4 });
  });

  it('applies the ratio at its exact boundary', () => {
    // 3 of 5 = 0.6, which clears a 0.6 threshold.
    const at = [{ food: 1 }, { food: 1 }, { food: 1 }, { transport: 1 }, { airtime: 1 }];
    expect(computeConsensus(at, CFG).category).toBe('food');
    // 3 of 6 = 0.5, which does not.
    const below = [...at, { airtime: 1 }];
    expect(computeConsensus(below, CFG).category).toBeNull();
  });

  it('never derives a sensitive category, however strong the consensus', () => {
    const votes: HouseholdCategoryCounts[] = Array.from({ length: 20 }, () => ({ pharmacy: 1 }));
    expect(computeConsensus(votes, CFG)).toEqual({ category: null, householdCount: 20 });
  });

  it('ignores households that tagged nothing, and counts only voters', () => {
    const votes: HouseholdCategoryCounts[] = [{}, {}, { food: 1 }, { food: 1 }, { food: 1 }];
    expect(computeConsensus(votes, CFG)).toEqual({ category: 'food', householdCount: 3 });
  });

  it('breaks a tie deterministically rather than by object order', () => {
    const a = computeConsensus([{ zebra: 1 }, { apple: 1 }], {
      ...CFG,
      minHouseholds: 2,
      ratio: 0.5,
    });
    const b = computeConsensus([{ apple: 1 }, { zebra: 1 }], {
      ...CFG,
      minHouseholds: 2,
      ratio: 0.5,
    });
    expect(a.category).toBe(b.category);
    expect(a.category).toBe('apple');
  });

  describe('properties', () => {
    const arbCounts = fc.dictionary(
      fc.constantFrom('food', 'transport', 'airtime', 'school'),
      fc.integer({ min: 1, max: 100 }),
      { minKeys: 0, maxKeys: 4 },
    );

    it('scaling one household payment counts never changes the outcome', () => {
      fc.assert(
        fc.property(
          fc.array(arbCounts, { maxLength: 12 }),
          fc.integer({ min: 2, max: 50 }),
          (votes, k) => {
            if (votes.length === 0) return;
            const scaled = votes.map((v, i) =>
              i === 0 ? Object.fromEntries(Object.entries(v).map(([c, n]) => [c, n * k])) : v,
            );
            expect(computeConsensus(scaled, CFG)).toEqual(computeConsensus(votes, CFG));
          },
        ),
      );
    });

    it('always returns null or a category that some household actually tagged', () => {
      fc.assert(
        fc.property(fc.array(arbCounts, { maxLength: 12 }), (votes) => {
          const { category } = computeConsensus(votes, CFG);
          if (category === null) return;
          expect(votes.some((v) => Object.hasOwn(v, category))).toBe(true);
        }),
      );
    });

    it('is order-independent', () => {
      fc.assert(
        fc.property(fc.array(arbCounts, { maxLength: 12 }), (votes) => {
          expect(computeConsensus([...votes].reverse(), CFG)).toEqual(computeConsensus(votes, CFG));
        }),
      );
    });
  });
});
