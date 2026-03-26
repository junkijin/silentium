import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemorySchema, RecallResultSchema, type MemoryStatus, type MemoryType } from "./types";
import type { MemoryService } from "./service";

const ListMemoriesInputSchema = z.object({
  type: z.enum(["fact", "preference", "episode"]).optional(),
  status: z.enum(["active", "superseded", "forgotten", "archived"]).optional(),
  subject: z.string().min(1).optional(),
});

export function registerMemoryTools(server: McpServer, memoryService: MemoryService): void {
  server.registerTool(
    "remember",
    {
      description: "새로운 기억을 형성합니다.",
      inputSchema: z.object({
        type: z.enum(["fact", "preference", "episode"]),
        subject: z.string().min(1),
        content: z.string().min(1),
        tags: z.array(z.string().min(1)).optional(),
        importance: z.number().min(0).max(1).optional(),
        strength: z.number().min(0).max(1).optional(),
        validFrom: z.string().datetime({ offset: true }).optional(),
      }),
      outputSchema: z.object({
        memory: MemorySchema,
      }),
      annotations: {
        openWorldHint: false,
      },
    },
    async (input) => {
      const memory = await memoryService.remember(input);
      return {
        content: [{ type: "text", text: memory.content }],
        structuredContent: { memory },
      };
    },
  );

  server.registerTool(
    "recall",
    {
      description: "질의와 관련된 기억을 회상합니다.",
      inputSchema: z.object({
        text: z.string().min(1),
        type: z.enum(["fact", "preference", "episode"]).optional(),
        subject: z.string().min(1).optional(),
        limit: z.number().int().positive().max(50).optional(),
      }),
      outputSchema: RecallResultSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const result = await memoryService.recall(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result.candidates.map((candidate) => candidate.memory.id)) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_memory",
    {
      description: "단일 기억을 조회합니다.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      outputSchema: z.object({
        memory: MemorySchema.nullable(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      const memory = await memoryService.getMemory(id, { includeArchived: true });
      return {
        content: [{ type: "text", text: memory ? memory.content : "null" }],
        structuredContent: { memory },
      };
    },
  );

  server.registerTool(
    "list_memories",
    {
      description: "기억 목록을 조회합니다.",
      inputSchema: ListMemoriesInputSchema.optional(),
      outputSchema: z.object({
        memories: z.array(MemorySchema),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const safeInput = input ?? {};
      const memories = await memoryService.listMemories({
        type: safeInput.type as MemoryType | undefined,
        status: safeInput.status as MemoryStatus | undefined,
        subject: safeInput.subject,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(memories.map((memory) => memory.id)) }],
        structuredContent: { memories },
      };
    },
  );

  server.registerTool(
    "update_memory",
    {
      description: "기억 내용을 수정합니다.",
      inputSchema: z.object({
        id: z.string().min(1),
        type: z.enum(["fact", "preference", "episode"]).optional(),
        subject: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
        tags: z.array(z.string().min(1)).optional(),
        importance: z.number().min(0).max(1).optional(),
        strength: z.number().min(0).max(1).optional(),
        status: z.enum(["active", "superseded", "forgotten", "archived"]).optional(),
        validTo: z.string().datetime({ offset: true }).nullable().optional(),
        supersededBy: z.string().min(1).nullable().optional(),
      }),
      outputSchema: z.object({
        memory: MemorySchema,
      }),
      annotations: {
        openWorldHint: false,
      },
    },
    async (input) => {
      const memory = await memoryService.updateMemory(input);
      return {
        content: [{ type: "text", text: memory.content }],
        structuredContent: { memory },
      };
    },
  );

  server.registerTool(
    "reinforce_memory",
    {
      description: "기억 강도를 높입니다.",
      inputSchema: z.object({
        id: z.string().min(1),
        amount: z.number().min(0).max(1).optional(),
      }),
      outputSchema: z.object({
        memory: MemorySchema,
      }),
      annotations: {
        openWorldHint: false,
      },
    },
    async ({ id, amount }) => {
      const memory = await memoryService.reinforceMemory(id, amount);
      return {
        content: [{ type: "text", text: memory.content }],
        structuredContent: { memory },
      };
    },
  );

  server.registerTool(
    "forget_memory",
    {
      description: "기억을 망각 상태로 전환합니다.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      outputSchema: z.object({
        memory: MemorySchema,
      }),
      annotations: {
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      const memory = await memoryService.forgetMemory(id);
      return {
        content: [{ type: "text", text: memory.content }],
        structuredContent: { memory },
      };
    },
  );
}
