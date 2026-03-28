import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  archiveMemorySnapshot,
  listMemorySnapshots,
  readMemorySnapshot,
  saveMemorySnapshot,
} from "../src/memory/snapshotStore";
import type { Memory } from "../src/memory/types";
import { createTempRoot, fixturePath, readJson } from "./support";

test("save and read snapshot round-trip", async () => {
  const root = await createTempRoot();
  const memory = await readJson<Memory>(fixturePath("types", "valid-memory.json"));

  await saveMemorySnapshot(root, memory);

  const savedFile = path.join(root, "memories", "mem-001.json");
  expect(JSON.parse(await readFile(savedFile, "utf8"))).toEqual(memory);
  expect(await readMemorySnapshot(root, memory.id)).toEqual(memory);
});

test("archiveMemorySnapshot moves the file into archive", async () => {
  const root = await createTempRoot();
  const memory = await readJson<Memory>(fixturePath("types", "valid-memory.json"));

  await saveMemorySnapshot(root, memory);
  await archiveMemorySnapshot(root, memory.id);

  expect(await readMemorySnapshot(root, memory.id)).toBeNull();
  expect(await readMemorySnapshot(root, memory.id, { includeArchived: true })).toEqual(memory);
  expect(await listMemorySnapshots(root, { includeArchived: true })).toHaveLength(1);
});

test("listMemorySnapshots reports the file path for invalid snapshot content", async () => {
  const root = await createTempRoot();
  const invalidPath = path.join(root, "memories", "broken.json");

  await mkdir(path.dirname(invalidPath), { recursive: true });
  await writeFile(invalidPath, '{"id":1}\n', "utf8");

  await expect(listMemorySnapshots(root)).rejects.toThrow(invalidPath);
});
