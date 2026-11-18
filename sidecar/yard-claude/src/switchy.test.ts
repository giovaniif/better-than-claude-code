import {expect, test} from "bun:test";
import {readOnlySwitchy, switchyProfile} from "./switchy";

test("Switchy plan profile keeps tools disabled; explicit access retains SDK tools and permissions", () => {
  for (const permission of [undefined, "plan"]) {
    const start = {switchy: true, permission};
    expect(readOnlySwitchy(start)).toBe(true);
    expect(switchyProfile(start).tools).toEqual([]);
    expect(switchyProfile(start).allowDangerouslySkipPermissions).toBe(false);
  }
  for (const permission of ["ask", "acceptEdits", "full"]) {
    expect(readOnlySwitchy({switchy: true, permission})).toBe(false);
    expect(switchyProfile({switchy: true, permission})).toEqual({persistSession:false});
  }
  expect(switchyProfile({permission:"plan"})).toEqual({});
});
