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
  focus: "subject_fidelity" | "type_disambiguation" | "temporal_recency";
  memories: SeedMemory[];
  query: RecallQuery;
  expectedTopKey: string;
  expectedTop3Keys: string[];
}

interface EvalRow {
  id: string;
  focus: Scenario["focus"];
  top1: boolean;
  top3: boolean;
  expected: string;
  actualTop: string | null;
}

const scenarios: Scenario[] = [
  {
    id: "subject-alice-preference",
    focus: "subject_fidelity",
    memories: [
      {
        key: "target",
        type: "preference",
        subject: "alice",
        content: "Alice prefers green tea every morning",
        tags: ["tea", "morning"],
        importance: 0.72,
        strength: 0.63,
      },
      {
        key: "distractor",
        type: "fact",
        subject: "team-notes",
        content: "Alice morning tea preference was captured in notes",
        tags: ["tea", "morning"],
        importance: 0.78,
        strength: 0.7,
      },
    ],
    query: {
      text: "alice tea morning preference",
      limit: 3,
    },
    expectedTopKey: "target",
    expectedTop3Keys: ["target"],
  },
  {
    id: "subject-bob-profile",
    focus: "subject_fidelity",
    memories: [
      {
        key: "target",
        type: "fact",
        subject: "bob",
        content: "Bob lives in Busan and works remotely",
        tags: ["busan", "remote"],
        importance: 0.7,
        strength: 0.64,
      },
      {
        key: "distractor",
        type: "episode",
        subject: "meeting-notes",
        content: "Bob mentioned living in Busan during the remote standup",
        tags: ["busan", "remote"],
        importance: 0.75,
        strength: 0.69,
      },
    ],
    query: {
      text: "bob busan remote profile",
      limit: 3,
    },
    expectedTopKey: "target",
    expectedTop3Keys: ["target"],
  },
  {
    id: "type-preference-over-fact",
    focus: "type_disambiguation",
    memories: [
      {
        key: "target",
        type: "preference",
        subject: "charlie",
        content: "Charlie prefers quiet seats near the window",
        tags: ["seat", "window"],
        importance: 0.73,
        strength: 0.66,
      },
      {
        key: "distractor",
        type: "fact",
        subject: "travel-notes",
        content: "Charlie requested a quiet window seat on the last trip",
        tags: ["seat", "window"],
        importance: 0.79,
        strength: 0.72,
      },
    ],
    query: {
      text: "charlie window seat preference",
      limit: 3,
    },
    expectedTopKey: "target",
    expectedTop3Keys: ["target"],
  },
  {
    id: "type-episode-over-fact",
    focus: "type_disambiguation",
    memories: [
      {
        key: "target",
        type: "episode",
        subject: "dana",
        content: "Dana visited Jeju during the spring retreat",
        tags: ["travel", "jeju"],
        importance: 0.76,
        strength: 0.67,
      },
      {
        key: "distractor",
        type: "fact",
        subject: "travel-summary",
        content: "Dana has a recurring Jeju travel plan in the notes",
        tags: ["travel", "jeju"],
        importance: 0.8,
        strength: 0.73,
      },
    ],
    query: {
      text: "dana jeju travel episode",
      limit: 3,
    },
    expectedTopKey: "target",
    expectedTop3Keys: ["target"],
  },
  {
    id: "latest-episode-alice",
    focus: "temporal_recency",
    memories: [
      {
        key: "older",
        type: "episode",
        subject: "alice",
        content: "Alice visited Busan on March 3",
        tags: ["travel", "busan"],
        importance: 0.7,
        strength: 0.65,
      },
      {
        key: "target",
        type: "episode",
        subject: "alice",
        content: "Alice visited Jeju on March 8",
        tags: ["travel", "jeju"],
        importance: 0.74,
        strength: 0.69,
      },
    ],
    query: {
      text: "where did alice visit most recently",
      type: "episode",
      limit: 3,
    },
    expectedTopKey: "target",
    expectedTop3Keys: ["target"],
  },
  {
    id: "latest-preference-update",
    focus: "temporal_recency",
    memories: [
      {
        key: "older",
        type: "preference",
        subject: "erin",
        content: "Erin prefers coffee in the morning",
        tags: ["coffee", "morning"],
        importance: 0.71,
        strength: 0.66,
      },
      {
        key: "target",
        type: "preference",
        subject: "erin",
        content: "Erin prefers tea in the morning",
        tags: ["tea", "morning"],
        importance: 0.74,
        strength: 0.69,
      },
    ],
    query: {
      text: "erin morning preference",
      type: "preference",
      limit: 3,
    },
    expectedTopKey: "target",
    expectedTop3Keys: ["target", "older"],
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

  return () => {
    const base = Date.parse("2026-03-27T00:00:00.000Z");
    const value = new Date(base + index * 60_000);
    index += 1;
    return value;
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function evaluateScenario(scenario: Scenario): Promise<EvalRow> {
  return withTempRoot(`silentium-eval-${scenario.id}-`, async (root) => {
    const service = new MemoryService({ root, clock: makeClock() });
    await service.initialize();
    const idsByKey = new Map<string, string>();

    for (const memory of scenario.memories) {
      const saved = await service.remember(memory);
      idsByKey.set(memory.key, saved.id);
    }

    const result = await service.recall(scenario.query);
    const actualTop = result.candidates[0]?.memory.id ?? null;
    const expectedTop = idsByKey.get(scenario.expectedTopKey) ?? null;
    const top3 = result.candidates.slice(0, 3).map((candidate) => candidate.memory.id);
    const expectedTop3 = scenario.expectedTop3Keys
      .map((key) => idsByKey.get(key))
      .filter((id): id is string => Boolean(id));

    return {
      id: scenario.id,
      focus: scenario.focus,
      top1: actualTop !== null && actualTop === expectedTop,
      top3: expectedTop3.every((id) => top3.includes(id)),
      expected: scenario.expectedTopKey,
      actualTop: [...idsByKey.entries()].find(([, id]) => id === actualTop)?.[0] ?? null,
    };
  });
}

async function main(): Promise<void> {
  const rows = await Promise.all(scenarios.map((scenario) => evaluateScenario(scenario)));
  const top1 = rows.filter((row) => row.top1).length / rows.length;
  const top3 = rows.filter((row) => row.top3).length / rows.length;

  console.log("silentium memory eval");
  console.log("");
  console.log(`top1: ${formatPercent(top1)} (${rows.filter((row) => row.top1).length}/${rows.length})`);
  console.log(`top3: ${formatPercent(top3)} (${rows.filter((row) => row.top3).length}/${rows.length})`);
  console.log("");

  for (const row of rows) {
    console.log(
      [
        row.id.padEnd(28, " "),
        row.focus.padEnd(20, " "),
        `top1=${String(row.top1).padEnd(5, " ")}`,
        `top3=${String(row.top3).padEnd(5, " ")}`,
        `expected=${row.expected.padEnd(10, " ")}`,
        `actual=${row.actualTop ?? "none"}`,
      ].join("  "),
    );
  }
}

await main();
