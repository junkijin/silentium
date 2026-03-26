import { afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { MemoryService } from "../src/memory/service";

const cleanupTargets = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...cleanupTargets].map(async (target) => {
      await rm(target, { recursive: true, force: true });
      cleanupTargets.delete(target);
    }),
  );
});

export async function createTempRoot(prefix = "silentium-"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupTargets.add(root);
  return root;
}

export function createFixedClock(iso = "2026-03-27T00:00:00.000Z"): () => Date {
  return () => new Date(iso);
}

export function createSequenceClock(values: string[]): () => Date {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return new Date(value);
  };
}

export function createFixedIdGenerator(): (kind: "memory" | "event") => string {
  let memoryIndex = 0;
  let eventIndex = 0;

  return (kind) => {
    if (kind === "memory") {
      memoryIndex += 1;
      return `mem-${String(memoryIndex).padStart(3, "0")}`;
    }

    eventIndex += 1;
    return `evt-${String(eventIndex).padStart(3, "0")}`;
  };
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function fixturePath(...segments: string[]): string {
  return path.join(process.cwd(), "test", "fixtures", ...segments);
}

export async function createTestMemoryService(
  root: string,
  clock = createFixedClock(),
): Promise<MemoryService> {
  const service = new MemoryService({
    root,
    clock,
    idGenerator: createFixedIdGenerator(),
  });
  await service.initialize();
  return service;
}
