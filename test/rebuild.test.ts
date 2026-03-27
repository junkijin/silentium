import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { appendEvents } from "../src/memory/eventStore";
import { rebuildMemoryStore } from "../src/memory/rebuild";
import type { MemoryEvent } from "../src/memory/types";
import { createTempRoot, createTestMemoryService, readJson } from "./support";

test("rebuildMemoryStore recreates snapshots and indexes from events", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  const memory = await service.remember({
    type: "fact",
    subject: "user",
    content: "Alice likes tea",
  });

  await service.forgetMemory(memory.id);

  const expectedSnapshot = await readJson(path.join(root, "memories", `${memory.id}.json`));
  const expectedRecentIndex = await readJson(path.join(root, "index", "recent.json"));

  await Promise.all([
    rm(path.join(root, "memories"), { recursive: true, force: true }),
    rm(path.join(root, "index"), { recursive: true, force: true }),
  ]);

  await rebuildMemoryStore(root);

  expect(await readJson(path.join(root, "memories", `${memory.id}.json`))).toEqual(expectedSnapshot);
  expect(await readJson(path.join(root, "index", "recent.json"))).toEqual(expectedRecentIndex);
});

test("rebuildMemoryStore respects append order for same-timestamp events", async () => {
  const root = await createTempRoot();
  const events: MemoryEvent[] = [
    {
      id: "evt-b",
      memoryId: "mem-001",
      eventType: "updated",
      at: "2026-03-27T00:00:00.000Z",
      data: {
        memory: {
          id: "mem-001",
          type: "fact",
          subject: "user",
          content: "old",
          tags: [],
          strength: 0.5,
          importance: 0.5,
          status: "active",
          createdAt: "2026-03-27T00:00:00.000Z",
          updatedAt: "2026-03-27T00:00:00.000Z",
          lastAccessedAt: null,
          reinforcementCount: 0,
          recallCount: 0,
          version: 1,
          validFrom: "2026-03-27T00:00:00.000Z",
          validTo: null,
          supersededBy: null,
        },
      },
    },
    {
      id: "evt-a",
      memoryId: "mem-001",
      eventType: "updated",
      at: "2026-03-27T00:00:00.000Z",
      data: {
        memory: {
          id: "mem-001",
          type: "fact",
          subject: "user",
          content: "new",
          tags: [],
          strength: 0.5,
          importance: 0.5,
          status: "active",
          createdAt: "2026-03-27T00:00:00.000Z",
          updatedAt: "2026-03-27T00:00:00.000Z",
          lastAccessedAt: null,
          reinforcementCount: 0,
          recallCount: 0,
          version: 2,
          validFrom: "2026-03-27T00:00:00.000Z",
          validTo: null,
          supersededBy: null,
        },
      },
    },
  ];

  await appendEvents(root, events);
  await rebuildMemoryStore(root);

  expect(await readJson(path.join(root, "memories", "mem-001.json"))).toMatchObject({
    content: "new",
    version: 2,
  });
});
