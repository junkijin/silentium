import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { MemoryService } from "../src/memory/service";
import type { MemoryType, RecallQuery } from "../src/memory/types";

interface SeedMemory {
  type: MemoryType;
  subject: string;
  content: string;
  tags: string[];
  importance: number;
  strength: number;
}

interface Scenario {
  id: string;
  focus:
    | "knowledge_update"
    | "constraint_bundle"
    | "multi_hop"
    | "temporal_reasoning"
    | "abstention";
  memories: SeedMemory[];
  query: RecallQuery;
  validator: (contents: string[]) => boolean;
}

interface EvalRow {
  id: string;
  focus: Scenario["focus"];
  passed: boolean;
  actualTopContents: string[];
}

const PERSON_PROFILES = [
  {
    person: "alice",
    manager: "dana",
    director: "mina",
    team: "platform",
    previousCity: "busan",
    currentCity: "seoul",
    previousDrink: "coffee",
    currentDrink: "green tea",
    previousTrip: "busan",
    currentTrip: "jeju",
    hotelBrand: "marriott",
    airlineSeat: "aisle",
    budget: "180",
  },
  {
    person: "erin",
    manager: "joon",
    director: "soyeon",
    team: "security",
    previousCity: "incheon",
    currentCity: "daejeon",
    previousDrink: "latte",
    currentDrink: "barley tea",
    previousTrip: "tokyo",
    currentTrip: "sapporo",
    hotelBrand: "hilton",
    airlineSeat: "window",
    budget: "220",
  },
  {
    person: "harin",
    manager: "minho",
    director: "yujin",
    team: "payments",
    previousCity: "daegu",
    currentCity: "seoul",
    previousDrink: "juice",
    currentDrink: "oolong tea",
    previousTrip: "osaka",
    currentTrip: "fukuoka",
    hotelBrand: "hyatt",
    airlineSeat: "aisle",
    budget: "200",
  },
  {
    person: "mina",
    manager: "taeho",
    director: "jiwon",
    team: "growth",
    previousCity: "gwangju",
    currentCity: "busan",
    previousDrink: "milk",
    currentDrink: "black tea",
    previousTrip: "jeju",
    currentTrip: "singapore",
    hotelBrand: "accor",
    airlineSeat: "window",
    budget: "190",
  },
] as const;

function makeClock(): () => Date {
  let index = 0;

  return () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const value = new Date(base + Math.min(index, 365) * 86_400_000);
    index += 1;
    return value;
  };
}

function distractors(seed: number, count: number): SeedMemory[] {
  return Array.from({ length: count }, (_, index) => {
    const offset = seed * 100 + index;
    const type = (["fact", "preference", "episode"] as const)[offset % 3];

    return {
      type,
      subject: `noise-${seed}-${index}`,
      content: `Noise memory ${seed}-${index} about routine topic ${offset}`,
      tags: ["noise", `topic-${offset}`],
      importance: 0.38 + (offset % 5) * 0.06,
      strength: 0.36 + (offset % 4) * 0.1,
    };
  });
}

function buildKnowledgeUpdateScenarios(): Scenario[] {
  return PERSON_PROFILES.flatMap((profile, profileIndex) => {
    return Array.from({ length: 6 }, (_, variant) => {
      const useDrink = variant % 2 === 0;
      const query = useDrink
        ? `what beverage does ${profile.person} prefer now in the morning`
        : `where does ${profile.person} reside now`;
      const targetText = useDrink
        ? `${profile.person} switched to ${profile.currentDrink} in the morning`
        : `${profile.person} moved to ${profile.currentCity}`;
      const staleText = useDrink
        ? `${profile.person} currently prefers ${profile.previousDrink} in the morning`
        : `${profile.person} currently lives in ${profile.previousCity}`;

      return {
        id: `knowledge-update-${profile.person}-${variant}`,
        focus: "knowledge_update",
        memories: [
          {
            type: useDrink ? "preference" : "fact",
            subject: `${profile.person}-${useDrink ? "drink" : "home"}`,
            content: staleText,
            tags: useDrink
              ? [profile.previousDrink.split(" ")[0]!, "morning", "current"]
              : [profile.previousCity, "home", "current"],
            importance: 0.84,
            strength: 0.83,
          },
          {
            type: useDrink ? "preference" : "fact",
            subject: `${profile.person}-${useDrink ? "drink" : "home"}`,
            content: targetText,
            tags: useDrink
              ? [profile.currentDrink.split(" ")[0]!, "morning"]
              : [profile.currentCity, "home"],
            importance: 0.8,
            strength: 0.79,
          },
          ...distractors(profileIndex * 10 + variant, 14),
        ],
        query: {
          text: query,
          type: useDrink ? "preference" : "fact",
          limit: 5,
        },
        validator: (contents) => contents[0]?.includes(targetText) ?? false,
      };
    });
  });
}

function buildConstraintBundleScenarios(): Scenario[] {
  return PERSON_PROFILES.flatMap((profile, profileIndex) => {
    return Array.from({ length: 6 }, (_, variant) => {
      const useSynonyms = variant % 2 === 0;
      const hotelPhrase = useSynonyms ? "lodging" : "hotel";
      const flightPhrase = useSynonyms ? "plane seating" : "flight seat";
      const query = `what trip rules should you remember for ${hotelPhrase} and ${flightPhrase} booking`;
      const expectedFragments = [
        `under ${profile.budget} dollars`,
        `${profile.airlineSeat} seats`,
        profile.hotelBrand,
      ];

      return {
        id: `constraint-bundle-${profile.person}-${variant}`,
        focus: "constraint_bundle",
        memories: [
          {
            type: "preference",
            subject: `${profile.person}-trip-budget`,
            content: `Keep the hotel under ${profile.budget} dollars per night`,
            tags: ["hotel", "budget", profile.budget],
            importance: 0.84,
            strength: 0.82,
          },
          {
            type: "preference",
            subject: `${profile.person}-trip-seat`,
            content: `Prefer ${profile.airlineSeat} seats on flights`,
            tags: ["flight", profile.airlineSeat, "seat"],
            importance: 0.82,
            strength: 0.81,
          },
          {
            type: "preference",
            subject: `${profile.person}-trip-brand`,
            content: `Prefer ${profile.hotelBrand} hotels when possible`,
            tags: ["hotel", profile.hotelBrand],
            importance: 0.8,
            strength: 0.79,
          },
          {
            type: "episode",
            subject: `${profile.person}-trip-noise`,
            content: `A noisy hostel ruined ${profile.person}'s last trip`,
            tags: ["trip", "hotel", "noise"],
            importance: 0.66,
            strength: 0.64,
          },
          ...distractors(100 + profileIndex * 10 + variant, 14),
        ],
        query: {
          text: query,
          limit: 4,
        },
        validator: (contents) => expectedFragments.every((fragment) => contents.slice(0, 3).some((content) => content.includes(fragment))),
      };
    });
  });
}

function buildMultiHopScenarios(): Scenario[] {
  return PERSON_PROFILES.flatMap((profile, profileIndex) => {
    return Array.from({ length: 6 }, (_, variant) => {
      const query =
        variant % 2 === 0
          ? `which org does ${profile.person}'s boss belong to`
          : `what team does the owner of launch ${profileIndex}-${variant} report to`;

      const memories =
        variant % 2 === 0
          ? [
              {
                type: "fact" as const,
                subject: profile.person,
                content: `${profile.person}'s manager is ${profile.manager}`,
                tags: ["manager", profile.manager],
                importance: 0.83,
                strength: 0.82,
              },
              {
                type: "fact" as const,
                subject: profile.manager,
                content: `${profile.manager} works in the ${profile.team} team`,
                tags: [profile.team, "team"],
                importance: 0.82,
                strength: 0.81,
              },
              {
                type: "fact" as const,
                subject: profile.person,
                content: `${profile.person} likes noodles`,
                tags: ["food", "noodles"],
                importance: 0.63,
                strength: 0.62,
              },
            ]
          : [
              {
                type: "fact" as const,
                subject: `launch-${profileIndex}-${variant}`,
                content: `Launch ${profileIndex}-${variant} owner is ${profile.person}`,
                tags: ["owner", profile.person],
                importance: 0.84,
                strength: 0.83,
              },
              {
                type: "fact" as const,
                subject: profile.person,
                content: `${profile.person} reports to ${profile.manager}`,
                tags: ["report", profile.manager],
                importance: 0.83,
                strength: 0.82,
              },
              {
                type: "fact" as const,
                subject: profile.manager,
                content: `${profile.manager} works in the ${profile.team} team`,
                tags: [profile.team, "team"],
                importance: 0.82,
                strength: 0.81,
              },
            ];

      return {
        id: `multi-hop-${profile.person}-${variant}`,
        focus: "multi_hop",
        memories: [...memories, ...distractors(200 + profileIndex * 10 + variant, 18)],
        query: {
          text: query,
          limit: 5,
        },
        validator: (contents) => contents[0]?.includes(`${profile.team} team`) ?? false,
      };
    });
  });
}

function buildTemporalScenarios(): Scenario[] {
  return PERSON_PROFILES.flatMap((profile, profileIndex) => {
    return Array.from({ length: 6 }, (_, variant) => {
      const query =
        variant % 2 === 0
          ? `where did ${profile.person} go after ${profile.previousTrip}`
          : `where did ${profile.person} visit on the latest trip`;
      const targetText =
        variant % 2 === 0
          ? `${profile.person} visited ${profile.currentTrip} after ${profile.previousTrip}`
          : `${profile.person} visited ${profile.currentTrip} on the latest trip`;

      return {
        id: `temporal-${profile.person}-${variant}`,
        focus: "temporal_reasoning",
        memories: [
          {
            type: "episode",
            subject: profile.person,
            content: `${profile.person} visited ${profile.previousTrip} before ${profile.currentTrip}`,
            tags: ["travel", profile.previousTrip, profile.currentTrip],
            importance: 0.78,
            strength: 0.77,
          },
          {
            type: "episode",
            subject: profile.person,
            content: targetText,
            tags: ["travel", profile.currentTrip, profile.previousTrip, "latest"],
            importance: 0.8,
            strength: 0.79,
          },
          {
            type: "episode",
            subject: profile.person,
            content: `${profile.person} visited an unrelated stopover before both trips`,
            tags: ["travel", "stopover"],
            importance: 0.65,
            strength: 0.64,
          },
          ...distractors(300 + profileIndex * 10 + variant, 12),
        ],
        query: {
          text: query,
          type: "episode",
          limit: 4,
        },
        validator: (contents) => contents[0]?.includes(targetText) ?? false,
      };
    });
  });
}

function buildAbstentionScenarios(): Scenario[] {
  return PERSON_PROFILES.flatMap((profile, profileIndex) => {
    return Array.from({ length: 6 }, (_, variant) => {
      const query =
        variant % 2 === 0
          ? `what is ${profile.person}'s favorite database engine`
          : `which backend framework does ${profile.person} use most`;

      return {
        id: `abstention-${profile.person}-${variant}`,
        focus: "abstention",
        memories: [
          {
            type: "preference",
            subject: `${profile.person}-drink`,
            content: `${profile.person}'s favorite drink is ${profile.currentDrink}`,
            tags: ["favorite", "drink", profile.currentDrink.split(" ")[0]!],
            importance: 0.8,
            strength: 0.79,
          },
          {
            type: "preference",
            subject: `${profile.person}-travel`,
            content: `${profile.person}'s favorite airline seat is ${profile.airlineSeat}`,
            tags: ["favorite", "seat", profile.airlineSeat],
            importance: 0.78,
            strength: 0.77,
          },
          {
            type: "fact",
            subject: `${profile.person}-city`,
            content: `${profile.person} lives in ${profile.currentCity}`,
            tags: ["home", profile.currentCity],
            importance: 0.76,
            strength: 0.75,
          },
          ...distractors(400 + profileIndex * 10 + variant, 10),
        ],
        query: {
          text: query,
          limit: 3,
        },
        validator: (contents) => contents.length === 0,
      };
    });
  });
}

const scenarios: Scenario[] = [
  ...buildKnowledgeUpdateScenarios(),
  ...buildConstraintBundleScenarios(),
  ...buildMultiHopScenarios(),
  ...buildTemporalScenarios(),
  ...buildAbstentionScenarios(),
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

async function evaluateScenario(scenario: Scenario): Promise<EvalRow> {
  return withTempRoot(`silentium-marathon-${scenario.id}-`, async (root) => {
    const service = new MemoryService({ root, clock: makeClock() });
    await service.initialize();

    for (const memory of scenario.memories) {
      await service.remember(memory);
    }

    const result = await service.recall(scenario.query);
    const actualTopContents = result.candidates.map((candidate) => candidate.memory.content);

    return {
      id: scenario.id,
      focus: scenario.focus,
      passed: scenario.validator(actualTopContents),
      actualTopContents,
    };
  });
}

async function main(): Promise<void> {
  const rows = await Promise.all(scenarios.map((scenario) => evaluateScenario(scenario)));
  const passedCount = rows.filter((row) => row.passed).length;
  const passRate = passedCount / rows.length;
  const byFocus = new Map<Scenario["focus"], { total: number; passed: number }>();

  for (const row of rows) {
    const summary = byFocus.get(row.focus) ?? { total: 0, passed: 0 };
    summary.total += 1;
    summary.passed += row.passed ? 1 : 0;
    byFocus.set(row.focus, summary);
  }

  console.log("silentium marathon long-memory eval");
  console.log("");
  console.log(`scenario_count: ${rows.length}`);
  console.log(`pass_rate: ${formatPercent(passRate)} (${passedCount}/${rows.length})`);
  console.log("");

  for (const [focus, summary] of byFocus.entries()) {
    console.log(`${focus.padEnd(20, " ")}  ${formatPercent(summary.passed / summary.total)} (${summary.passed}/${summary.total})`);
  }

  const failures = rows.filter((row) => !row.passed).slice(0, 20);

  if (failures.length > 0) {
    console.log("");
    console.log("sample_failures:");

    for (const failure of failures) {
      console.log(
        [
          failure.id.padEnd(32, " "),
          failure.focus.padEnd(20, " "),
          `actual=${failure.actualTopContents.slice(0, 3).join(" | ") || "none"}`,
        ].join("  "),
      );
    }
  }
}

await main();
