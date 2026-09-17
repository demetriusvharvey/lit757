/**
 * Pure relevance-merge step for ML-enhanced discovery.
 *
 * The invariant this module exists to protect: search relevance decides the
 * ORDER results appear in, never how busy a venue is reported to be. Canonical
 * activity fields (`score`, `confidence`, `heat`) pass through untouched.
 */

/** Below this the match is too weak to overwrite a venue's own ranking label. */
export const STRONG_MATCH_PERCENT = 60;

/** Canonical activity fields the relevance layer must never write to. */
export const CANONICAL_ACTIVITY_FIELDS = ["score", "confidence", "heat"] as const;

export type RelevanceInput = {
  semantic: number;
  rerank?: number;
  liveQuality: number;
};

export type MlMatch = {
  percent: number;
  semantic: number;
  reranked: number | null;
  vibe: string | null;
};

// NaN must collapse to the minimum rather than propagate. Math.min/Math.max
// pass NaN straight through, which would poison the relevance blend and make
// the final sort non-deterministic.
const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

export function combineRelevance({ semantic, rerank, liveQuality }: RelevanceInput) {
  return rerank === undefined
    ? semantic * 0.72 + liveQuality * 0.28
    : semantic * 0.42 + rerank * 0.38 + liveQuality * 0.2;
}

/**
 * No floor is applied. A weak match must be allowed to read as weak; flooring
 * it would make every result look like a good match.
 */
export function relevancePercent(combined: number) {
  return Math.round(clamp(combined * 100, 0, 99));
}

export function liveQualityOf(score: unknown) {
  return clamp(Number(score || 0) / 100, 0, 1);
}

export function buildMlMatch(
  input: RelevanceInput,
  vibe: string | undefined,
): MlMatch {
  return {
    percent: relevancePercent(combineRelevance(input)),
    semantic: Number(input.semantic.toFixed(3)),
    reranked: input.rerank === undefined ? null : Number(input.rerank.toFixed(3)),
    vibe: vibe || null,
  };
}

/**
 * Orders by relevance, then by canonical activity as the tiebreak.
 */
export function byRelevanceThenActivity(
  left: { mlMatch: MlMatch; score?: unknown },
  right: { mlMatch: MlMatch; score?: unknown },
) {
  return right.mlMatch.percent - left.mlMatch.percent
    || Number(right.score || 0) - Number(left.score || 0);
}
