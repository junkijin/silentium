import { expect, test } from "bun:test";
import path from "node:path";
import { createTempRoot, createTestMemoryService, readJson, readJsonl } from "./support";
import { getEventsPath } from "../src/memory/paths";

test("parallel remember calls remain serialized and consistent", async () => {
  const root = await createTempRoot();
  const service = await createTestMemoryService(root);

  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      service.remember({
        type: index % 2 === 0 ? "fact" : "preference",
        subject: `subject-${index}`,
        content: `content-${index}`,
        tags: [`tag-${index}`],
        importance: 0.6,
        strength: 0.5,
      }),
    ),
  );

  const events = await readJsonl<{ memoryId: string }>(getEventsPath(root));
  const inverted = await readJson<Record<string, string[]>>(path.join(root, "index", "inverted.json"));

  expect(events).toHaveLength(12);
  expect((await service.listMemories()).length).toBe(12);
  expect(Object.values(inverted).every((ids) => ids.length === new Set(ids).size)).toBe(true);
});
