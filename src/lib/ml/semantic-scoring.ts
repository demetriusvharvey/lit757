import { embedTexts } from "./huggingface";

export type SemanticCandidate = {
  id: string;
  text: string;
};

export type SemanticScore = {
  id: string;
  score: number;
};

function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator ? dot / denominator : 0;
}

export async function scoreCandidatesSemantically(query: string, candidates: SemanticCandidate[]) {
  const cleanQuery = query.trim();
  const cleanCandidates = candidates
    .map((candidate) => ({ ...candidate, text: candidate.text.trim() }))
    .filter((candidate) => candidate.id && candidate.text)
    .slice(0, 50);

  if (!cleanQuery || !cleanCandidates.length) return [];
  const vectors = await embedTexts([cleanQuery, ...cleanCandidates.map((candidate) => candidate.text)]);
  const queryVector = vectors[0];
  if (!queryVector) return [];

  return cleanCandidates
    .map((candidate, index): SemanticScore => ({
      id: candidate.id,
      score: Number(cosineSimilarity(queryVector, vectors[index + 1] || []).toFixed(6)),
    }))
    .sort((left, right) => right.score - left.score);
}
