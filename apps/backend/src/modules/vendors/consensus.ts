/** One household's self-attested category tally for one vendor: { "<category>": <payments> }. */
export type HouseholdCategoryCounts = Record<string, number>;

export type ConsensusConfig = {
  /** Minimum number of households that must have tagged anything at all. */
  minHouseholds: number;
  /** Fraction of votes the winner must hold, inclusive. */
  ratio: number;
  /** Categories that may never be derived from observation. */
  sensitiveCategories: readonly string[];
};

export type ConsensusResult = {
  category: string | null;
  /** How many households cast a vote — households that tagged nothing are not counted. */
  householdCount: number;
};

/** The single category one household stands behind: its most-tagged, ties broken alphabetically. */
function householdVote(counts: HouseholdCategoryCounts): string | null {
  let best: string | null = null;
  let bestN = 0;
  // Sorting the keys makes a tie resolve to the alphabetically first category rather than to
  // whatever order Postgres happened to serialise the jsonb object in. Without it the same data
  // could categorise a vendor differently on two different sweeps.
  for (const category of Object.keys(counts).sort()) {
    const n = counts[category] ?? 0;
    if (n > bestN) {
      best = category;
      bestN = n;
    }
  }
  return bestN > 0 ? best : null;
}

/**
 * Derive a vendor's category from its per-household observations.
 *
 * **One household, one vote.** A household that paid a vendor two hundred times counts exactly as
 * much as one that paid it once. Summing raw payment counts across households would let a single
 * frequent customer set a vendor's category by themselves — a five-household vendor with a
 * one-household category. That is the homogeneity failure l-diversity exists to prevent, and it is
 * the reason this function takes an array of per-household tallies rather than one merged tally.
 *
 * A sensitive category is never returned. Knowing a vendor is a clinic supports a health inference
 * about every household that pays it, so that assertion may only ever come from the business
 * itself (a claim) or from an operator — never from inference.
 */
export function computeConsensus(
  perHousehold: HouseholdCategoryCounts[],
  cfg: ConsensusConfig,
): ConsensusResult {
  const votes: string[] = [];
  for (const counts of perHousehold) {
    const vote = householdVote(counts);
    if (vote !== null) votes.push(vote);
  }

  const householdCount = votes.length;
  if (householdCount < cfg.minHouseholds) return { category: null, householdCount };

  const tally = new Map<string, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);

  let winner: string | null = null;
  let winnerN = 0;
  for (const category of [...tally.keys()].sort()) {
    const n = tally.get(category) ?? 0;
    if (n > winnerN) {
      winner = category;
      winnerN = n;
    }
  }

  if (winner === null || winnerN / householdCount < cfg.ratio) {
    return { category: null, householdCount };
  }
  // `sensitiveCategories` is lowercased once at env-parse time (env.ts), but `winner` is a raw
  // jsonb key copied verbatim from an app-supplied, unvalidated category string — so the
  // comparison must normalise casing too, or e.g. "Pharmacy" slips the block that "pharmacy" hits.
  if (cfg.sensitiveCategories.includes(winner.toLowerCase())) {
    return { category: null, householdCount };
  }
  return { category: winner, householdCount };
}
