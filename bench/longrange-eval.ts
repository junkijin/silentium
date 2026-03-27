import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { MemoryService } from "../src/memory/service";
import type { MemoryType, RecallQuery } from "../src/memory/types";

interface SeedMemory {
  key: string;
  type: MemoryType;
  subject: string;
  content: string;
  tags: string[];
  importance: number;
  strength: number;
}

interface Scenario {
  id: string;
  focus: "long_range_understanding";
  memories: SeedMemory[];
  query: RecallQuery;
  expectedTopKey?: string;
  expectedTopKeysAnyOrder?: string[];
}

interface EvalRow {
  id: string;
  passed: boolean;
  actualTopKeys: string[];
}

function distractors(count: number): SeedMemory[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `noise-${index}`,
    type: index % 2 === 0 ? "fact" : "episode",
    subject: `noise-${index}`,
    content: `Noise memory ${index} about unrelated topic`,
    tags: ["noise", `topic-${index}`],
    importance: 0.4 + (index % 5) * 0.05,
    strength: 0.4 + (index % 4) * 0.1,
  }));
}

const scenarios: Scenario[] = [
  {
    id: "three-hop-owner-report-team",
    focus: "long_range_understanding",
    memories: [
      {
        key: "anchor",
        type: "fact",
        subject: "project-a",
        content: "Project A owner is Mina",
        tags: ["owner", "mina"],
        importance: 0.86,
        strength: 0.85,
      },
      {
        key: "bridge",
        type: "fact",
        subject: "mina",
        content: "Mina reports to Joon",
        tags: ["manager", "joon"],
        importance: 0.85,
        strength: 0.84,
      },
      {
        key: "target",
        type: "fact",
        subject: "joon",
        content: "Joon works in the security team",
        tags: ["security", "team"],
        importance: 0.84,
        strength: 0.84,
      },
      ...distractors(30),
    ],
    query: {
      text: "what team does the owner of project a report to",
      limit: 5,
    },
    expectedTopKey: "target",
  },
  {
    id: "alias-three-hop-owner-report-team",
    focus: "long_range_understanding",
    memories: [
      {
        key: "alias",
        type: "fact",
        subject: "project-a",
        content: "The bluebird launch refers to Project A",
        tags: ["bluebird", "launch"],
        importance: 0.85,
        strength: 0.85,
      },
      {
        key: "anchor",
        type: "fact",
        subject: "project-a",
        content: "Project A owner is Mina",
        tags: ["owner", "mina"],
        importance: 0.84,
        strength: 0.84,
      },
      {
        key: "bridge",
        type: "fact",
        subject: "mina",
        content: "Mina reports to Joon",
        tags: ["manager", "joon"],
        importance: 0.84,
        strength: 0.84,
      },
      {
        key: "target",
        type: "fact",
        subject: "joon",
        content: "Joon works in the payments team",
        tags: ["payments", "team"],
        importance: 0.84,
        strength: 0.84,
      },
      ...distractors(30),
    ],
    query: {
      text: "what team does the bluebird launch owner report to",
      limit: 5,
    },
    expectedTopKeysAnyOrder: ["alias", "target"],
  },
];

async function withTempRoot<T>(prefix: string, callback: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));

  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function makeClock(): () => Date {
  let index = 0;
  return () => new Date(Date.parse("2025-01-01T00:00:00.000Z") + Math.min(index++, 365) * 86_400_000);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function evaluateScenario(scenario: Scenario): Promise<EvalRow> {
  return withTempRoot(`silentium-longrange-${scenario.id}-`, async (root) => {
    const service = new MemoryService({ root, clock: makeClock() });
    await service.initialize();
    const idsByKey = new Map<string, string>();

    for (const memory of scenario.memories) {
      const saved = await service.remember(memory);
      idsByKey.set(memory.key, saved.id);
    }

    const result = await service.recall(scenario.query);
    const actualTopKeys = result.candidates.slice(0, 5).map((candidate) => {
      return [...idsByKey.entries()].find(([, id]) => id === candidate.memory.id)?.[0] ?? "unknown";
    });

    const passed =
      (scenario.expectedTopKey !== undefined && actualTopKeys[0] === scenario.expectedTopKey) ||
      (scenario.expectedTopKeysAnyOrder !== undefined &&
        scenario.expectedTopKeysAnyOrder.every((key) =>
          actualTopKeys.slice(0, scenario.expectedTopKeysAnyOrder!.length).includes(key),
        ));

    return {
      id: scenario.id,
      passed,
      actualTopKeys,
    };
  });
}

async function main(): Promise<void> {
  const rows = await Promise.all(scenarios.map((scenario) => evaluateScenario(scenario)));
  const passRate = rows.filter((row) => row.passed).length / rows.length;

  console.log("silentium long-range memory eval");
  console.log("");
  console.log(`pass_rate: ${formatPercent(passRate)} (${rows.filter((row) => row.passed).length}/${rows.length})`);
  console.log("");

  for (const row of rows) {
    console.log(
      [
        row.id.padEnd(32, " "),
        `passed=${String(row.passed).padEnd(5, " ")}`,
        `actual=${row.actualTopKeys.join(",") || "none"}`,
      ].join("  "),
    );
  }
}

await main();
