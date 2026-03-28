import { expect, test } from "bun:test";
import { createSequenceClock, createTempRoot, createTestMemoryService } from "./support";

test("recall prefers exact subject memory over note-like distractors", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  const target = await service.remember({
    type: "preference",
    subject: "alice",
    content: "Alice prefers green tea every morning",
    tags: ["tea", "morning"],
    importance: 0.72,
    strength: 0.63,
  });

  await service.remember({
    type: "fact",
    subject: "team-notes",
    content: "Alice morning tea preference was captured in notes",
    tags: ["tea", "morning"],
    importance: 0.78,
    strength: 0.7,
  });

  const result = await service.recall({
    text: "alice tea morning preference",
    limit: 3,
  });

  expect(result.candidates[0]?.memory.id).toBe(target.id);
});

test("recall uses type intent in natural-language queries", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  const target = await service.remember({
    type: "episode",
    subject: "dana",
    content: "Dana visited Jeju during the spring retreat",
    tags: ["travel", "jeju"],
    importance: 0.76,
    strength: 0.67,
  });

  await service.remember({
    type: "fact",
    subject: "travel-summary",
    content: "Dana has a recurring Jeju travel plan in the notes",
    tags: ["travel", "jeju"],
    importance: 0.8,
    strength: 0.73,
  });

  const result = await service.recall({
    text: "dana jeju travel episode",
    limit: 3,
  });

  expect(result.candidates[0]?.memory.id).toBe(target.id);
});

test("recall boosts newer memory for current-state questions", async () => {
  const root = await createTempRoot();
  let index = 0;
  const offsets = [
    "2026-01-01T00:00:00.000Z",
    "2026-02-01T00:00:00.000Z",
    "2026-03-01T00:00:00.000Z",
  ];
  const service = await createTestMemoryService(root, () => new Date(offsets[Math.min(index++, offsets.length - 1)]));
  await service.remember({
    type: "fact",
    subject: "alice-home",
    content: "Alice currently lives in Busan at her home address",
    tags: ["home", "busan", "current"],
    importance: 0.82,
    strength: 0.82,
  });
  const target = await service.remember({
    type: "fact",
    subject: "alice-home",
    content: "Alice moved to Seoul",
    tags: ["home", "seoul"],
    importance: 0.78,
    strength: 0.78,
  });

  const result = await service.recall({
    text: "where does alice live now current home",
    limit: 3,
  });

  expect(result.candidates[0]?.memory.id).toBe(target.id);
});

test("recall surfaces bridge memory for two-hop relation queries", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  await service.remember({
    type: "fact",
    subject: "mina",
    content: "Mina's spouse is Joon",
    tags: ["spouse", "joon"],
    importance: 0.8,
    strength: 0.8,
  });
  const target = await service.remember({
    type: "fact",
    subject: "joon",
    content: "Joon lives in Incheon",
    tags: ["incheon", "home"],
    importance: 0.81,
    strength: 0.8,
  });
  await service.remember({
    type: "fact",
    subject: "mina",
    content: "Mina prefers ramen",
    tags: ["ramen"],
    importance: 0.63,
    strength: 0.62,
  });

  const result = await service.recall({
    text: "where does mina's spouse live",
    limit: 3,
  });

  expect(result.candidates.slice(0, 2).map((candidate) => candidate.memory.id)).toContain(target.id);
});

test("recall prioritizes preference constraints over episodic trip noise", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  const budget = await service.remember({
    type: "preference",
    subject: "trip-budget",
    content: "Keep the hotel under 200 dollars per night",
    tags: ["hotel", "budget", "200"],
    importance: 0.82,
    strength: 0.8,
  });
  const seat = await service.remember({
    type: "preference",
    subject: "trip-seat",
    content: "Prefer aisle seats on flights",
    tags: ["flight", "aisle", "seat"],
    importance: 0.8,
    strength: 0.8,
  });
  const chain = await service.remember({
    type: "preference",
    subject: "trip-chain",
    content: "Prefer Marriott hotels when possible",
    tags: ["hotel", "marriott"],
    importance: 0.78,
    strength: 0.78,
  });
  await service.remember({
    type: "episode",
    subject: "trip-noise",
    content: "A noisy hostel ruined the last trip",
    tags: ["hotel", "noise"],
    importance: 0.68,
    strength: 0.65,
  });

  const result = await service.recall({
    text: "what constraints should you remember for my trip booking hotel and flight",
    limit: 4,
  });

  expect(result.candidates.slice(0, 3).map((candidate) => candidate.memory.id).sort()).toEqual([
    budget.id,
    chain.id,
    seat.id,
  ].sort());
});

test("recall can surface a three-hop relational target above anchor memories", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  await service.remember({
    type: "fact",
    subject: "project-a",
    content: "Project A owner is Mina",
    tags: ["owner", "mina"],
    importance: 0.86,
    strength: 0.85,
  });
  await service.remember({
    type: "fact",
    subject: "mina",
    content: "Mina reports to Joon",
    tags: ["manager", "joon"],
    importance: 0.85,
    strength: 0.84,
  });
  const target = await service.remember({
    type: "fact",
    subject: "joon",
    content: "Joon works in the security team",
    tags: ["security", "team"],
    importance: 0.84,
    strength: 0.84,
  });

  const result = await service.recall({
    text: "what team does the owner of project a report to",
    limit: 5,
  });

  expect(result.candidates[0]?.memory.id).toBe(target.id);
});

test("recall abstains when only favorite-style generic overlap exists", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  await service.remember({
    type: "preference",
    subject: "alice-drink",
    content: "Alice's favorite drink is green tea",
    tags: ["favorite", "drink", "tea"],
    importance: 0.8,
    strength: 0.79,
  });
  await service.remember({
    type: "preference",
    subject: "alice-seat",
    content: "Alice's favorite airline seat is aisle",
    tags: ["favorite", "seat", "aisle"],
    importance: 0.78,
    strength: 0.77,
  });

  const result = await service.recall({
    text: "what is alice's favorite database engine",
    limit: 3,
  });

  expect(result.candidates).toHaveLength(0);
});

test("recall handles boss and org wording for multi-hop relation queries", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  await service.remember({
    type: "fact",
    subject: "alice",
    content: "Alice's manager is Dana",
    tags: ["manager", "dana"],
    importance: 0.83,
    strength: 0.82,
  });
  const target = await service.remember({
    type: "fact",
    subject: "dana",
    content: "Dana works in the platform team",
    tags: ["platform", "team"],
    importance: 0.82,
    strength: 0.81,
  });
  await service.remember({
    type: "fact",
    subject: "alice",
    content: "Alice likes noodles",
    tags: ["food", "noodles"],
    importance: 0.63,
    strength: 0.62,
  });

  const result = await service.recall({
    text: "which org does alice's boss belong to",
    limit: 3,
  });

  expect(result.candidates[0]?.memory.id).toBe(target.id);
});

test("recall prefers explicit latest cue over incidental newer episode noise", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(
    root,
    createSequenceClock([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
    ]),
  );
  await service.remember({
    type: "episode",
    subject: "alice",
    content: "Alice visited Busan before Jeju",
    tags: ["travel", "busan", "jeju"],
    importance: 0.78,
    strength: 0.77,
  });
  const target = await service.remember({
    type: "episode",
    subject: "alice",
    content: "Alice visited Jeju on the latest trip",
    tags: ["travel", "jeju", "latest"],
    importance: 0.8,
    strength: 0.79,
  });
  await service.remember({
    type: "episode",
    subject: "alice",
    content: "Alice visited an unrelated stopover before both trips",
    tags: ["travel", "stopover"],
    importance: 0.65,
    strength: 0.64,
  });

  const result = await service.recall({
    text: "where did alice visit on the latest trip",
    type: "episode",
    limit: 3,
  });

  expect(result.candidates[0]?.memory.id).toBe(target.id);
});

test("recall prefers directed after relation over fresher before distractor", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(
    root,
    createSequenceClock([
      "2026-01-01T00:00:00.000Z",
      "2026-01-31T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
    ]),
  );
  await service.remember({
    type: "episode",
    subject: "alice",
    content: "Alice visited Jeju after Busan",
    tags: ["travel", "jeju", "busan"],
    importance: 0.72,
    strength: 0.72,
  });
  const target = await service.remember({
    type: "episode",
    subject: "alice",
    content: "Alice visited Daegu after Jeju",
    tags: ["travel", "daegu", "jeju"],
    importance: 0.74,
    strength: 0.74,
  });
  await service.remember({
    type: "episode",
    subject: "alice",
    content: "Alice visited Busan before Jeju",
    tags: ["travel", "busan", "jeju"],
    importance: 0.7,
    strength: 0.7,
  });

  const result = await service.recall({
    text: "where did alice go after jeju",
    type: "episode",
    limit: 3,
  });

  expect(result.candidates[0]?.memory.id).toBe(target.id);
});

test("recall keeps alias anchor and final answer in the top two results", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(
    root,
    createSequenceClock(
      Array.from({ length: 40 }, (_, index) =>
        new Date(Date.parse("2025-01-01T00:00:00.000Z") + index * 86_400_000).toISOString(),
      ),
    ),
  );
  const alias = await service.remember({
    type: "fact",
    subject: "project-a",
    content: "The bluebird launch refers to Project A",
    tags: ["bluebird", "launch"],
    importance: 0.85,
    strength: 0.85,
  });
  await service.remember({
    type: "fact",
    subject: "project-a",
    content: "Project A owner is Mina",
    tags: ["owner", "mina"],
    importance: 0.84,
    strength: 0.84,
  });
  await service.remember({
    type: "fact",
    subject: "mina",
    content: "Mina reports to Joon",
    tags: ["manager", "joon"],
    importance: 0.84,
    strength: 0.84,
  });
  const target = await service.remember({
    type: "fact",
    subject: "joon",
    content: "Joon works in the payments team",
    tags: ["payments", "team"],
    importance: 0.84,
    strength: 0.84,
  });
  for (let index = 0; index < 30; index += 1) {
    await service.remember({
      type: index % 2 === 0 ? "fact" : "episode",
      subject: `noise-${index}`,
      content: `Noise memory ${index} about unrelated topic`,
      tags: ["noise", `topic-${index}`],
      importance: 0.4 + (index % 5) * 0.05,
      strength: 0.4 + (index % 4) * 0.1,
    });
  }

  const result = await service.recall({
    text: "what team does the bluebird launch owner report to",
    limit: 5,
  });

  expect(result.candidates.slice(0, 2).map((candidate) => candidate.memory.id).sort()).toEqual(
    [alias.id, target.id].sort(),
  );
});
