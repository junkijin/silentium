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
  focus: "conflict_resolution" | "test_time_learning" | "constraint_bundle";
  memories: SeedMemory[];
  query: RecallQuery;
  expectedTopKey?: string;
  expectedTopKeysAnyOrder?: string[];
}

interface EvalRow {
  id: string;
  focus: Scenario["focus"];
  passed: boolean;
  actualTopKeys: string[];
}

const scenarios: Scenario[] = [
  {
    id: "conflict-nut-allergy",
    focus: "conflict_resolution",
    memories: [
      {
        key: "stale",
        type: "preference",
        subject: "diet",
        content: "The user is allergic to peanuts",
        tags: ["allergy", "peanuts"],
        importance: 0.9,
        strength: 0.9,
      },
      {
        key: "target",
        type: "preference",
        subject: "diet",
        content: "Correction: the user is allergic to almonds, not peanuts",
        tags: ["allergy", "almonds"],
        importance: 0.9,
        strength: 0.9,
      },
    ],
    query: {
      text: "what nuts is the user allergic to now current allergy",
      limit: 3,
    },
    expectedTopKey: "target",
  },
  {
    id: "flight-rule-over-episode",
    focus: "test_time_learning",
    memories: [
      {
        key: "target",
        type: "preference",
        subject: "travel-rule",
        content: "When booking travel, never choose flights before 10 AM",
        tags: ["travel", "flight", "rule", "morning"],
        importance: 0.88,
        strength: 0.85,
      },
      {
        key: "distractor",
        type: "episode",
        subject: "travel-notes",
        content: "A red-eye flight was discussed and rejected",
        tags: ["flight", "rejected"],
        importance: 0.7,
        strength: 0.7,
      },
    ],
    query: {
      text: "what rule did i teach you for booking flights",
      limit: 3,
    },
    expectedTopKey: "target",
  },
  {
    id: "trip-constraint-bundle",
    focus: "constraint_bundle",
    memories: [
      {
        key: "budget",
        type: "preference",
        subject: "trip-budget",
        content: "Keep the hotel under 200 dollars per night",
        tags: ["hotel", "budget", "200"],
        importance: 0.82,
        strength: 0.8,
      },
      {
        key: "seat",
        type: "preference",
        subject: "trip-seat",
        content: "Prefer aisle seats on flights",
        tags: ["flight", "aisle", "seat"],
        importance: 0.8,
        strength: 0.8,
      },
      {
        key: "chain",
        type: "preference",
        subject: "trip-chain",
        content: "Prefer Marriott hotels when possible",
        tags: ["hotel", "marriott"],
        importance: 0.78,
        strength: 0.78,
      },
      {
        key: "distractor",
        type: "episode",
        subject: "trip-noise",
        content: "A noisy hostel ruined the last trip",
        tags: ["hotel", "noise"],
        importance: 0.68,
        strength: 0.65,
      },
      {
        key: "city",
        type: "fact",
        subject: "city",
        content: "The destination city is Tokyo",
        tags: ["tokyo"],
        importance: 0.7,
        strength: 0.7,
      },
    ],
    query: {
      text: "what constraints should you remember for my trip booking hotel and flight",
      limit: 4,
    },
    expectedTopKeysAnyOrder: ["budget", "seat", "chain"],
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
  const offsets = [0, 1000 * 60 * 60 * 24, 1000 * 60 * 60 * 24 * 30, 1000 * 60 * 60 * 24 * 60];
  let index = 0;

  return () => {
    const value = offsets[Math.min(index, offsets.length - 1)];
    index += 1;
    return new Date(Date.parse("2026-01-01T00:00:00.000Z") + value);
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function evaluateScenario(scenario: Scenario): Promise<EvalRow> {
  return withTempRoot(`silentium-adv-${scenario.id}-`, async (root) => {
    const service = new MemoryService({ root, clock: makeClock() });
    await service.initialize();
    const idsByKey = new Map<string, string>();

    for (const memory of scenario.memories) {
      const saved = await service.remember(memory);
      idsByKey.set(memory.key, saved.id);
    }

    const result = await service.recall(scenario.query);
    const actualTopKeys = result.candidates.slice(0, 4).map((candidate) => {
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
      focus: scenario.focus,
      passed,
      actualTopKeys,
    };
  });
}

async function main(): Promise<void> {
  const rows = await Promise.all(scenarios.map((scenario) => evaluateScenario(scenario)));
  const passRate = rows.filter((row) => row.passed).length / rows.length;

  console.log("silentium adversarial memory eval");
  console.log("");
  console.log(`pass_rate: ${formatPercent(passRate)} (${rows.filter((row) => row.passed).length}/${rows.length})`);
  console.log("");

  for (const row of rows) {
    console.log(
      [
        row.id.padEnd(30, " "),
        row.focus.padEnd(20, " "),
        `passed=${String(row.passed).padEnd(5, " ")}`,
        `actual=${row.actualTopKeys.join(",") || "none"}`,
      ].join("  "),
    );
  }
}

await main();
