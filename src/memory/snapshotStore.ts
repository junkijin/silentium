import { promises as fs } from "node:fs";
import path from "node:path";
import { getArchiveFilePath, getMemoryFilePath, getMemoryRoot } from "./paths";
import { listJsonFiles, readJsonFile, writeJsonAtomic } from "./fileStore";
import { MemorySchema, type Memory } from "./types";

export async function saveMemorySnapshot(root: string | undefined, memory: Memory): Promise<void> {
  MemorySchema.parse(memory);
  await writeJsonAtomic(getMemoryFilePath(root, memory.id), memory);
}

export async function readMemorySnapshot(
  root: string | undefined,
  memoryId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Memory | null> {
  const active = await readJsonFile(getMemoryFilePath(root, memoryId), (value) => MemorySchema.parse(value));

  if (active || !options.includeArchived) {
    return active;
  }

  return readJsonFile(getArchiveFilePath(root, memoryId), (value) => MemorySchema.parse(value));
}

export async function listMemorySnapshots(
  root: string | undefined,
  options: { includeArchived?: boolean } = {},
): Promise<Memory[]> {
  const memoryRoot = getMemoryRoot(root);
  const activeFiles = await listJsonFiles(path.join(memoryRoot, "memories"));
  const activeMemories = (
    await Promise.all(activeFiles.map((filePath) => readJsonFile(filePath, (value) => MemorySchema.parse(value))))
  ).filter((memory): memory is Memory => memory !== null);

  if (!options.includeArchived) {
    return activeMemories.sort((left, right) => left.id.localeCompare(right.id));
  }

  const archiveFiles = await listJsonFiles(path.join(memoryRoot, "archive"));
  const archivedMemories = (
    await Promise.all(
      archiveFiles.map((filePath) => readJsonFile(filePath, (value) => MemorySchema.parse(value))),
    )
  ).filter((memory): memory is Memory => memory !== null);

  return [...activeMemories, ...archivedMemories].sort((left, right) => left.id.localeCompare(right.id));
}

export async function archiveMemorySnapshot(root: string | undefined, memoryId: string): Promise<void> {
  const sourcePath = getMemoryFilePath(root, memoryId);
  const targetPath = getArchiveFilePath(root, memoryId);
  const snapshot = await readMemorySnapshot(root, memoryId);

  if (!snapshot) {
    return;
  }

  await writeJsonAtomic(targetPath, snapshot);
  await fs.rm(sourcePath, { force: true });
}

export async function deleteMemorySnapshot(
  root: string | undefined,
  memoryId: string,
  options: { includeArchived?: boolean } = {},
): Promise<void> {
  await fs.rm(getMemoryFilePath(root, memoryId), { force: true });

  if (options.includeArchived) {
    await fs.rm(getArchiveFilePath(root, memoryId), { force: true });
  }
}
