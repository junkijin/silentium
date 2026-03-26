import { expect, test } from "bun:test";
import {
  MemorySchema,
  RememberInputSchema,
  UpdateMemoryInputSchema,
} from "../src/memory/types";
import { fixturePath, readJson } from "./support";

test("valid fixtures parse successfully", async () => {
  const validMemory = await readJson(fixturePath("types", "valid-memory.json"));
  const parsed = MemorySchema.parse(validMemory);
  const remember = RememberInputSchema.parse({
    type: "fact",
    subject: "user",
    content: "Alice likes tea",
  });

  expect(parsed.id).toBe("mem-001");
  expect(remember.importance).toBe(0.5);
});

test("missing required fields fail parsing", async () => {
  const invalid = await readJson(fixturePath("types", "invalid-missing-subject.json"));

  expect(() => MemorySchema.parse(invalid)).toThrow();
});

test("invalid enum values fail parsing", async () => {
  const invalid = await readJson(fixturePath("types", "invalid-bad-type.json"));

  expect(() => MemorySchema.parse(invalid)).toThrow();
  expect(() => UpdateMemoryInputSchema.parse({ id: "mem-001" })).toThrow();
});
