import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { rebuildMemoryStore } from "../src/memory/rebuild";
import { MemoryService } from "../src/memory/service";

interface BenchmarkResult {
  name: string;
  operations: number;
  durationMs: number;
  opsPerSec: number;
  avgMsPerOp: number;
}

function readCount(name: string, fallback: number): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SUBJECT_COUNT = readCount("BENCH_SUBJECT_COUNT", 48);
const INGEST_COUNT = readCount("BENCH_INGEST_COUNT", 40);
const RECALL_MEMORY_COUNT = readCount("BENCH_RECALL_MEMORY_COUNT", 100);
const RECALL_QUERY_COUNT = readCount("BENCH_RECALL_QUERY_COUNT", 24);
const REBUILD_MEMORY_COUNT = readCount("BENCH_REBUILD_MEMORY_COUNT", 80);
const REBUILD_UPDATE_EVERY = 5;

async function withTempRoot<T>(prefix: string, callback: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));

  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function makeClock(): () => Date {
  let index = 0;

  return () => {
    const base = Date.parse("2026-03-27T00:00:00.000Z");
    const value = new Date(base + index * 60_000);
    index += 1;
    return value;
  };
}

function memoryTypeFor(index: number): "fact" | "preference" | "episode" {
  const types = ["fact", "preference", "episode"] as const;
  return types[index % types.length];
}

function subjectFor(index: number): string {
  return `subject-${index % SUBJECT_COUNT}`;
}

function topicFor(index: number): string {
  return `topic-${index % 64}`;
}

function contentFor(index: number): string {
  const topic = topicFor(index);
  return `codex memory ${index} stores ${topic} and preference-${index % 11} for ${subjectFor(index)}`;
}

function tagsFor(index: number): string[] {
  return [topicFor(index), `tag-${index % 17}`, `group-${index % 9}`];
}

function formatResult(result: BenchmarkResult): string {
  return [
    result.name.padEnd(28, " "),
    `${String(result.operations).padStart(5, " ")} ops`,
    `${result.durationMs.toFixed(2).padStart(10, " ")} ms`,
    `${result.opsPerSec.toFixed(2).padStart(10, " ")} ops/s`,
    `${result.avgMsPerOp.toFixed(4).padStart(10, " ")} ms/op`,
  ].join("  ");
}

async function benchmark(name: string, operations: number, callback: () => Promise<void>): Promise<BenchmarkResult> {
  const startedAt = performance.now();
  await callback();
  const durationMs = performance.now() - startedAt;

  return {
    name,
    operations,
    durationMs,
    opsPerSec: operations / (durationMs / 1000),
    avgMsPerOp: durationMs / operations,
  };
}

async function runBulkRemember(): Promise<BenchmarkResult> {
  return withTempRoot("silentium-bench-ingest-", async (root) => {
    const service = new MemoryService({ root, clock: makeClock() });
    await service.initialize();

    return benchmark("bulk_remember", INGEST_COUNT, async () => {
      for (let index = 0; index < INGEST_COUNT; index += 1) {
        await service.remember({
          type: memoryTypeFor(index),
          subject: subjectFor(index),
          content: contentFor(index),
          tags: tagsFor(index),
          importance: 0.45 + (index % 5) * 0.1,
          strength: 0.35 + (index % 4) * 0.15,
        });
      }
    });
  });
}

async function seedMemories(service: MemoryService, count: number): Promise<string[]> {
  const ids: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const memory = await service.remember({
      type: memoryTypeFor(index),
      subject: subjectFor(index),
      content: contentFor(index),
      tags: tagsFor(index),
      importance: 0.4 + (index % 6) * 0.1,
      strength: 0.3 + (index % 5) * 0.12,
    });
    ids.push(memory.id);
  }

  return ids;
}

async function runRecallQueries(): Promise<BenchmarkResult> {
  return withTempRoot("silentium-bench-recall-", async (root) => {
    const service = new MemoryService({ root, clock: makeClock() });
    await service.initialize();
    await seedMemories(service, RECALL_MEMORY_COUNT);

    return benchmark("targeted_recall", RECALL_QUERY_COUNT, async () => {
      for (let index = 0; index < RECALL_QUERY_COUNT; index += 1) {
        await service.recall({
          text: `${topicFor(index)} preference-${index % 11}`,
          subject: subjectFor(index),
          type: memoryTypeFor(index),
          limit: 5,
        });
      }
    });
  });
}

async function runRebuildFromEvents(): Promise<BenchmarkResult> {
  return withTempRoot("silentium-bench-rebuild-", async (root) => {
    const service = new MemoryService({ root, clock: makeClock() });
    await service.initialize();
    const ids = await seedMemories(service, REBUILD_MEMORY_COUNT);

    for (let index = 0; index < ids.length; index += REBUILD_UPDATE_EVERY) {
      await service.updateMemory({
        id: ids[index],
        content: `${contentFor(index)} updated-${index}`,
        tags: [...tagsFor(index), `updated-${index % 13}`],
        importance: 0.9,
      });
    }

    return benchmark("rebuild_from_events", REBUILD_MEMORY_COUNT, async () => {
      await rebuildMemoryStore(root);
    });
  });
}

async function main(): Promise<void> {
  const results = await Promise.all([runBulkRemember(), runRecallQueries(), runRebuildFromEvents()]);

  console.log("silentium benchmarks");
  console.log("");

  for (const result of results) {
    console.log(formatResult(result));
  }
}

await main();
