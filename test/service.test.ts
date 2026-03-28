import { expect, test } from "bun:test";
import path from "node:path";
import { MemoryService } from "../src/memory/service";
import { getEventsPath, getStatsPath } from "../src/memory/paths";
import {
  createFixedClock,
  createSequenceClock,
  createTempRoot,
  createTestMemoryService,
  fixturePath,
  readJson,
  readJsonl,
} from "./support";

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

test("service reload restores cached state from snapshots on cold start", async () => {
  const root = await createTempRoot();
  const writer = await createTestMemoryService(
    root,
    createSequenceClock([
      "2026-03-27T00:00:00.000Z",
      "2026-03-27T00:01:00.000Z",
      "2026-03-27T00:02:00.000Z",
      "2026-03-27T00:03:00.000Z",
    ]),
  );
  const active = await writer.remember({
    type: "fact",
    subject: "Alice Home",
    content: "Alice lives in Seoul",
    tags: ["home", "seoul"],
  });
  const archived = await writer.remember({
    type: "fact",
    subject: "Alice Office",
    content: "Alice used to work in Busan",
    tags: ["office", "busan"],
  });

  await writer.updateMemory({
    id: archived.id,
    status: "archived",
  });
  await writer.recall({
    text: "where does alice live in seoul",
    limit: 3,
  });

  const reader = new MemoryService({
    root,
    clock: createFixedClock("2026-03-28T00:00:00.000Z"),
  });
  await reader.initialize();

  expect(await reader.getMemory(active.id)).toMatchObject({
    id: active.id,
    recallCount: 1,
    lastAccessedAt: "2026-03-27T00:03:00.000Z",
  });
  expect(await reader.getMemory(archived.id)).toBeNull();
  expect(await reader.getMemory(archived.id, { includeArchived: true })).toMatchObject({
    id: archived.id,
    status: "archived",
  });
  expect((await reader.listMemories()).map((memory) => memory.id)).toEqual([active.id]);
  expect((await reader.listMemories({ includeArchived: true })).map((memory) => memory.id)).toEqual([
    active.id,
    archived.id,
  ]);
  expect((await reader.listMemories({ subject: "alice home" })).map((memory) => memory.id)).toEqual([active.id]);
  expect(await reader.getStats()).toEqual({
    total: 2,
    byType: {
      fact: 2,
      preference: 0,
      episode: 0,
    },
    byStatus: {
      active: 1,
      superseded: 0,
      forgotten: 0,
      archived: 1,
    },
    averageStrength: 0.5,
  });

  const recalled = await reader.recall({
    text: "alice seoul home",
    limit: 3,
  });
  expect(recalled.candidates[0]?.memory.id).toBe(active.id);
});

test("recall includeStatuses can surface forgotten memories while default recall keeps them hidden", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  const memory = await service.remember({
    type: "fact",
    subject: "legacy-db",
    content: "The legacy database engine is Oracle",
    tags: ["database", "oracle"],
    importance: 0.9,
    strength: 0.9,
  });

  await service.forgetMemory(memory.id);

  const defaultResult = await service.recall({
    text: "what is the legacy database engine",
    limit: 3,
  });
  const explicitResult = await service.recall({
    text: "what is the legacy database engine",
    includeStatuses: ["forgotten"],
    limit: 3,
  });

  expect(defaultResult.candidates).toHaveLength(0);
  expect(explicitResult.candidates[0]?.memory.id).toBe(memory.id);
  expect(explicitResult.candidates[0]?.memory.status).toBe("forgotten");
});
