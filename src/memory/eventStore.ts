import { promises as fs } from "node:fs";
import { appendJsonl, withFileLock } from "./fileStore";
import { getEventsPath } from "./paths";
import { MemoryEventSchema, type MemoryEvent } from "./types";

export async function appendEvent(root: string | undefined, event: MemoryEvent): Promise<void> {
  const parsed = MemoryEventSchema.parse(event);
  const eventsPath = getEventsPath(root);
  await withFileLock(eventsPath, async () => {
    await appendJsonl(eventsPath, parsed);
  });
}

export async function appendEvents(root: string | undefined, events: MemoryEvent[]): Promise<void> {
  const parsed = events.map((event) => MemoryEventSchema.parse(event));
  const eventsPath = getEventsPath(root);
  await withFileLock(eventsPath, async () => {
    await appendJsonl(eventsPath, parsed);
  });
}

export async function readAllEvents(root: string | undefined): Promise<MemoryEvent[]> {
  try {
    const raw = await fs.readFile(getEventsPath(root), "utf8");

    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => MemoryEventSchema.parse(JSON.parse(line)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function readEventsByMemoryId(
  root: string | undefined,
  memoryId: string,
): Promise<MemoryEvent[]> {
  const events = await readAllEvents(root);
  return events.filter((event) => event.memoryId === memoryId);
}
