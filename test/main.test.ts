import { expect, test } from "bun:test";
import { createSilentiumServer } from "../src/main";
import { createTempRoot } from "./support";

test("createSilentiumServer registers core and memory capabilities", async () => {
  const root = await createTempRoot();
  const { server } = await createSilentiumServer({ root });
  const internals = server as unknown as {
    _registeredTools: Record<string, unknown>;
    _registeredResources: Record<string, unknown>;
    _registeredResourceTemplates: Record<string, unknown>;
  };

  expect(Object.keys(internals._registeredTools)).toEqual(
    expect.arrayContaining([
      "remember",
      "recall",
      "get_memory",
      "list_memories",
      "update_memory",
      "reinforce_memory",
      "forget_memory",
    ]),
  );
  expect(Object.keys(internals._registeredResources)).toEqual(expect.arrayContaining(["silentium://memory/stats"]));
  expect(Object.keys(internals._registeredResourceTemplates)).toEqual(
    expect.arrayContaining(["memory-by-id", "memory-by-type"]),
  );

  await server.close();
});
