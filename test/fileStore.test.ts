import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  appendJsonl,
  readJsonFile,
  withFileLock,
  writeJsonAtomic,
} from "../src/memory/fileStore";
import { createTempRoot, readJsonl } from "./support";

test("writeJsonAtomic persists exact JSON content", async () => {
  const root = await createTempRoot();
  const filePath = path.join(root, "sample.json");

  await writeJsonAtomic(filePath, { value: "ok", count: 2 });

  expect(await readJsonFile<{ value: string; count: number }>(filePath)).toEqual({
    value: "ok",
    count: 2,
  });
});

test("appendJsonl preserves write order", async () => {
  const root = await createTempRoot();
  const filePath = path.join(root, "events.jsonl");

  await appendJsonl(filePath, [{ id: 1 }, { id: 2 }, { id: 3 }]);

  expect(await readJsonl<{ id: number }>(filePath)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
});

test("withFileLock serializes concurrent writers", async () => {
  const root = await createTempRoot();
  const lockPath = path.join(root, "lock");
  const trace: string[] = [];

  await Promise.all([
    withFileLock(lockPath, async () => {
      trace.push("first:start");
      await Bun.sleep(20);
      trace.push("first:end");
    }),
    withFileLock(lockPath, async () => {
      trace.push("second:start");
      trace.push("second:end");
    }),
  ]);

  expect(trace).toEqual(["first:start", "first:end", "second:start", "second:end"]);
});

test("writeJsonAtomic cleans up temp files after failure", async () => {
  const root = await createTempRoot();
  const parentDirectory = path.dirname(root);
  const baseName = path.basename(root);

  await expect(writeJsonAtomic(root, { value: "fail" })).rejects.toBeDefined();

  const files = await readdir(parentDirectory);
  expect(
    files.filter((fileName) => fileName.startsWith(`${baseName}.`) && fileName.endsWith(".tmp")).length,
  ).toBe(0);
  expect(await readFile(path.join(root, "missing")).catch(() => null)).toBeNull();
});
