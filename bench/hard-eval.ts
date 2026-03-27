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
  focus: "knowledge_update" | "multi_hop" | "temporal_reasoning" | "abstention";
  memories: SeedMemory[];
  query: RecallQuery;
  expectedTopKeys?: string[];
  expectedTopKeysAnyOrder?: string[];
  expectedAbsent?: true;
}

interface EvalRow {
  id: string;
  focus: Scenario["focus"];
  passed: boolean;
  actualTopKeys: string[];
}

const scenarios: Scenario[] = [
  {
    id: "current-home-over-stale-current-string",
    focus: "knowledge_update",
    memories: [
      {
        key: "stale",
        type: "fact",
        subject: "alice-home",
        content: "Alice currently lives in Busan at her home address",
        tags: ["home", "busan", "current"],
        importance: 0.82,
        strength: 0.82,
      },
      {
        key: "target",
        type: "fact",
        subject: "alice-home",
        content: "Alice moved to Seoul",
        tags: ["home", "seoul"],
        importance: 0.78,
        strength: 0.78,
      },
    ],
    query: {
      text: "where does alice live now current home",
      limit: 3,
    },
    expectedTopKeys: ["target"],
  },
  {
    id: "current-preference-over-older-lexical-match",
    focus: "knowledge_update",
    memories: [
      {
        key: "stale",
        type: "preference",
        subject: "erin-drink",
        content: "Erin currently prefers coffee in the morning",
        tags: ["coffee", "morning", "current"],
        importance: 0.83,
        strength: 0.82,
      },
      {
        key: "target",
        type: "preference",
        subject: "erin-drink",
        content: "Erin switched to tea in the morning",
        tags: ["tea", "morning"],
        importance: 0.79,
        strength: 0.78,
      },
    ],
    query: {
      text: "what does erin prefer now in the morning current preference",
      type: "preference",
      limit: 3,
    },
    expectedTopKeys: ["target"],
  },
  {
    id: "manager-team-two-hop",
    focus: "multi_hop",
    memories: [
      {
        key: "anchor",
        type: "fact",
        subject: "alice",
        content: "Alice's manager is Dana",
        tags: ["manager", "dana"],
        importance: 0.8,
        strength: 0.8,
      },
      {
        key: "target",
        type: "fact",
        subject: "dana",
        content: "Dana works in the platform team",
        tags: ["platform", "team"],
        importance: 0.8,
        strength: 0.8,
      },
      {
        key: "distractor",
        type: "fact",
        subject: "alice",
        content: "Alice likes tea",
        tags: ["tea"],
        importance: 0.6,
        strength: 0.6,
      },
    ],
    query: {
      text: "what team does alice's manager work on",
      limit: 3,
    },
    expectedTopKeysAnyOrder: ["anchor", "target"],
  },
  {
    id: "spouse-city-two-hop",
    focus: "multi_hop",
    memories: [
      {
        key: "anchor",
        type: "fact",
        subject: "mina",
        content: "Mina's spouse is Joon",
        tags: ["spouse", "joon"],
        importance: 0.8,
        strength: 0.8,
      },
      {
        key: "target",
        type: "fact",
        subject: "joon",
        content: "Joon lives in Incheon",
        tags: ["incheon", "home"],
        importance: 0.81,
        strength: 0.8,
      },
      {
        key: "distractor",
        type: "fact",
        subject: "mina",
        content: "Mina prefers ramen",
        tags: ["ramen"],
        importance: 0.63,
        strength: 0.62,
      },
    ],
    query: {
      text: "where does mina's spouse live",
      limit: 3,
    },
    expectedTopKeysAnyOrder: ["anchor", "target"],
  },
  {
    id: "after-jeju-temporal",
    focus: "temporal_reasoning",
    memories: [
      {
        key: "older",
        type: "episode",
        subject: "alice",
        content: "Alice visited Jeju after Busan",
        tags: ["travel", "jeju", "busan"],
        importance: 0.72,
        strength: 0.72,
      },
      {
        key: "target",
        type: "episode",
        subject: "alice",
        content: "Alice visited Daegu after Jeju",
        tags: ["travel", "daegu", "jeju"],
        importance: 0.74,
        strength: 0.74,
      },
      {
        key: "distractor",
        type: "episode",
        subject: "alice",
        content: "Alice visited Busan before Jeju",
        tags: ["travel", "busan", "jeju"],
        importance: 0.7,
        strength: 0.7,
      },
    ],
    query: {
      text: "where did alice go after jeju",
      type: "episode",
      limit: 3,
    },
    expectedTopKeys: ["target"],
  },
  {
    id: "abstain-on-unseen-database-question",
    focus: "abstention",
    memories: [
      {
        key: "fact-a",
        type: "fact",
        subject: "alice",
        content: "Alice lives in Busan",
        tags: ["busan"],
        importance: 0.8,
        strength: 0.8,
      },
      {
        key: "pref-b",
        type: "preference",
        subject: "bob",
        content: "Bob likes tea",
        tags: ["tea"],
        importance: 0.8,
        strength: 0.8,
      },
    ],
    query: {
      text: "what is the user's favorite database",
      limit: 3,
    },
    expectedAbsent: true,
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

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function makeClock(): () => Date {
  const offsets = [
    0,
    1000 * 60 * 60 * 24 * 30,
    1000 * 60 * 60 * 24 * 60,
    1000 * 60 * 60 * 24 * 90,
    1000 * 60 * 60 * 24 * 120,
  ];
  let index = 0;

  return () => {
    const value = offsets[Math.min(index, offsets.length - 1)];
    index += 1;
    return new Date(Date.parse("2026-01-01T00:00:00.000Z") + value);
  };
}

async function evaluateScenario(scenario: Scenario): Promise<EvalRow> {
  return withTempRoot(`silentium-hard-${scenario.id}-`, async (root) => {
    const service = new MemoryService({ root, clock: makeClock() });
    await service.initialize();
    const idsByKey = new Map<string, string>();

    for (const memory of scenario.memories) {
      const saved = await service.remember(memory);
      idsByKey.set(memory.key, saved.id);
    }

    const result = await service.recall(scenario.query);
    const actualTopKeys = result.candidates.slice(0, 3).map((candidate) => {
      return [...idsByKey.entries()].find(([, id]) => id === candidate.memory.id)?.[0] ?? "unknown";
    });

    if (scenario.expectedAbsent) {
      return {
        id: scenario.id,
        focus: scenario.focus,
        passed: result.candidates.length === 0,
        actualTopKeys,
      };
    }

    const expected = scenario.expectedTopKeys ?? [];
    const expectedAnyOrder = scenario.expectedTopKeysAnyOrder ?? [];
    const passed =
      (expected.length > 0 && expected.every((key, index) => actualTopKeys[index] === key)) ||
      (expectedAnyOrder.length > 0 && expectedAnyOrder.every((key) => actualTopKeys.slice(0, expectedAnyOrder.length).includes(key)));

    return {
      id: scenario.id,
      focus: scenario.focus,
      passed,
      actualTopKeys,
    };
  });
}

async function main(): Promise<void> {
  const rows = await Promise.all(scenarios.map((scenario) => evaluateScenario(scenario)));
  const accuracy = rows.filter((row) => row.passed).length / rows.length;

  console.log("silentium hard memory eval");
  console.log("");
  console.log(`pass_rate: ${formatPercent(accuracy)} (${rows.filter((row) => row.passed).length}/${rows.length})`);
  console.log("");

  for (const row of rows) {
    console.log(
      [
        row.id.padEnd(36, " "),
        row.focus.padEnd(18, " "),
        `passed=${String(row.passed).padEnd(5, " ")}`,
        `actual=${row.actualTopKeys.join(",") || "none"}`,
      ].join("  "),
    );
  }
}

await main();
