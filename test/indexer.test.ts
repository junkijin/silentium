import { expect, test } from "bun:test";
import path from "node:path";
import { indexMemory, rebuildIndexesFromSnapshots } from "../src/memory/indexer";
import { saveMemorySnapshot } from "../src/memory/snapshotStore";
import type { Memory } from "../src/memory/types";
import { createTempRoot, fixturePath, readJson } from "./support";

async function loadFixtureMemories(): Promise<[Memory, Memory]> {
  const first = await readJson<Memory>(fixturePath("types", "valid-memory.json"));
  const second = {
    ...first,
    id: "mem-002",
    type: "preference" as const,
    subject: "Morning Drink",
    content: "Coffee is avoided after lunch",
    tags: ["coffee"],
    strength: 0.6,
    importance: 0.75,
    status: "forgotten" as const,
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
    reinforcementCount: 1,
    version: 2,
    validFrom: "2026-03-26T00:00:00.000Z",
    validTo: "2026-03-27T00:01:00.000Z",
  };

  return [first, second];
}

test("rebuildIndexesFromSnapshots produces expected index files", async () => {
  const root = await createTempRoot();
  const [first, second] = await loadFixtureMemories();

  await saveMemorySnapshot(root, first);
  await saveMemorySnapshot(root, second);
  await rebuildIndexesFromSnapshots(root);

  expect(await readJson(path.join(root, "index", "by-type", "fact.json"))).toEqual(
    await readJson(fixturePath("index", "by-type-fact.json")),
  );
  expect(await readJson(path.join(root, "index", "by-type", "preference.json"))).toEqual(
    await readJson(fixturePath("index", "by-type-preference.json")),
  );
  expect(await readJson(path.join(root, "index", "by-subject", "user-profile.json"))).toEqual(
    await readJson(fixturePath("index", "by-subject-user-profile.json")),
  );
  expect(await readJson(path.join(root, "index", "by-status", "forgotten.json"))).toEqual(
    await readJson(fixturePath("index", "by-status-forgotten.json")),
  );
  expect(await readJson(path.join(root, "index", "inverted.json"))).toEqual(
    await readJson(fixturePath("index", "inverted.json")),
  );
  expect(await readJson(path.join(root, "index", "recent.json"))).toEqual(
    await readJson(fixturePath("index", "recent.json")),
  );
  expect(await readJson(path.join(root, "index", "high-importance.json"))).toEqual(
    await readJson(fixturePath("index", "high-importance.json")),
  );
});

test("indexMemory does not duplicate ids when re-indexing the same memory", async () => {
  const root = await createTempRoot();
  const [memory] = await loadFixtureMemories();

  await saveMemorySnapshot(root, memory);
  await indexMemory(root, memory);
  await indexMemory(root, memory);

  expect(await readJson(path.join(root, "index", "by-type", "fact.json"))).toEqual({
    ids: ["mem-001"],
  });
});
