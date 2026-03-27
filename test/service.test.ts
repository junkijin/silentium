import { expect, test } from "bun:test";
import path from "node:path";
import { getEventsPath, getStatsPath } from "../src/memory/paths";
import { createSequenceClock, createTempRoot, createTestMemoryService, fixturePath, readJson, readJsonl } from "./support";

test("remember -> recall -> reinforce -> update -> forget stays consistent", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(
    root,
    createSequenceClock([
      "2026-03-27T00:00:00.000Z",
      "2026-03-27T00:01:00.000Z",
      "2026-03-27T00:02:00.000Z",
      "2026-03-27T00:03:00.000Z",
    ]),
  );

  const remembered = await service.remember({
    type: "fact",
    subject: "user-profile",
    content: "Alice likes tea",
    tags: ["tea"],
    importance: 0.8,
    strength: 0.7,
  });
  const recalled = await service.recall({
    text: "tea",
    limit: 5,
  });
  await service.reinforceMemory(remembered.id, 0.2);
  await service.updateMemory({
    id: remembered.id,
    content: "Alice prefers green tea in the afternoon",
    tags: ["tea", "afternoon"],
    importance: 0.9,
  });
  const forgotten = await service.forgetMemory(remembered.id);

  expect(recalled.candidates[0]?.memory.id).toBe(remembered.id);
  expect(recalled.candidates[0]?.memory.recallCount).toBe(1);
  expect(recalled.candidates[0]?.memory.lastAccessedAt).toBe("2026-03-27T00:01:00.000Z");
  expect(forgotten).toEqual(await readJson(fixturePath("service", "final-memory.json")));
  expect(await readJson(getStatsPath(root))).toEqual({
    total: 1,
    byType: {
      fact: 1,
      preference: 0,
      episode: 0,
    },
    byStatus: {
      active: 0,
      superseded: 0,
      forgotten: 1,
      archived: 0,
    },
    averageStrength: 0,
  });
  expect(await readJsonl(getEventsPath(root))).toHaveLength(5);
  expect(await readJson(path.join(root, "memories", "mem-001.json"))).toEqual(forgotten);
});

test("archived memories remain counted in stats", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  const memory = await service.remember({
    type: "fact",
    subject: "user",
    content: "Alice likes tea",
  });

  await service.updateMemory({
    id: memory.id,
    status: "archived",
  });

  expect(await readJson(getStatsPath(root))).toEqual({
    total: 1,
    byType: {
      fact: 1,
      preference: 0,
      episode: 0,
    },
    byStatus: {
      active: 0,
      superseded: 0,
      forgotten: 0,
      archived: 1,
    },
    averageStrength: 0.5,
  });
});
