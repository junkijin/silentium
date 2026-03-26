import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const MemoryTypeSchema = z.enum(["fact", "preference", "episode"]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemoryStatusSchema = z.enum(["active", "superseded", "forgotten", "archived"]);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const MemorySchema = z.object({
  id: z.string().min(1),
  type: MemoryTypeSchema,
  subject: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  strength: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  status: MemoryStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  lastAccessedAt: IsoDateTimeSchema.nullable(),
  reinforcementCount: z.number().int().nonnegative(),
  recallCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  validFrom: IsoDateTimeSchema,
  validTo: IsoDateTimeSchema.nullable(),
  supersededBy: z.string().min(1).nullable(),
});
export type Memory = z.infer<typeof MemorySchema>;

export const MemoryEventTypeSchema = z.enum([
  "remembered",
  "updated",
  "reinforced",
  "forgotten",
  "superseded",
  "recalled",
  "archived",
  "rebuild",
]);
export type MemoryEventType = z.infer<typeof MemoryEventTypeSchema>;

export const MemoryEventSchema = z.object({
  id: z.string().min(1),
  memoryId: z.string().min(1),
  eventType: MemoryEventTypeSchema,
  at: IsoDateTimeSchema,
  data: z
    .object({
      memory: MemorySchema.optional(),
      queryText: z.string().optional(),
      resultIds: z.array(z.string().min(1)).optional(),
      reason: z.string().optional(),
    })
    .catchall(z.unknown())
    .default({}),
});
export type MemoryEvent = z.infer<typeof MemoryEventSchema>;

export const MemoryStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  byType: z.record(MemoryTypeSchema, z.number().int().nonnegative()),
  byStatus: z.record(MemoryStatusSchema, z.number().int().nonnegative()),
  averageStrength: z.number().min(0).max(1),
});
export type MemoryStats = z.infer<typeof MemoryStatsSchema>;

export const RecallQuerySchema = z.object({
  text: z.string().min(1),
  type: MemoryTypeSchema.optional(),
  subject: z.string().min(1).optional(),
  limit: z.number().int().positive().max(50).default(5),
  includeStatuses: z.array(MemoryStatusSchema).optional(),
});
export type RecallQuery = z.infer<typeof RecallQuerySchema>;

export const RecallCandidateSchema = z.object({
  memory: MemorySchema,
  lexicalScore: z.number().min(0),
  effectiveStrength: z.number().min(0),
  recallScore: z.number(),
  matchedTokens: z.array(z.string()),
});
export type RecallCandidate = z.infer<typeof RecallCandidateSchema>;

export const RecallResultSchema = z.object({
  query: RecallQuerySchema,
  candidates: z.array(RecallCandidateSchema),
  totalCandidates: z.number().int().nonnegative(),
});
export type RecallResult = z.infer<typeof RecallResultSchema>;

export const RememberInputSchema = z.object({
  type: MemoryTypeSchema,
  subject: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  importance: z.number().min(0).max(1).default(0.5),
  strength: z.number().min(0).max(1).default(0.5),
  validFrom: IsoDateTimeSchema.optional(),
});
export type RememberInput = z.infer<typeof RememberInputSchema>;

export const UpdateMemoryInputSchema = z
  .object({
    id: z.string().min(1),
    type: MemoryTypeSchema.optional(),
    subject: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
    importance: z.number().min(0).max(1).optional(),
    strength: z.number().min(0).max(1).optional(),
    status: MemoryStatusSchema.optional(),
    validTo: IsoDateTimeSchema.nullable().optional(),
    supersededBy: z.string().min(1).nullable().optional(),
  })
  .superRefine((value, context) => {
    const { id: _id, ...rest } = value;
    const hasChanges = Object.values(rest).some((field) => typeof field !== "undefined");

    if (!hasChanges) {
      context.addIssue({
        code: "custom",
        message: "At least one mutable field must be provided.",
        path: [],
      });
    }
  });
export type UpdateMemoryInput = z.infer<typeof UpdateMemoryInputSchema>;

const EMPTY_TYPE_COUNTS: Record<MemoryType, number> = {
  fact: 0,
  preference: 0,
  episode: 0,
};

const EMPTY_STATUS_COUNTS: Record<MemoryStatus, number> = {
  active: 0,
  superseded: 0,
  forgotten: 0,
  archived: 0,
};

export function createEmptyMemoryStats(): MemoryStats {
  return {
    total: 0,
    byType: { ...EMPTY_TYPE_COUNTS },
    byStatus: { ...EMPTY_STATUS_COUNTS },
    averageStrength: 0,
  };
}

export function calculateMemoryStats(memories: Memory[]): MemoryStats {
  if (memories.length === 0) {
    return createEmptyMemoryStats();
  }

  const stats = createEmptyMemoryStats();
  let strengthSum = 0;

  for (const memory of memories) {
    stats.total += 1;
    stats.byType[memory.type] += 1;
    stats.byStatus[memory.status] += 1;
    strengthSum += memory.strength;
  }

  stats.averageStrength = Number((strengthSum / memories.length).toFixed(6));

  return stats;
}

export { IsoDateTimeSchema };
