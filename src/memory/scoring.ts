import { normalizeLooseToken, normalizeSubject, tokenizeForIndex } from "./tokenize";
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
  const subjectTokens = tokenizeForIndex(memory.subject);
  const contentTokens = tokenizeForIndex(memory.content);
  const tagTokens = tokenizeForIndex(memory.tags.join(" "));
  const subjectSet = new Set(subjectTokens.map((token) => normalizeLooseToken(token)));
  const contentSet = new Set(contentTokens.map((token) => normalizeLooseToken(token)));
  const tagSet = new Set(tagTokens.map((token) => normalizeLooseToken(token)));

  if (queryTokens.length === 0) {
    return 0;
  }

  let weightedOverlap = 0;

  for (const token of queryTokens) {
    const normalizedToken = normalizeLooseToken(token);

    if (subjectSet.has(normalizedToken)) {
      weightedOverlap += 1.35;
      continue;
    }

    if (tagSet.has(normalizedToken)) {
      weightedOverlap += 1.1;
      continue;
    }

    if (contentSet.has(normalizedToken)) {
      weightedOverlap += 1;
    }
  }

  const lexical = weightedOverlap / queryTokens.length;
  const exactSubjectBoost =
    query.subject && normalizeSubject(query.subject) === normalizeSubject(memory.subject) ? 0.12 : 0;

  return clamp(lexical + exactSubjectBoost);
}

export function calculateRecallScore(
  memory: Memory,
  query: RecallQuery,
  now: Date,
): Omit<RecallCandidate, "memory"> {
  const queryTokens = tokenizeForIndex(
    [query.text, query.subject ?? "", query.type ?? ""].filter(Boolean).join(" "),
  );
  const lexicalScore = calculateLexicalScore(query, memory);
  const effectiveStrength = calculateEffectiveStrength(memory, now);
  const subjectTokens = tokenizeForIndex(memory.subject);
  const subjectCoverage =
    subjectTokens.length === 0 ? 0 : subjectTokens.filter((token) => queryTokens.includes(token)).length / subjectTokens.length;
  const typeIntentBoost = queryTokens.includes(memory.type) ? 0.14 : 0;
  const subjectIntentBoost = subjectCoverage === 1 ? 0.1 : subjectCoverage * 0.06;
  const recallScore = Number(
    (
      lexicalScore * 0.42 +
      effectiveStrength * 0.28 +
      memory.importance * 0.18 +
      typeIntentBoost +
      subjectIntentBoost
    ).toFixed(6),
  );
  const normalizedQueryTokens = new Set(tokenizeForIndex(query.text).map((token) => normalizeLooseToken(token)));
  const matchedTokens = tokenizeForIndex([memory.subject, memory.content, ...memory.tags].join(" ")).filter(
    (token) => normalizedQueryTokens.has(normalizeLooseToken(token)),
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
