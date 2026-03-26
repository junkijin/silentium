import { tokenizeForIndex } from "./tokenize";
import type { Memory, RecallCandidate, RecallQuery } from "./types";

const DEFAULT_HALF_LIFE_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}

export function calculateEffectiveStrength(
  memory: Memory,
  now: Date,
  options: { halfLifeDays?: number } = {},
): number {
  if (memory.status === "archived" || memory.status === "forgotten") {
    return 0;
  }

  const halfLifeDays = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const ageInDays =
    (now.getTime() - new Date(memory.updatedAt).getTime()) / MILLISECONDS_PER_DAY;
  const decay = Math.exp((-Math.max(0, ageInDays) * Math.log(2)) / halfLifeDays);

  return clamp(memory.strength * decay);
}

export function calculateLexicalScore(query: RecallQuery, memory: Memory): number {
  const queryTokens = tokenizeForIndex(
    [query.text, query.subject ?? "", query.type ?? ""].filter(Boolean).join(" "),
  );
  const memoryTokens = new Set(
    tokenizeForIndex([memory.subject, memory.content, ...memory.tags].join(" ")),
  );

  if (queryTokens.length === 0) {
    return 0;
  }

  const overlap = queryTokens.filter((token) => memoryTokens.has(token));
  const subjectBoost = tokenizeForIndex(memory.subject).some((token) => overlap.includes(token)) ? 0.1 : 0;

  return clamp(overlap.length / queryTokens.length + subjectBoost);
}

export function calculateRecallScore(
  memory: Memory,
  query: RecallQuery,
  now: Date,
): Omit<RecallCandidate, "memory"> {
  const lexicalScore = calculateLexicalScore(query, memory);
  const effectiveStrength = calculateEffectiveStrength(memory, now);
  const recallScore = Number(
    (lexicalScore * 0.45 + effectiveStrength * 0.35 + memory.importance * 0.2).toFixed(6),
  );
  const matchedTokens = tokenizeForIndex(query.text).filter((token) =>
    tokenizeForIndex([memory.subject, memory.content, ...memory.tags].join(" ")).includes(token),
  );

  return {
    lexicalScore,
    effectiveStrength,
    recallScore,
    matchedTokens,
  };
}

export function compareRecallCandidates(left: RecallCandidate, right: RecallCandidate): number {
  return (
    right.recallScore - left.recallScore ||
    right.memory.importance - left.memory.importance ||
    right.effectiveStrength - left.effectiveStrength ||
    right.memory.updatedAt.localeCompare(left.memory.updatedAt) ||
    left.memory.id.localeCompare(right.memory.id)
  );
}
