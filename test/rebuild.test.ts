import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { rebuildMemoryStore } from "../src/memory/rebuild";
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
