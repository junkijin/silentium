import { expect, test } from "bun:test";
import {
  applyRecallToMemoryState,
  forgetMemoryState,
  formMemoryState,
  reinforceMemoryState,
  supersedeMemoryState,
  weakenMemoryState,
} from "../src/memory/stateMachine";
import type { RememberInput } from "../src/memory/types";

const rememberInput: RememberInput = {
  type: "fact",
  subject: "user",
  content: "Alice likes tea",
  tags: ["tea"],
  importance: 0.6,
  strength: 0.5,
};

test("state machine transitions return expected state without mutation", () => {
  const formed = formMemoryState(rememberInput, {
    id: "mem-001",
    now: "2026-03-27T00:00:00.000Z",
  });
  const original = structuredClone(formed);

  const reinforced = reinforceMemoryState(formed, {
    now: "2026-03-27T00:01:00.000Z",
    amount: 0.2,
  });
  const weakened = weakenMemoryState(reinforced, {
    now: "2026-03-27T00:02:00.000Z",
    amount: 0.3,
  });
  const recalled = applyRecallToMemoryState(weakened, {
    now: "2026-03-27T00:03:00.000Z",
  });
  const superseded = supersedeMemoryState(recalled, {
    now: "2026-03-27T00:04:00.000Z",
    replacementId: "mem-002",
  });
  const forgotten = forgetMemoryState(recalled, {
    now: "2026-03-27T00:05:00.000Z",
  });

  expect(formed).toEqual(original);
  expect(reinforced.strength).toBe(0.7);
  expect(reinforced.reinforcementCount).toBe(1);
  expect(weakened.strength).toBe(0.4);
  expect(recalled.recallCount).toBe(1);
  expect(recalled.lastAccessedAt).toBe("2026-03-27T00:03:00.000Z");
  expect(superseded.status).toBe("superseded");
  expect(superseded.supersededBy).toBe("mem-002");
  expect(forgotten.status).toBe("forgotten");
  expect(forgotten.validTo).toBe("2026-03-27T00:05:00.000Z");
});
