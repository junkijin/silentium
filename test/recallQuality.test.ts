import { expect, test } from "bun:test";
import { createTempRoot, createTestMemoryService } from "./support";

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
