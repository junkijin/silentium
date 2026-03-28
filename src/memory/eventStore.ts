import { promises as fs } from "node:fs";
import { appendJsonl, withFileLock } from "./fileStore";
import { getEventsPath } from "./paths";
import { MemoryEventSchema, type MemoryEvent } from "./types";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  const eventsPath = getEventsPath(root);

  try {
    const raw = await fs.readFile(eventsPath, "utf8");

    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return MemoryEventSchema.parse(JSON.parse(line));
        } catch (error) {
          throw new Error(
            `Failed to parse event at ${eventsPath}:${index + 1}: ${describeError(error)}`,
          );
        }
      });
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
