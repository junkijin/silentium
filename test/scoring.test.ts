import { expect, test } from "bun:test";
import {
  calculateEffectiveStrength,
  calculateLexicalScore,
  calculateRecallScore,
  compareRecallCandidates,
} from "../src/memory/scoring";
import type { Memory, RecallCandidate, RecallQuery } from "../src/memory/types";
import { fixturePath, readJson } from "./support";

test("scoring is deterministic with a fixed clock", async () => {
  const memory = await readJson<Memory>(fixturePath("types", "valid-memory.json"));
  const query: RecallQuery = {
    text: "green tea",
    limit: 5,
  };
  const now = new Date("2026-03-28T00:00:00.000Z");

  expect(calculateEffectiveStrength(memory, now)).toBe(0.879444);
  expect(calculateLexicalScore(query, memory)).toBe(1);
  expect(calculateRecallScore(memory, query, now)).toEqual({
    lexicalScore: 1,
    effectiveStrength: 0.879444,
    recallScore: 0.810244,
    matchedTokens: ["green", "tea"],
  });
});

test("compareRecallCandidates applies deterministic tie-breakers", async () => {
  const memory = await readJson<Memory>(fixturePath("types", "valid-memory.json"));
  const left: RecallCandidate = {
    memory,
    lexicalScore: 1,
    effectiveStrength: 0.9,
    recallScore: 0.9,
    matchedTokens: ["tea"],
  };
  const right: RecallCandidate = {
    ...left,
    memory: {
      ...memory,
      id: "mem-002",
      updatedAt: "2026-03-26T00:00:00.000Z",
    },
  };

  expect(compareRecallCandidates(left, right)).toBeLessThan(0);
});
