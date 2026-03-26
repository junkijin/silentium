import { randomUUID } from "node:crypto";
import path from "node:path";
import { appendEvent } from "./eventStore";
import { ensureDir, readJsonFile, withFileLock, writeJsonAtomic } from "./fileStore";
import { rebuildIndexesFromSnapshots } from "./indexer";
import { getLockPath, getMemoryRoot, getStatsPath } from "./paths";
import { rebuildMemoryStore } from "./rebuild";
import {
  archiveMemorySnapshot,
  listMemorySnapshots,
  readMemorySnapshot,
  saveMemorySnapshot,
} from "./snapshotStore";
import { calculateRecallScore, compareRecallCandidates } from "./scoring";
import {
  forgetMemoryState,
  formMemoryState,
  reinforceMemoryState,
  updateMemoryState,
} from "./stateMachine";
import { normalizeSubject, tokenizeForIndex } from "./tokenize";
import {
  calculateMemoryStats,
  MemorySchema,
  MemoryStatsSchema,
  RecallQuerySchema,
  RememberInputSchema,
  UpdateMemoryInputSchema,
  type Memory,
  type MemoryEvent,
  type MemoryEventType,
  type MemoryStats,
  type MemoryStatus,
  type MemoryType,
  type RecallResult,
  type RememberInput,
  type UpdateMemoryInput,
} from "./types";

export interface ListMemoriesOptions {
  type?: MemoryType;
  status?: MemoryStatus;
  subject?: string;
  includeArchived?: boolean;
}

export interface MemoryServiceOptions {
  root?: string;
  clock?: () => Date;
  idGenerator?: (kind: "memory" | "event") => string;
}

export interface MemoryChangeEvent {
  action: "created" | "updated" | "reinforced" | "forgotten" | "archived";
  memory: Memory;
  previous: Memory | null;
}

export interface MemoryServiceNotifier {
  notify(change: MemoryChangeEvent): Promise<void> | void;
}

function sortMemories(memories: Memory[]): Memory[] {
  return [...memories].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
  );
}

function defaultIdGenerator(kind: "memory" | "event"): string {
  return `${kind === "memory" ? "mem" : "evt"}-${randomUUID()}`;
}

export class MemoryService {
  readonly root: string;

  private readonly clock: () => Date;
  private readonly idGenerator: (kind: "memory" | "event") => string;
  private notifier?: MemoryServiceNotifier;
  private initialized = false;

  constructor(options: MemoryServiceOptions = {}) {
    this.root = getMemoryRoot(options.root);
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  setNotifier(notifier?: MemoryServiceNotifier): void {
    this.notifier = notifier;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await Promise.all([
      ensureDir(this.root),
      ensureDir(path.join(this.root, "memories")),
      ensureDir(path.join(this.root, "archive")),
      ensureDir(path.join(this.root, "index", "by-type")),
      ensureDir(path.join(this.root, "index", "by-subject")),
      ensureDir(path.join(this.root, "index", "by-status")),
    ]);

    const statsPath = getStatsPath(this.root);
    const currentStats = await readJsonFile(statsPath, (value) => MemoryStatsSchema.parse(value));

    if (!currentStats) {
      await writeJsonAtomic(statsPath, calculateMemoryStats([]));
    }

    this.initialized = true;
  }

  async remember(input: RememberInput): Promise<Memory> {
    const parsed = RememberInputSchema.parse(input);

    return this.withWriteLock(async () => {
      const now = this.now();
      const memory = MemorySchema.parse(
        formMemoryState(parsed, {
          id: this.idGenerator("memory"),
          now,
        }),
      );

      await appendEvent(this.root, this.createEvent("remembered", memory, now));
      await saveMemorySnapshot(this.root, memory);
      await this.syncDerivedFiles();
      await this.emit({
        action: "created",
        memory,
        previous: null,
      });

      return memory;
    });
  }

  async recall(query: Parameters<typeof RecallQuerySchema.parse>[0]): Promise<RecallResult> {
    await this.initialize();
    const parsed = RecallQuerySchema.parse(query);
    const memories = await this.listMemories({
      type: parsed.type,
      includeArchived: false,
    });
    const allowedStatuses = parsed.includeStatuses ?? ["active"];
    const subjectTokens = parsed.subject ? tokenizeForIndex(parsed.subject) : [];
    const now = this.clock();

    const candidates = memories
      .filter((memory) => allowedStatuses.includes(memory.status))
      .filter((memory) => {
        if (subjectTokens.length === 0) {
          return true;
        }

        const memorySubjectTokens = tokenizeForIndex(memory.subject);
        return subjectTokens.every((token) => memorySubjectTokens.includes(token));
      })
      .map((memory) => ({
        memory,
        ...calculateRecallScore(memory, parsed, now),
      }))
      .filter((candidate) => candidate.recallScore > 0)
      .sort(compareRecallCandidates);

    return {
      query: parsed,
      candidates: candidates.slice(0, parsed.limit),
      totalCandidates: candidates.length,
    };
  }

  async getMemory(memoryId: string, options: { includeArchived?: boolean } = {}): Promise<Memory | null> {
    await this.initialize();
    return readMemorySnapshot(this.root, memoryId, options);
  }

  async listMemories(options: ListMemoriesOptions = {}): Promise<Memory[]> {
    await this.initialize();
    const memories = await listMemorySnapshots(this.root, {
      includeArchived: options.includeArchived ?? options.status === "archived",
    });
    const normalizedSubject = options.subject ? normalizeSubject(options.subject) : null;

    return sortMemories(
      memories.filter((memory) => {
        if (options.type && memory.type !== options.type) {
          return false;
        }

        if (options.status && memory.status !== options.status) {
          return false;
        }

        if (normalizedSubject && normalizeSubject(memory.subject) !== normalizedSubject) {
          return false;
        }

        if (!options.includeArchived && memory.status === "archived") {
          return false;
        }

        return true;
      }),
    );
  }

  async updateMemory(input: UpdateMemoryInput): Promise<Memory> {
    const parsed = UpdateMemoryInputSchema.parse(input);

    return this.withWriteLock(async () => {
      const previous = await this.requireMemory(parsed.id, { includeArchived: true });
      const next = MemorySchema.parse(updateMemoryState(previous, parsed, { now: this.now() }));
      const action = next.status === "archived" ? "archived" : "updated";
      const eventType: MemoryEventType = next.status === "archived" ? "archived" : "updated";

      await appendEvent(this.root, this.createEvent(eventType, next, next.updatedAt));

      if (next.status === "archived") {
        await saveMemorySnapshot(this.root, next);
        await archiveMemorySnapshot(this.root, next.id);
      } else {
        await saveMemorySnapshot(this.root, next);
      }

      await this.syncDerivedFiles();
      await this.emit({ action, memory: next, previous });

      return next;
    });
  }

  async reinforceMemory(memoryId: string, amount = 0.15): Promise<Memory> {
    return this.withWriteLock(async () => {
      const previous = await this.requireMemory(memoryId);
      const next = MemorySchema.parse(reinforceMemoryState(previous, { now: this.now(), amount }));

      await appendEvent(this.root, this.createEvent("reinforced", next, next.updatedAt));
      await saveMemorySnapshot(this.root, next);
      await this.syncDerivedFiles();
      await this.emit({ action: "reinforced", memory: next, previous });

      return next;
    });
  }

  async forgetMemory(memoryId: string): Promise<Memory> {
    return this.withWriteLock(async () => {
      const previous = await this.requireMemory(memoryId);
      const next = MemorySchema.parse(forgetMemoryState(previous, { now: this.now() }));

      await appendEvent(this.root, this.createEvent("forgotten", next, next.updatedAt));
      await saveMemorySnapshot(this.root, next);
      await this.syncDerivedFiles();
      await this.emit({ action: "forgotten", memory: next, previous });

      return next;
    });
  }

  async getStats(): Promise<MemoryStats> {
    await this.initialize();
    const statsPath = getStatsPath(this.root);
    const cached = await readJsonFile(statsPath, (value) => MemoryStatsSchema.parse(value));

    if (cached) {
      return cached;
    }

    const snapshots = await listMemorySnapshots(this.root);
    const stats = calculateMemoryStats(snapshots);
    await writeJsonAtomic(statsPath, stats);
    return stats;
  }

  async rebuildFromEvents(): Promise<Memory[]> {
    return this.withWriteLock(async () => rebuildMemoryStore(this.root));
  }

  private async withWriteLock<T>(callback: () => Promise<T>): Promise<T> {
    await this.initialize();
    return withFileLock(getLockPath(this.root), callback);
  }

  private async requireMemory(
    memoryId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<Memory> {
    const memory = await this.getMemory(memoryId, options);

    if (!memory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    return memory;
  }

  private async syncDerivedFiles(): Promise<void> {
    const snapshots = await listMemorySnapshots(this.root);
    await rebuildIndexesFromSnapshots(this.root, snapshots);
    await writeJsonAtomic(getStatsPath(this.root), calculateMemoryStats(snapshots));
  }

  private async emit(change: MemoryChangeEvent): Promise<void> {
    await this.notifier?.notify(change);
  }

  private createEvent(eventType: MemoryEventType, memory: Memory, now: string): MemoryEvent {
    return {
      id: this.idGenerator("event"),
      memoryId: memory.id,
      eventType,
      at: now,
      data: {
        memory,
      },
    };
  }

  private now(): string {
    return this.clock().toISOString();
  }
}
