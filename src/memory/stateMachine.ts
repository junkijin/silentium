import type { Memory, RememberInput, UpdateMemoryInput } from "./types";

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}

export function formMemoryState(
  input: RememberInput,
  context: { id: string; now: string },
): Memory {
  return {
    id: context.id,
    type: input.type,
    subject: input.subject,
    content: input.content,
    tags: [...input.tags],
    strength: clampUnit(input.strength),
    importance: clampUnit(input.importance),
    status: "active",
    createdAt: context.now,
    updatedAt: context.now,
    lastAccessedAt: null,
    reinforcementCount: 0,
    recallCount: 0,
    version: 1,
    validFrom: input.validFrom ?? context.now,
    validTo: null,
    supersededBy: null,
  };
}

export function reinforceMemoryState(
  memory: Memory,
  context: { now: string; amount?: number } = { now: new Date().toISOString() },
): Memory {
  const amount = context.amount ?? 0.15;

  return {
    ...memory,
    strength: clampUnit(memory.strength + amount),
    updatedAt: context.now,
    reinforcementCount: memory.reinforcementCount + 1,
    status: memory.status === "forgotten" ? "active" : memory.status,
  };
}

export function weakenMemoryState(
  memory: Memory,
  context: { now: string; amount?: number } = { now: new Date().toISOString() },
): Memory {
  const amount = context.amount ?? 0.1;
  const strength = clampUnit(memory.strength - amount);

  return {
    ...memory,
    strength,
    updatedAt: context.now,
    status: strength === 0 ? "forgotten" : memory.status,
    validTo: strength === 0 ? context.now : memory.validTo,
  };
}

export function applyRecallToMemoryState(
  memory: Memory,
  context: { now: string },
): Memory {
  return {
    ...memory,
    updatedAt: context.now,
    lastAccessedAt: context.now,
    recallCount: memory.recallCount + 1,
  };
}

export function supersedeMemoryState(
  memory: Memory,
  context: { now: string; replacementId: string },
): Memory {
  return {
    ...memory,
    status: "superseded",
    updatedAt: context.now,
    validTo: context.now,
    supersededBy: context.replacementId,
    version: memory.version + 1,
  };
}

export function forgetMemoryState(
  memory: Memory,
  context: { now: string },
): Memory {
  return {
    ...memory,
    status: "forgotten",
    strength: 0,
    updatedAt: context.now,
    validTo: context.now,
    version: memory.version + 1,
  };
}

export function updateMemoryState(
  memory: Memory,
  input: UpdateMemoryInput,
  context: { now: string },
): Memory {
  return {
    ...memory,
    type: input.type ?? memory.type,
    subject: input.subject ?? memory.subject,
    content: input.content ?? memory.content,
    tags: input.tags ? [...input.tags] : memory.tags,
    strength: clampUnit(input.strength ?? memory.strength),
    importance: clampUnit(input.importance ?? memory.importance),
    status: input.status ?? memory.status,
    updatedAt: context.now,
    validTo: typeof input.validTo === "undefined" ? memory.validTo : input.validTo,
    supersededBy: typeof input.supersededBy === "undefined" ? memory.supersededBy : input.supersededBy,
    version: memory.version + 1,
  };
}
