import { expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemoryResources } from "../src/memory/resources";
import { createTempRoot, createTestMemoryService } from "./support";

test("memory changes emit resource notifications", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);
  const server = new McpServer({ name: "silentium-test", version: "1.0.0" });
  const updatedUris: string[] = [];
  const listChangedCalls: number[] = [];

  server.sendResourceListChanged = () => {
    listChangedCalls.push(Date.now());
  };
  server.server.sendResourceUpdated = async ({ uri }) => {
    updatedUris.push(uri);
  };

  registerMemoryResources(server, service);
  listChangedCalls.length = 0;
  updatedUris.length = 0;

  const memory = await service.remember({
    type: "fact",
    subject: "user",
    content: "Alice likes tea",
  });

  expect(listChangedCalls).toHaveLength(1);
  expect(updatedUris).toContain("silentium://memory/stats");
  expect(updatedUris).toContain(`silentium://memory/${memory.id}`);

  updatedUris.length = 0;

  await service.updateMemory({
    id: memory.id,
    content: "Alice likes green tea",
  });

  expect(updatedUris).toContain(`silentium://memory/${memory.id}`);
  expect(updatedUris).toContain("silentium://memory/type/fact");
});
