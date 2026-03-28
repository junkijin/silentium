import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { appendEvent, appendEvents } from "./eventStore";
import { buildHighImportanceIndex, buildRecentIndex } from "./indexer";
import { ensureDir, withFileLock, writeJsonAtomic } from "./fileStore";
import {
  getHighImportanceIndexPath,
  getIndexPathByStatus,
  getIndexPathBySubject,
  getIndexPathByType,
  getInvertedIndexPath,
  getLockPath,
  getMemoryRoot,
  getRecentIndexPath,
  getStatsPath,
} from "./paths";
import { rebuildMemoryStore } from "./rebuild";
import {
  archiveMemorySnapshot,
  listMemorySnapshots,
  saveMemorySnapshot,
} from "./snapshotStore";
import { calculateRecallScore, compareRecallCandidates } from "./scoring";
import {
  applyRecallToMemoryState,
  forgetMemoryState,
  formMemoryState,
  reinforceMemoryState,
  updateMemoryState,
} from "./stateMachine";
import {
  normalizeLooseToken,
  normalizeSubject,
  tokenizeForIndex,
  tokenizeForSequence,
} from "./tokenize";
import {
  calculateMemoryStats,
  MemorySchema,
  RecallQuerySchema,
  RememberInputSchema,
  UpdateMemoryInputSchema,
  type Memory,
  type MemoryEvent,
  type MemoryEventType,
  type MemoryStats,
  type MemoryStatus,
  type MemoryType,
  type RecallCandidate,
  type RecallResult,
  type RememberInput,
  type UpdateMemoryInput,
} from "./types";

type IdSetMap<T extends string> = Map<T, Set<string>>;
type SubjectSetMap = Map<string, Set<string>>;
type TokenSetMap = Map<string, Set<string>>;
type InvertedIndex = Record<string, string[]>;

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
  action: "created" | "updated" | "reinforced" | "forgotten" | "archived" | "recalled";
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

function sortIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function addToSetMap<Key extends string>(map: IdSetMap<Key>, key: Key, id: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(id);
  map.set(key, values);
}

function addToSubjectMap(map: SubjectSetMap, key: string, id: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(id);
  map.set(key, values);
}

function addToTokenMap(map: TokenSetMap, key: string, id: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(id);
  map.set(key, values);
}

function removeFromSetMap<Key extends string>(map: IdSetMap<Key>, key: Key, id: string): void {
  const values = map.get(key);

  if (!values) {
    return;
  }

  values.delete(id);

  if (values.size === 0) {
    map.delete(key);
  }
}

function removeFromSubjectMap(map: SubjectSetMap, key: string, id: string): void {
  const values = map.get(key);

  if (!values) {
    return;
  }

  values.delete(id);

  if (values.size === 0) {
    map.delete(key);
  }
}

function removeFromTokenMap(map: TokenSetMap, key: string, id: string): void {
  const values = map.get(key);

  if (!values) {
    return;
  }

  values.delete(id);

  if (values.size === 0) {
    map.delete(key);
  }
}

function intersectSets(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) {
    return new Set<string>();
  }

  const [smallest, ...rest] = [...sets].sort((left, right) => left.size - right.size);
  const result = new Set<string>();

  for (const id of smallest) {
    if (rest.every((set) => set.has(id))) {
      result.add(id);
    }
  }

  return result;
}

function isIndexedMemory(memory: Memory): boolean {
  return memory.status !== "archived";
}

function tokenizeMemory(memory: Memory): string[] {
  return tokenizeForIndex([memory.subject, memory.content, ...memory.tags].join(" "));
}

function didIndexedContentChange(previous: Memory, next: Memory): boolean {
  return previous.subject !== next.subject || previous.content !== next.content || previous.tags.join("\u0000") !== next.tags.join("\u0000");
}

function sortByUpdatedAtDesc(left: Memory, right: Memory): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.importance - left.importance ||
    left.id.localeCompare(right.id)
  );
}

function countLooseTokenMatches(tokens: Iterable<string>, queryTokenSet: Set<string>): number {
  let matches = 0;

  for (const token of tokens) {
    if (queryTokenSet.has(normalizeLooseToken(token))) {
      matches += 1;
    }
  }

  return matches;
}

function collectLooseTokenMatches(tokens: Iterable<string>, queryTokenSet: Set<string>): Set<string> {
  const matches = new Set<string>();

  for (const token of tokens) {
    const normalizedToken = normalizeLooseToken(token);

    if (queryTokenSet.has(normalizedToken)) {
      matches.add(normalizedToken);
    }
  }

  return matches;
}

function calculateOrderedPhraseBoost(queryText: string, memory: Memory): number {
  const queryTokens = tokenizeForSequence(queryText)
    .map((token) => normalizeLooseToken(token))
    .filter((token) => token.length >= 3);
  const memoryTokens = tokenizeForSequence([memory.subject, memory.content, ...memory.tags].join(" "))
    .map((token) => normalizeLooseToken(token))
    .filter((token) => token.length >= 3);

  if (queryTokens.length < 2 || memoryTokens.length < 2) {
    return 0;
  }

  let longestRun = 0;

  for (let queryIndex = 0; queryIndex < queryTokens.length; queryIndex += 1) {
    for (let memoryIndex = 0; memoryIndex < memoryTokens.length; memoryIndex += 1) {
      let runLength = 0;

      while (
        queryIndex + runLength < queryTokens.length &&
        memoryIndex + runLength < memoryTokens.length &&
        queryTokens[queryIndex + runLength] === memoryTokens[memoryIndex + runLength]
      ) {
        runLength += 1;
      }

      longestRun = Math.max(longestRun, runLength);
    }
  }

  if (longestRun < 2) {
    return 0;
  }

  return Math.min(0.1, (longestRun - 1) * 0.04);
}

export class MemoryService {
  readonly root: string;

  private readonly clock: () => Date;
  private readonly idGenerator: (kind: "memory" | "event") => string;
  private notifier?: MemoryServiceNotifier;
  private initialized = false;
  private readonly memories = new Map<string, Memory>();
  private readonly idsByType: IdSetMap<MemoryType> = new Map();
  private readonly idsByStatus: IdSetMap<MemoryStatus> = new Map();
  private readonly idsBySubject: SubjectSetMap = new Map();
  private readonly activeIdsByToken: TokenSetMap = new Map();
  private stats: MemoryStats = calculateMemoryStats([]);

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

    this.loadCache(await listMemorySnapshots(this.root, { includeArchived: true }));

    if (this.stats.total === 0) {
      await writeJsonAtomic(getStatsPath(this.root), this.stats);
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
      this.replaceCachedMemory(null, memory);
      await this.persistChange(null, memory, { writeInverted: true, writeStats: true, writeRanks: true });
      await this.emit({
        action: "created",
        memory,
        previous: null,
      });

      return memory;
    });
  }

  async recall(query: Parameters<typeof RecallQuerySchema.parse>[0]): Promise<RecallResult> {
    return this.withWriteLock(async () => {
      const parsed = RecallQuerySchema.parse(query);
      const allowedStatuses = parsed.includeStatuses ?? ["active"];
      const queryTokens = tokenizeForIndex(
        [parsed.text, parsed.subject ?? "", parsed.type ?? ""].filter(Boolean).join(" "),
      );
      const subjectTokens = parsed.subject ? tokenizeForIndex(parsed.subject) : [];
      const now = this.clock();
      const recalledAt = now.toISOString();
      const candidateIds = this.getRecallCandidateIds(parsed.text, parsed.subject);

      const candidates = this.applyStructuralBoosts(
        [...candidateIds]
        .map((id) => this.memories.get(id) ?? null)
        .filter((memory): memory is Memory => memory !== null)
        .filter((memory) => allowedStatuses.includes(memory.status))
        .filter((memory) => !parsed.type || memory.type === parsed.type)
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
        .filter((candidate) => candidate.recallScore > 0),
        parsed.text,
        queryTokens,
      ).filter((candidate, _index, allCandidates) => this.hasRecallSupport(candidate, allCandidates, queryTokens))
        .sort(compareRecallCandidates);

      const recalledCandidates = candidates.slice(0, parsed.limit);

      if (recalledCandidates.length === 0) {
        return {
          query: parsed,
          candidates: recalledCandidates,
          totalCandidates: candidates.length,
        };
      }

      const updatedCandidates = recalledCandidates.map((candidate) => {
        const updatedMemory = MemorySchema.parse(
          applyRecallToMemoryState(candidate.memory, { now: recalledAt }),
        );

        return {
          previous: candidate.memory,
          candidate: {
            ...candidate,
            memory: updatedMemory,
          },
        };
      });

      await appendEvents(
        this.root,
        updatedCandidates.map(({ candidate }) =>
          this.createEvent("recalled", candidate.memory, recalledAt, {
            queryText: parsed.text,
          }),
        ),
      );
      await Promise.all(
        updatedCandidates.map(({ candidate }) => saveMemorySnapshot(this.root, candidate.memory)),
      );

      for (const { previous, candidate } of updatedCandidates) {
        this.replaceCachedMemory(previous, candidate.memory);
      }

      await this.writeRankIndexes();
      await Promise.all(
        updatedCandidates.map(({ candidate, previous }) =>
          this.emit({
            action: "recalled",
            memory: candidate.memory,
            previous,
          }),
        ),
      );

      return {
        query: parsed,
        candidates: updatedCandidates.map(({ candidate }) => candidate),
        totalCandidates: candidates.length,
      };
    });
  }

  async getMemory(memoryId: string, options: { includeArchived?: boolean } = {}): Promise<Memory | null> {
    await this.initialize();
    const memory = this.memories.get(memoryId) ?? null;

    if (!memory) {
      return null;
    }

    if (memory.status === "archived" && !options.includeArchived) {
      return null;
    }

    return memory;
  }

  async listMemories(options: ListMemoriesOptions = {}): Promise<Memory[]> {
    await this.initialize();
    const includeArchived = options.includeArchived ?? options.status === "archived";
    const candidates = this.getListCandidateIds(options);

    return sortMemories(
      [...candidates]
        .map((id) => this.memories.get(id) ?? null)
        .filter((memory): memory is Memory => memory !== null)
        .filter((memory) => {
          if (options.type && memory.type !== options.type) {
            return false;
          }

          if (options.status && memory.status !== options.status) {
            return false;
          }

          if (options.subject && normalizeSubject(memory.subject) !== normalizeSubject(options.subject)) {
            return false;
          }

          if (!includeArchived && memory.status === "archived") {
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

      this.replaceCachedMemory(previous, next);
      await this.persistChange(previous, next, {
        writeInverted: didIndexedContentChange(previous, next),
        writeStats: true,
        writeRanks: true,
      });
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
      this.replaceCachedMemory(previous, next);
      await this.persistChange(previous, next, { writeStats: true, writeRanks: true });
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
      this.replaceCachedMemory(previous, next);
      await this.persistChange(previous, next, { writeStats: true, writeRanks: true });
      await this.emit({ action: "forgotten", memory: next, previous });

      return next;
    });
  }

  async getStats(): Promise<MemoryStats> {
    await this.initialize();
    return this.stats;
  }

  async rebuildFromEvents(): Promise<Memory[]> {
    return this.withWriteLock(async () => {
      const memories = await rebuildMemoryStore(this.root);
      this.loadCache(memories);
      return memories;
    });
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

  private loadCache(memories: Memory[]): void {
    this.memories.clear();
    this.idsByType.clear();
    this.idsByStatus.clear();
    this.idsBySubject.clear();
    this.activeIdsByToken.clear();

    for (const memory of memories) {
      this.memories.set(memory.id, memory);
      addToSetMap(this.idsByType, memory.type, memory.id);
      addToSetMap(this.idsByStatus, memory.status, memory.id);
      addToSubjectMap(this.idsBySubject, normalizeSubject(memory.subject), memory.id);

      if (!isIndexedMemory(memory)) {
        continue;
      }

      for (const token of tokenizeMemory(memory)) {
        addToTokenMap(this.activeIdsByToken, token, memory.id);
      }
    }

    this.stats = calculateMemoryStats([...this.memories.values()]);
  }

  private replaceCachedMemory(previous: Memory | null, next: Memory | null): void {
    if (previous) {
      this.memories.delete(previous.id);
      removeFromSetMap(this.idsByType, previous.type, previous.id);
      removeFromSetMap(this.idsByStatus, previous.status, previous.id);
      removeFromSubjectMap(this.idsBySubject, normalizeSubject(previous.subject), previous.id);

      if (isIndexedMemory(previous)) {
        for (const token of tokenizeMemory(previous)) {
          removeFromTokenMap(this.activeIdsByToken, token, previous.id);
        }
      }
    }

    if (next) {
      this.memories.set(next.id, next);
      addToSetMap(this.idsByType, next.type, next.id);
      addToSetMap(this.idsByStatus, next.status, next.id);
      addToSubjectMap(this.idsBySubject, normalizeSubject(next.subject), next.id);

      if (isIndexedMemory(next)) {
        for (const token of tokenizeMemory(next)) {
          addToTokenMap(this.activeIdsByToken, token, next.id);
        }
      }
    }

    this.stats = calculateMemoryStats([...this.memories.values()]);
  }

  private getListCandidateIds(options: ListMemoriesOptions): Set<string> {
    const includeArchived = options.includeArchived ?? options.status === "archived";
    const filters: Set<string>[] = [];

    if (options.type) {
      filters.push(new Set(this.idsByType.get(options.type) ?? []));
    }

    if (options.status) {
      filters.push(new Set(this.idsByStatus.get(options.status) ?? []));
    }

    if (options.subject) {
      filters.push(new Set(this.idsBySubject.get(normalizeSubject(options.subject)) ?? []));
    }

    if (filters.length === 0) {
      const ids = includeArchived
        ? [...this.memories.keys()]
        : [...this.memories.values()].filter(isIndexedMemory).map((memory) => memory.id);

      return new Set(ids);
    }

    return intersectSets(filters);
  }

  private getRecallCandidateIds(
    text: string,
    subject?: string,
  ): Set<string> {
    const tokens = tokenizeForIndex([text, subject ?? ""].filter(Boolean).join(" "));

    if (tokens.length === 0) {
      return new Set<string>();
    }

    const candidates = new Set<string>();

    for (const token of tokens) {
      const ids = this.activeIdsByToken.get(token);

      if (!ids) {
        continue;
      }

      for (const id of ids) {
        candidates.add(id);
      }
    }

    let frontier = [...candidates];

    for (let depth = 0; depth < 2; depth += 1) {
      const nextFrontier: string[] = [];

      for (const memoryId of frontier) {
        const memory = this.memories.get(memoryId);

        if (!memory || !isIndexedMemory(memory)) {
          continue;
        }

        for (const token of tokenizeMemory(memory)) {
          const linkedIds = this.idsBySubject.get(normalizeSubject(token));

          if (!linkedIds) {
            continue;
          }

          for (const linkedId of linkedIds) {
            if (candidates.has(linkedId)) {
              continue;
            }

            candidates.add(linkedId);
            nextFrontier.push(linkedId);
          }
        }
      }

      frontier = nextFrontier;

      if (frontier.length === 0) {
        break;
      }
    }

    return candidates;
  }

  private applyStructuralBoosts(
    candidates: RecallCandidate[],
    queryText: string,
    queryTokens: string[],
  ): RecallCandidate[] {
    if (candidates.length === 0) {
      return candidates;
    }

    const bridgeBoostById = this.buildBridgeBoostMap(candidates, new Set(queryTokens));
    const chainCoverageBoostById = this.buildChainCoverageBoostMap(candidates, new Set(queryTokens));

    return candidates.map((candidate) => {
      const bridgeBoost = bridgeBoostById.get(candidate.memory.id) ?? 0;
      const chainCoverageBoost = chainCoverageBoostById.get(candidate.memory.id) ?? 0;
      const freshnessBoost = this.calculateFreshnessBoost(candidate.memory, candidates, queryTokens);
      const phraseBoost = calculateOrderedPhraseBoost(queryText, candidate.memory);

      return {
        ...candidate,
        recallScore: Number(
          Math.min(
            1,
            candidate.recallScore +
              bridgeBoost +
              chainCoverageBoost +
              freshnessBoost +
              phraseBoost,
          ).toFixed(6),
        ),
      };
    });
  }

  private hasRecallSupport(
    candidate: RecallCandidate,
    candidates: RecallCandidate[],
    queryTokens: string[],
  ): boolean {
    if (this.hasDiscriminativeLexicalSupport(candidate)) {
      return true;
    }

    if (this.hasBridgeSupport(candidate, candidates, queryTokens)) {
      return true;
    }

    if (this.hasVersionClusterSupport(candidate, candidates, queryTokens)) {
      return true;
    }

    return this.hasSubjectClusterSupport(candidate, candidates, queryTokens);
  }

  private buildBridgeBoostMap(
    candidates: RecallCandidate[],
    queryTokenSet: Set<string>,
  ): Map<string, number> {
    const boosts = new Map<string, number>();
    const memoryTokensById = new Map<string, Set<string>>();
    const normalizedQueryTokens = new Set([...queryTokenSet].map((token) => normalizeLooseToken(token)));

    for (const candidate of candidates) {
      memoryTokensById.set(candidate.memory.id, new Set(tokenizeMemory(candidate.memory)));
    }

    for (let iteration = 0; iteration < 3; iteration += 1) {
      let changed = false;

      for (const target of candidates) {
        const subjectTokens = tokenizeForIndex(target.memory.subject);

        if (subjectTokens.length === 0 || subjectTokens.some((token) => queryTokenSet.has(token))) {
          continue;
        }

        let bestBoost = boosts.get(target.memory.id) ?? 0;

        for (const source of candidates) {
          const sourceBridgeBoost = boosts.get(source.memory.id) ?? 0;

          if (
            source.memory.id === target.memory.id ||
            (source.matchedTokens.length === 0 && sourceBridgeBoost === 0)
          ) {
            continue;
          }

          const sourceTokens = memoryTokensById.get(source.memory.id);

          if (!sourceTokens || !subjectTokens.every((token) => sourceTokens.has(token))) {
            continue;
          }

          const targetTokens = memoryTokensById.get(target.memory.id) ?? new Set<string>();
          const sourceQueryCoverage = collectLooseTokenMatches(sourceTokens, normalizedQueryTokens);
          const targetQueryCoverage = collectLooseTokenMatches(targetTokens, normalizedQueryTokens);
          const targetTokenMatches = countLooseTokenMatches(
            targetTokens,
            normalizedQueryTokens,
          );
          const novelQueryCoverage = [...targetQueryCoverage].filter((token) => !sourceQueryCoverage.has(token)).length;
          const novelTargetTokens = [...targetTokens].filter((token) => {
            return token.length >= 3 && !normalizedQueryTokens.has(normalizeLooseToken(token)) && !subjectTokens.includes(token);
          }).length;
          const propagatedBoost = sourceBridgeBoost * 0.85;
          const nextBoost = Math.min(
            0.44,
              source.recallScore * 0.26 +
              source.lexicalScore * 0.12 +
              source.matchedTokens.length * 0.015 +
              Math.min(0.08, targetTokenMatches * 0.04) +
              Math.min(0.18, novelQueryCoverage * 0.09) +
              Math.min(0.12, novelTargetTokens * 0.03) +
              propagatedBoost,
          );

          bestBoost = Math.max(bestBoost, nextBoost);
        }

        if (bestBoost > (boosts.get(target.memory.id) ?? 0)) {
          boosts.set(target.memory.id, bestBoost);
          changed = true;
        }
      }

      if (!changed) {
        break;
      }
    }

    return boosts;
  }

  private buildChainCoverageBoostMap(
    candidates: RecallCandidate[],
    queryTokenSet: Set<string>,
  ): Map<string, number> {
    const informativeQueryTokens = new Set(
      [...queryTokenSet]
        .map((token) => normalizeLooseToken(token))
        .filter((token) => token.length >= 3),
    );
    const memoryTokensById = new Map<string, Set<string>>();
    const directCoverageById = new Map<string, Set<string>>();
    const bestCoverageById = new Map<string, Set<string>>();

    for (const candidate of candidates) {
      const memoryTokens = new Set(tokenizeMemory(candidate.memory));
      memoryTokensById.set(candidate.memory.id, memoryTokens);

      const directCoverage = collectLooseTokenMatches(memoryTokens, informativeQueryTokens);
      directCoverageById.set(candidate.memory.id, directCoverage);
      bestCoverageById.set(candidate.memory.id, new Set(directCoverage));
    }

    for (let iteration = 0; iteration < 3; iteration += 1) {
      let changed = false;

      for (const target of candidates) {
        const subjectTokens = tokenizeForIndex(target.memory.subject);

        if (subjectTokens.length === 0 || subjectTokens.some((token) => informativeQueryTokens.has(normalizeLooseToken(token)))) {
          continue;
        }

        const currentCoverage = bestCoverageById.get(target.memory.id) ?? new Set<string>();
        let bestCoverage = currentCoverage;

        for (const source of candidates) {
          if (source.memory.id === target.memory.id) {
            continue;
          }

          const sourceTokens = memoryTokensById.get(source.memory.id);

          if (!sourceTokens || !subjectTokens.every((token) => sourceTokens.has(token))) {
            continue;
          }

          const sourceCoverage = bestCoverageById.get(source.memory.id) ?? new Set<string>();
          const targetCoverage = directCoverageById.get(target.memory.id) ?? new Set<string>();
          const combinedCoverage = new Set([...sourceCoverage, ...targetCoverage]);

          if (combinedCoverage.size > bestCoverage.size) {
            bestCoverage = combinedCoverage;
          }
        }

        if (bestCoverage.size > currentCoverage.size) {
          bestCoverageById.set(target.memory.id, bestCoverage);
          changed = true;
        }
      }

      if (!changed) {
        break;
      }
    }

    const boosts = new Map<string, number>();

    for (const candidate of candidates) {
      const directCoverage = directCoverageById.get(candidate.memory.id) ?? new Set<string>();
      const bestCoverage = bestCoverageById.get(candidate.memory.id) ?? new Set<string>();
      const linkedCoverageGain = bestCoverage.size - directCoverage.size;

      if (linkedCoverageGain <= 0) {
        continue;
      }

      boosts.set(candidate.memory.id, Math.min(0.2, linkedCoverageGain * 0.04));
    }

    return boosts;
  }

  private calculateFreshnessBoost(
    memory: Memory,
    candidates: RecallCandidate[],
    queryTokens: string[],
  ): number {
    const related = candidates
      .map((candidate) => candidate.memory)
      .filter(
        (candidateMemory) =>
          candidateMemory.type === memory.type &&
          normalizeSubject(candidateMemory.subject) === normalizeSubject(memory.subject),
      )
      .sort(sortByUpdatedAtDesc);

    const rank = related.findIndex((candidateMemory) => candidateMemory.id === memory.id);
    const subjectTokens = tokenizeForIndex(memory.subject);
    const structuredSubject = subjectTokens.length > 1;
    const normalizedSubjectTokens = new Set(subjectTokens.map((token) => normalizeLooseToken(token)));
    const memoryContextTokens = new Set(
      tokenizeMemory(memory)
        .map((token) => normalizeLooseToken(token))
        .filter((token) => !normalizedSubjectTokens.has(token)),
    );
    const versionLikeCluster =
      structuredSubject &&
      related.some((candidateMemory) => {
        if (candidateMemory.id === memory.id) {
          return false;
        }

        return tokenizeMemory(candidateMemory)
          .map((token) => normalizeLooseToken(token))
          .some((token) => memoryContextTokens.has(token) && !normalizedSubjectTokens.has(token));
      });
    const exactSubjectAlignment =
      structuredSubject && subjectTokens.every((token) => queryTokens.includes(token));

    if (rank === -1 || related.length <= 1) {
      return 0;
    }

    if (rank === 0) {
      return exactSubjectAlignment || versionLikeCluster ? 0.16 : 0.08;
    }

    if (rank === 1) {
      return exactSubjectAlignment || versionLikeCluster ? 0.06 : 0.03;
    }

    return 0;
  }

  private hasDiscriminativeLexicalSupport(candidate: RecallCandidate): boolean {
    const subjectTokens = new Set(tokenizeForIndex(candidate.memory.subject));
    const informativeMatches = [...new Set(candidate.matchedTokens)].filter((token) => {
      return token.length >= 3 && !subjectTokens.has(token);
    });
    const support = informativeMatches.reduce((sum, token) => {
      const tokenFrequency = this.activeIdsByToken.get(token)?.size ?? 1;
      return sum + 1 / tokenFrequency;
    }, 0);

    return support >= 0.75;
  }

  private hasBridgeSupport(
    candidate: RecallCandidate,
    candidates: RecallCandidate[],
    queryTokens: string[],
  ): boolean {
    const normalizedQueryTokens = new Set(queryTokens.map((token) => normalizeLooseToken(token)));
    const subjectTokens = tokenizeForIndex(candidate.memory.subject);

    if (subjectTokens.length === 0 || subjectTokens.some((token) => normalizedQueryTokens.has(normalizeLooseToken(token)))) {
      return false;
    }

    return candidates.some((source) => {
      if (source.memory.id === candidate.memory.id || source.matchedTokens.length === 0) {
        return false;
      }

      const sourceTokens = new Set(tokenizeMemory(source.memory));
      return subjectTokens.every((token) => sourceTokens.has(token));
    });
  }

  private hasSubjectClusterSupport(
    candidate: RecallCandidate,
    candidates: RecallCandidate[],
    queryTokens: string[],
  ): boolean {
    const subjectTokens = tokenizeForIndex(candidate.memory.subject);

    return queryTokens.some((token) => {
      if (!subjectTokens.includes(token)) {
        return false;
      }

      const cluster = candidates.filter((other) => {
        return other.memory.type === candidate.memory.type && tokenizeForIndex(other.memory.subject).includes(token);
      });

      return cluster.length >= 3 || (cluster.length >= 2 && cluster.some((other) => this.hasDiscriminativeLexicalSupport(other)));
    });
  }

  private hasVersionClusterSupport(
    candidate: RecallCandidate,
    candidates: RecallCandidate[],
    queryTokens: string[],
  ): boolean {
    const subjectTokens = tokenizeForIndex(candidate.memory.subject);

    if (!queryTokens.some((token) => subjectTokens.includes(token))) {
      return false;
    }

    const cluster = candidates.filter((other) => {
      return (
        other.memory.type === candidate.memory.type &&
        normalizeSubject(other.memory.subject) === normalizeSubject(candidate.memory.subject)
      );
    });

    return cluster.length >= 2;
  }

  private async persistChange(
    previous: Memory | null,
    next: Memory | null,
    options: { writeInverted?: boolean; writeStats?: boolean; writeRanks?: boolean } = {},
  ): Promise<void> {
    const tasks: Promise<void>[] = [];
    const touchedTypes = new Set<MemoryType>();
    const touchedStatuses = new Set<MemoryStatus>();
    const touchedSubjects = new Set<string>();

    if (previous) {
      touchedTypes.add(previous.type);
      touchedStatuses.add(previous.status);
      touchedSubjects.add(previous.subject);
    }

    if (next) {
      touchedTypes.add(next.type);
      touchedStatuses.add(next.status);
      touchedSubjects.add(next.subject);
    }

    for (const type of touchedTypes) {
      tasks.push(this.writeIndexedTypeFile(type));
    }

    for (const status of touchedStatuses) {
      if (status === "archived") {
        continue;
      }

      tasks.push(this.writeIndexedStatusFile(status));
    }

    for (const subject of touchedSubjects) {
      tasks.push(this.writeIndexedSubjectFile(subject));
    }

    if (options.writeInverted) {
      tasks.push(this.writeInvertedIndexFile());
    }

    if (options.writeStats) {
      tasks.push(writeJsonAtomic(getStatsPath(this.root), this.stats));
    }

    if (options.writeRanks) {
      tasks.push(this.writeRankIndexes());
    }

    await Promise.all(tasks);
  }

  private async writeIndexedTypeFile(type: MemoryType): Promise<void> {
    await this.writeIdIndexFile(
      getIndexPathByType(this.root, type),
      [...(this.idsByType.get(type) ?? [])].filter((id) => isIndexedMemory(this.memories.get(id)!)),
    );
  }

  private async writeIndexedStatusFile(status: MemoryStatus): Promise<void> {
    await this.writeIdIndexFile(
      getIndexPathByStatus(this.root, status),
      [...(this.idsByStatus.get(status) ?? [])].filter((id) => isIndexedMemory(this.memories.get(id)!)),
    );
  }

  private async writeIndexedSubjectFile(subject: string): Promise<void> {
    const subjectKey = normalizeSubject(subject);
    await this.writeIdIndexFile(
      getIndexPathBySubject(this.root, subject),
      [...(this.idsBySubject.get(subjectKey) ?? [])].filter((id) => isIndexedMemory(this.memories.get(id)!)),
    );
  }

  private async writeIdIndexFile(filePath: string, ids: string[]): Promise<void> {
    const nextIds = sortIds(ids);

    if (nextIds.length === 0) {
      await fs.rm(filePath, { force: true });
      return;
    }

    await writeJsonAtomic(filePath, { ids: nextIds });
  }

  private async writeInvertedIndexFile(): Promise<void> {
    const inverted: InvertedIndex = {};

    for (const [token, ids] of this.activeIdsByToken.entries()) {
      inverted[token] = sortIds(ids);
    }

    if (Object.keys(inverted).length === 0) {
      await fs.rm(getInvertedIndexPath(this.root), { force: true });
      return;
    }

    await writeJsonAtomic(getInvertedIndexPath(this.root), inverted);
  }

  private async writeRankIndexes(): Promise<void> {
    const activeMemories = [...this.memories.values()].filter(isIndexedMemory);

    await Promise.all([
      this.writeIdIndexFile(getRecentIndexPath(this.root), buildRecentIndex(activeMemories)),
      this.writeIdIndexFile(getHighImportanceIndexPath(this.root), buildHighImportanceIndex(activeMemories)),
    ]);
  }

  private async emit(change: MemoryChangeEvent): Promise<void> {
    await this.notifier?.notify(change);
  }

  private createEvent(
    eventType: MemoryEventType,
    memory: Memory,
    now: string,
    data: Omit<MemoryEvent["data"], "memory"> = {},
  ): MemoryEvent {
    return {
      id: this.idGenerator("event"),
      memoryId: memory.id,
      eventType,
      at: now,
      data: {
        ...data,
        memory,
      },
    };
  }

  private now(): string {
    return this.clock().toISOString();
  }
}
