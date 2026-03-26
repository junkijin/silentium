import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { appendEvents, readAllEvents, readEventsByMemoryId } from "../src/memory/eventStore";
import { getEventsPath } from "../src/memory/paths";
import type { MemoryEvent } from "../src/memory/types";
import { createTempRoot, fixturePath } from "./support";

test("appended events are read back in the same order", async () => {
  const root = await createTempRoot();
  const fixture = await readFile(fixturePath("events", "sample-events.jsonl"), "utf8");
  const events = fixture
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as MemoryEvent);

  await appendEvents(root, events);

  expect(await readAllEvents(root)).toEqual(events);
});

test("readEventsByMemoryId filters mixed event streams", async () => {
  const root = await createTempRoot();
  const eventsPath = getEventsPath(root);
  const fixture = await readFile(fixturePath("events", "sample-events.jsonl"), "utf8");

  await writeFile(eventsPath, fixture, "utf8");

  const filtered = await readEventsByMemoryId(root, "mem-002");

  expect(filtered).toHaveLength(1);
  expect(filtered[0]?.memoryId).toBe("mem-002");
});
