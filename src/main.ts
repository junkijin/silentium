#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemoryResources } from "./memory/resources";
import { MemoryService, type MemoryServiceOptions } from "./memory/service";
import { registerMemoryTools } from "./memory/tools";
import { StdioServerTransport } from "./stdioTransport";

export const serverVersion = "0.2.0";

export interface SilentiumServerContext {
  server: McpServer;
  memoryService: MemoryService;
}

export async function createSilentiumServer(
  options: MemoryServiceOptions = {},
): Promise<SilentiumServerContext> {
  const server = new McpServer(
    {
      name: "silentium",
      version: serverVersion,
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  const memoryService = new MemoryService(options);
  await memoryService.initialize();

  registerMemoryTools(server, memoryService);
  registerMemoryResources(server, memoryService);

  return {
    server,
    memoryService,
  };
}

async function main() {
  const { server } = await createSilentiumServer();
  const handleSignal = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void handleSignal();
  });

  process.on("SIGTERM", () => {
    void handleSignal();
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Failed to start MCP server:", error);
    process.exit(1);
  });
}
