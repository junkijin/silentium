import { promises as fs } from "node:fs";
import path from "node:path";

type JsonParser<T> = (value: unknown) => T;

interface LockState {
  busy: boolean;
  queue: Array<() => void>;
}

export interface FileLockHandle {
  key: string;
  released: boolean;
}

const locks = new Map<string, LockState>();

export async function ensureDir(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true });
}

export async function readJsonFile<T>(
  filePath: string,
  parser?: JsonParser<T>,
): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parser ? parser(parsed) : (parsed as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function appendJsonl(filePath: string, entry: unknown | unknown[]): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const entries = Array.isArray(entry) ? entry : [entry];
  const payload = entries.map((item) => JSON.stringify(item)).join("\n");
  await fs.appendFile(filePath, `${payload}\n`, "utf8");
}

export async function listJsonFiles(directoryPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          return listJsonFiles(absolutePath);
        }

        return entry.name.endsWith(".json") ? [absolutePath] : [];
      }),
    );

    return files.flat().sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function acquireFileLock(lockPath: string): Promise<FileLockHandle> {
  const key = path.resolve(lockPath);
  const state = locks.get(key) ?? { busy: false, queue: [] };
  locks.set(key, state);

  if (state.busy) {
    await new Promise<void>((resolve) => {
      state.queue.push(resolve);
    });
  } else {
    state.busy = true;
  }

  state.busy = true;

  return {
    key,
    released: false,
  };
}

export async function releaseFileLock(handle: FileLockHandle): Promise<void> {
  if (handle.released) {
    return;
  }

  const state = locks.get(handle.key);
  handle.released = true;

  if (!state) {
    return;
  }

  const next = state.queue.shift();

  if (next) {
    next();
    return;
  }

  state.busy = false;
  locks.delete(handle.key);
}

export async function withFileLock<T>(lockPath: string, callback: () => Promise<T>): Promise<T> {
  const handle = await acquireFileLock(lockPath);

  try {
    return await callback();
  } finally {
    await releaseFileLock(handle);
  }
}
