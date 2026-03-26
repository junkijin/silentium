import os from "node:os";
import path from "node:path";
import type { MemoryStatus, MemoryType } from "./types";

function normalizePathSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "unknown";
}

export function getMemoryRoot(root?: string): string {
  if (root) {
    return path.resolve(root);
  }

  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  const dataHome = xdgDataHome || path.join(os.homedir(), ".local", "share");

  return path.resolve(path.join(dataHome, "silentium", "memory"));
}

export function getEventsPath(root?: string): string {
  return path.join(getMemoryRoot(root), "events.jsonl");
}

export function getMemoryFilePath(root: string | undefined, memoryId: string): string {
  return path.join(getMemoryRoot(root), "memories", `${memoryId}.json`);
}

export function getArchiveFilePath(root: string | undefined, memoryId: string): string {
  return path.join(getMemoryRoot(root), "archive", `${memoryId}.json`);
}

export function getIndexPathByType(root: string | undefined, type: MemoryType): string {
  return path.join(getMemoryRoot(root), "index", "by-type", `${type}.json`);
}

export function getIndexPathBySubject(root: string | undefined, subject: string): string {
  return path.join(getMemoryRoot(root), "index", "by-subject", `${normalizePathSegment(subject)}.json`);
}

export function getIndexPathByStatus(root: string | undefined, status: MemoryStatus): string {
  return path.join(getMemoryRoot(root), "index", "by-status", `${status}.json`);
}

export function getInvertedIndexPath(root?: string): string {
  return path.join(getMemoryRoot(root), "index", "inverted.json");
}

export function getRecentIndexPath(root?: string): string {
  return path.join(getMemoryRoot(root), "index", "recent.json");
}

export function getHighImportanceIndexPath(root?: string): string {
  return path.join(getMemoryRoot(root), "index", "high-importance.json");
}

export function getStatsPath(root?: string): string {
  return path.join(getMemoryRoot(root), "stats.json");
}

export function getLockPath(root?: string): string {
  return path.join(getMemoryRoot(root), ".memory.lock");
}

export function normalizeIndexSegment(value: string): string {
  return normalizePathSegment(value);
}
