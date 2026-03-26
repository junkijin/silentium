import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir, readJsonFile, writeJsonAtomic } from "./fileStore";
import {
  getHighImportanceIndexPath,
  getIndexPathByStatus,
  getIndexPathBySubject,
  getIndexPathByType,
  getInvertedIndexPath,
  getMemoryRoot,
  getRecentIndexPath,
} from "./paths";
import { listMemorySnapshots } from "./snapshotStore";
import { normalizeSubject, tokenizeForIndex } from "./tokenize";
import type { Memory, MemoryStatus, MemoryType } from "./types";

type IdIndex = { ids: string[] };
type InvertedIndex = Record<string, string[]>;

function sortUnique(ids: string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function compareRecency(left: Memory, right: Memory): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.importance - left.importance ||
    left.id.localeCompare(right.id)
  );
}

function compareImportance(left: Memory, right: Memory): number {
  return (
    right.importance - left.importance ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

async function readIdIndex(filePath: string): Promise<IdIndex> {
  return (await readJsonFile(filePath, (value) => value as IdIndex)) ?? { ids: [] };
}

async function writeIdIndex(filePath: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    await fs.rm(filePath, { force: true });
    return;
  }

  await writeJsonAtomic(filePath, { ids: sortUnique(ids) });
}

export function buildRecentIndex(memories: Memory[]): string[] {
  return [...memories].sort(compareRecency).map((memory) => memory.id);
}

export function buildHighImportanceIndex(memories: Memory[]): string[] {
  return [...memories]
    .filter((memory) => memory.importance >= 0.7)
    .sort(compareImportance)
    .map((memory) => memory.id);
}

export async function indexMemory(root: string | undefined, memory: Memory): Promise<void> {
  const typePath = getIndexPathByType(root, memory.type);
  const subjectPath = getIndexPathBySubject(root, memory.subject);
  const statusPath = getIndexPathByStatus(root, memory.status);
  const invertedPath = getInvertedIndexPath(root);

  const [typeIndex, subjectIndex, statusIndex, invertedIndex, snapshots] = await Promise.all([
    readIdIndex(typePath),
    readIdIndex(subjectPath),
    readIdIndex(statusPath),
    readJsonFile(invertedPath, (value) => value as InvertedIndex),
    listMemorySnapshots(root),
  ]);

  await Promise.all([
    writeIdIndex(typePath, [...typeIndex.ids, memory.id]),
    writeIdIndex(subjectPath, [...subjectIndex.ids, memory.id]),
    writeIdIndex(statusPath, [...statusIndex.ids, memory.id]),
  ]);

  const nextInverted: InvertedIndex = { ...(invertedIndex ?? {}) };
  const tokens = tokenizeForIndex([memory.subject, memory.content, ...memory.tags].join(" "));

  for (const token of tokens) {
    nextInverted[token] = sortUnique([...(nextInverted[token] ?? []), memory.id]);
  }

  await Promise.all([
    writeJsonAtomic(invertedPath, nextInverted),
    writeJsonAtomic(getRecentIndexPath(root), { ids: buildRecentIndex(sortMemorySet([...snapshots, memory])) }),
    writeJsonAtomic(
      getHighImportanceIndexPath(root),
      { ids: buildHighImportanceIndex(sortMemorySet([...snapshots, memory])) },
    ),
  ]);
}

function sortMemorySet(memories: Memory[]): Memory[] {
  const byId = new Map<string, Memory>();

  for (const memory of memories) {
    byId.set(memory.id, memory);
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function removeMemoryFromIndexes(root: string | undefined, memory: Memory): Promise<void> {
  const rootPath = getMemoryRoot(root);
  const typePath = getIndexPathByType(root, memory.type);
  const subjectPath = getIndexPathBySubject(root, memory.subject);
  const statusPath = getIndexPathByStatus(root, memory.status);
  const invertedPath = getInvertedIndexPath(root);
  const recentPath = getRecentIndexPath(root);
  const highImportancePath = getHighImportanceIndexPath(root);

  const [typeIndex, subjectIndex, statusIndex, invertedIndex, recentIndex, highImportanceIndex] =
    await Promise.all([
      readIdIndex(typePath),
      readIdIndex(subjectPath),
      readIdIndex(statusPath),
      readJsonFile(invertedPath, (value) => value as InvertedIndex),
      readIdIndex(recentPath),
      readIdIndex(highImportancePath),
    ]);

  await Promise.all([
    writeIdIndex(typePath, typeIndex.ids.filter((id) => id !== memory.id)),
    writeIdIndex(subjectPath, subjectIndex.ids.filter((id) => id !== memory.id)),
    writeIdIndex(statusPath, statusIndex.ids.filter((id) => id !== memory.id)),
    writeIdIndex(recentPath, recentIndex.ids.filter((id) => id !== memory.id)),
    writeIdIndex(highImportancePath, highImportanceIndex.ids.filter((id) => id !== memory.id)),
  ]);

  if (invertedIndex) {
    const tokens = tokenizeForIndex([memory.subject, memory.content, ...memory.tags].join(" "));

    for (const token of tokens) {
      const ids = (invertedIndex[token] ?? []).filter((id) => id !== memory.id);

      if (ids.length === 0) {
        delete invertedIndex[token];
      } else {
        invertedIndex[token] = ids;
      }
    }

    if (Object.keys(invertedIndex).length === 0) {
      await fs.rm(invertedPath, { force: true });
    } else {
      await writeJsonAtomic(invertedPath, invertedIndex);
    }
  }

  await ensureDir(path.join(rootPath, "index"));
}

export async function rebuildIndexesFromSnapshots(
  root: string | undefined,
  snapshots?: Memory[],
): Promise<void> {
  const memories = sortMemorySet(snapshots ?? (await listMemorySnapshots(root)));
  const indexRoot = path.join(getMemoryRoot(root), "index");

  await fs.rm(indexRoot, { recursive: true, force: true });
  await Promise.all([
    ensureDir(path.join(indexRoot, "by-type")),
    ensureDir(path.join(indexRoot, "by-subject")),
    ensureDir(path.join(indexRoot, "by-status")),
  ]);

  const byType = new Map<MemoryType, string[]>();
  const bySubject = new Map<string, string[]>();
  const byStatus = new Map<MemoryStatus, string[]>();
  const inverted: InvertedIndex = {};

  for (const memory of memories) {
    byType.set(memory.type, [...(byType.get(memory.type) ?? []), memory.id]);
    const subjectKey = normalizeSubject(memory.subject);
    bySubject.set(subjectKey, [...(bySubject.get(subjectKey) ?? []), memory.id]);
    byStatus.set(memory.status, [...(byStatus.get(memory.status) ?? []), memory.id]);

    for (const token of tokenizeForIndex([memory.subject, memory.content, ...memory.tags].join(" "))) {
      inverted[token] = sortUnique([...(inverted[token] ?? []), memory.id]);
    }
  }

  await Promise.all([
    ...[...byType.entries()].map(([type, ids]) => writeJsonAtomic(getIndexPathByType(root, type), { ids })),
    ...[...bySubject.entries()].map(([subject, ids]) =>
      writeJsonAtomic(path.join(indexRoot, "by-subject", `${subject}.json`), { ids }),
    ),
    ...[...byStatus.entries()].map(([status, ids]) =>
      writeJsonAtomic(getIndexPathByStatus(root, status), { ids }),
    ),
    writeJsonAtomic(getInvertedIndexPath(root), inverted),
    writeJsonAtomic(getRecentIndexPath(root), { ids: buildRecentIndex(memories) }),
    writeJsonAtomic(getHighImportanceIndexPath(root), { ids: buildHighImportanceIndex(memories) }),
  ]);
}
