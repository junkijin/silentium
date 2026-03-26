import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MemoryChangeEvent, MemoryService } from "./service";
import type { MemoryType } from "./types";

function jsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function notifyMemoryResources(server: McpServer, change: MemoryChangeEvent): Promise<void> {
  if (change.action === "created" || change.action === "archived") {
    server.sendResourceListChanged();
  }

  await server.server.sendResourceUpdated({ uri: "silentium://memory/stats" });
  await server.server.sendResourceUpdated({ uri: `silentium://memory/${change.memory.id}` });
  await server.server.sendResourceUpdated({ uri: `silentium://memory/type/${change.memory.type}` });

  if (change.previous && change.previous.type !== change.memory.type) {
    await server.server.sendResourceUpdated({ uri: `silentium://memory/type/${change.previous.type}` });
  }
}

export function registerMemoryResources(server: McpServer, memoryService: MemoryService): void {
  server.registerResource(
    "memory-stats",
    "silentium://memory/stats",
    {
      title: "Memory Stats",
      description: "현재 메모리 통계를 제공합니다.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, await memoryService.getStats()),
  );

  server.registerResource(
    "memory-by-id",
    new ResourceTemplate("silentium://memory/{id}", {
      list: async () => ({
        resources: (await memoryService.listMemories({ includeArchived: true })).map((memory) => ({
          name: `memory-${memory.id}`,
          uri: `silentium://memory/${memory.id}`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Memory By Id",
      description: "개별 메모리 스냅샷을 제공합니다.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = String(variables.id ?? "");
      const memory = await memoryService.getMemory(id, { includeArchived: true });
      return jsonResource(uri.href, memory ?? { error: "not_found", id });
    },
  );

  server.registerResource(
    "memory-by-type",
    new ResourceTemplate("silentium://memory/type/{type}", {
      list: async () => {
        const memories = await memoryService.listMemories();
        const types = [...new Set(memories.map((memory) => memory.type))].sort();
        return {
          resources: types.map((type) => ({
            name: `memory-type-${type}`,
            uri: `silentium://memory/type/${type}`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Memories By Type",
      description: "타입별 메모리 목록을 제공합니다.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const type = String(variables.type ?? "") as MemoryType;
      const memories = await memoryService.listMemories({ type });
      return jsonResource(uri.href, { type, memories });
    },
  );

  memoryService.setNotifier({
    notify: async (change) => notifyMemoryResources(server, change),
  });
}
