import { expect, test } from "bun:test";

// main.ts starts reading stdin when imported, so the tests only bundle it:
// that catches what `bun build --compile` in CI and the Dockerfile would.
test("the sidecar's entry point bundles", async () => {
  const result = await Bun.build({ entrypoints: [`${import.meta.dir}/main.ts`], target: "bun", throw: false });
  expect(result.logs.filter((l) => l.level === "error").map(String)).toEqual([]);
  expect(result.success).toBe(true);
});
