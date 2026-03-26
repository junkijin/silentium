import { expect, test } from "bun:test";
import os from "node:os";
import {
  getArchiveFilePath,
  getEventsPath,
  getIndexPathByStatus,
  getIndexPathBySubject,
  getIndexPathByType,
  getInvertedIndexPath,
  getMemoryFilePath,
  getMemoryRoot,
  getStatsPath,
} from "../src/memory/paths";

test("memory path helpers return deterministic absolute paths", () => {
  const root = "/tmp/silentium-root";

  expect(getMemoryRoot(root)).toBe("/tmp/silentium-root");
  expect(getEventsPath(root)).toBe("/tmp/silentium-root/events.jsonl");
  expect(getMemoryFilePath(root, "mem-001")).toBe("/tmp/silentium-root/memories/mem-001.json");
  expect(getArchiveFilePath(root, "mem-001")).toBe("/tmp/silentium-root/archive/mem-001.json");
  expect(getIndexPathByType(root, "fact")).toBe("/tmp/silentium-root/index/by-type/fact.json");
  expect(getIndexPathBySubject(root, "User Profile")).toBe(
    "/tmp/silentium-root/index/by-subject/user-profile.json",
  );
  expect(getIndexPathByStatus(root, "active")).toBe("/tmp/silentium-root/index/by-status/active.json");
  expect(getInvertedIndexPath(root)).toBe("/tmp/silentium-root/index/inverted.json");
  expect(getStatsPath(root)).toBe("/tmp/silentium-root/stats.json");
});

test("default memory root follows XDG data directory rules", () => {
  const previousXdgDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = "/tmp/xdg-data-home";

  expect(getMemoryRoot()).toBe("/tmp/xdg-data-home/silentium/memory");

  if (typeof previousXdgDataHome === "undefined") {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = previousXdgDataHome;
  }

  expect(getMemoryRoot()).toBe(`${os.homedir()}/.local/share/silentium/memory`);
});
