import { expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemorySchema, RecallResultSchema } from "../src/memory/types";
import { registerMemoryTools } from "../src/memory/tools";
import { createTempRoot, createTestMemoryService } from "./support";

test("memory tool handlers return schema-valid structured content and annotations", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  const server = new McpServer({ name: "silentium-test", version: "1.0.0" });

  registerMemoryTools(server, service);

  const internals = server as unknown as {
    _registeredTools: Record<string, { annotations?: Record<string, boolean>; handler: (...args: any[]) => Promise<any> }>;
  };
  const rememberResult = await internals._registeredTools.remember.handler(
    {
      type: "fact",
      subject: "user",
      content: "Alice likes tea",
    },
    {},
  );
  const recallResult = await internals._registeredTools.recall.handler(
    {
      text: "tea",
      limit: 5,
    },
    {},
  );

  expect(MemorySchema.safeParse(rememberResult.structuredContent.memory).success).toBe(true);
  expect(RecallResultSchema.safeParse(recallResult.structuredContent).success).toBe(true);
  expect(internals._registeredTools.get_memory.annotations?.readOnlyHint).toBe(true);
  expect(internals._registeredTools.list_memories.annotations?.readOnlyHint).toBe(true);
  expect(internals._registeredTools.remember.annotations?.openWorldHint).toBe(false);
  expect(internals._registeredTools.forget_memory.annotations?.openWorldHint).toBe(false);
});

test("tool handlers preserve archived visibility rules and list filters", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  const server = new McpServer({ name: "silentium-test", version: "1.0.0" });

  registerMemoryTools(server, service);

  const internals = server as unknown as {
    _registeredTools: Record<string, { handler: (...args: any[]) => Promise<any> }>;
  };

  const active = (
    await internals._registeredTools.remember.handler(
      {
        type: "fact",
        subject: "active-memory",
        content: "Active memory",
      },
      {},
    )
  ).structuredContent.memory;
  const archived = (
    await internals._registeredTools.remember.handler(
      {
        type: "fact",
        subject: "archived-memory",
        content: "Archived memory",
      },
      {},
    )
  ).structuredContent.memory;

  await internals._registeredTools.update_memory.handler(
    {
      id: archived.id,
      status: "archived",
    },
    {},
  );

  const defaultList = await internals._registeredTools.list_memories.handler(undefined, {});
  const archivedList = await internals._registeredTools.list_memories.handler({ status: "archived" }, {});
  const archivedMemory = await internals._registeredTools.get_memory.handler({ id: archived.id }, {});

  expect(defaultList.structuredContent.memories.map((memory: { id: string }) => memory.id)).toEqual([active.id]);
  expect(archivedList.structuredContent.memories.map((memory: { id: string }) => memory.id)).toEqual([archived.id]);
  expect(archivedMemory.structuredContent.memory).toMatchObject({
    id: archived.id,
    status: "archived",
  });
});
