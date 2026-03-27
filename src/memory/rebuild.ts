#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import { readAllEvents } from "./eventStore";
import { ensureDir, writeJsonAtomic } from "./fileStore";
import { rebuildIndexesFromSnapshots } from "./indexer";
import { getArchiveFilePath, getMemoryFilePath, getMemoryRoot, getStatsPath } from "./paths";
import { calculateMemoryStats, MemorySchema, type Memory } from "./types";

export async function rebuildMemoryStore(root?: string): Promise<Memory[]> {
  const memoryRoot = getMemoryRoot(root);
  const memoriesDir = path.join(memoryRoot, "memories");
  const archiveDir = path.join(memoryRoot, "archive");
  const indexDir = path.join(memoryRoot, "index");
  const events = await readAllEvents(root);
  const latestById = new Map<string, Memory>();

  for (const event of events) {
    if (event.data.memory) {
      latestById.set(event.memoryId, MemorySchema.parse(event.data.memory));
    }
  }

  await Promise.all([
    fs.rm(memoriesDir, { recursive: true, force: true }),
    fs.rm(archiveDir, { recursive: true, force: true }),
    fs.rm(indexDir, { recursive: true, force: true }),
  ]);
  await Promise.all([ensureDir(memoriesDir), ensureDir(archiveDir)]);

  const memories = [...latestById.values()].sort((left, right) => left.id.localeCompare(right.id));

  await Promise.all(
    memories.map((memory) =>
      writeJsonAtomic(
        memory.status === "archived" ? getArchiveFilePath(root, memory.id) : getMemoryFilePath(root, memory.id),
        memory,
      ),
    ),
  );

  const activeMemories = memories.filter((memory) => memory.status !== "archived");

  await rebuildIndexesFromSnapshots(root, activeMemories);
  await writeJsonAtomic(getStatsPath(root), calculateMemoryStats(memories));

  return memories;
}

if (import.meta.main) {
  rebuildMemoryStore().catch((error) => {
    console.error("Failed to rebuild memory store:", error);
    process.exit(1);
  });
}
