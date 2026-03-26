import { expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemoryResources } from "../src/memory/resources";
import { createTempRoot, createTestMemoryService } from "./support";

test("memory resources return expected JSON for stats, id, and type URIs", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  const server = new McpServer({ name: "silentium-test", version: "1.0.0" });
  const memory = await service.remember({
    type: "fact",
    subject: "user",
    content: "Alice likes tea",
  });

  registerMemoryResources(server, service);

  const internals = server as unknown as {
    _registeredResources: Record<string, { readCallback: (...args: any[]) => Promise<any> }>;
    _registeredResourceTemplates: Record<
      string,
      { readCallback: (...args: any[]) => Promise<any> }
    >;
  };

  const statsResult = await internals._registeredResources["silentium://memory/stats"].readCallback(
    new URL("silentium://memory/stats"),
    {},
  );
  const memoryResult = await internals._registeredResourceTemplates["memory-by-id"].readCallback(
    new URL(`silentium://memory/${memory.id}`),
    { id: memory.id },
    {},
  );
  const missingResult = await internals._registeredResourceTemplates["memory-by-id"].readCallback(
    new URL("silentium://memory/missing"),
    { id: "missing" },
    {},
  );
  const typeResult = await internals._registeredResourceTemplates["memory-by-type"].readCallback(
    new URL("silentium://memory/type/fact"),
    { type: "fact" },
    {},
  );

  expect(JSON.parse(statsResult.contents[0].text).total).toBe(1);
  expect(JSON.parse(memoryResult.contents[0].text).id).toBe(memory.id);
  expect(JSON.parse(missingResult.contents[0].text)).toEqual({
    error: "not_found",
    id: "missing",
  });
  expect(JSON.parse(typeResult.contents[0].text).memories).toHaveLength(1);
});
