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
