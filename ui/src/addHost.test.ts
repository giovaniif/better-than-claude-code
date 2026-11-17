import { describe, expect, test } from "bun:test";
import { nameFromDestination } from "./addHost";

describe("nameFromDestination", () => {
  test("a host name gives its first label", () => {
    expect(nameFromDestination("me@box.tail914724.ts.net")).toBe("box");
    expect(nameFromDestination("  devbox  ")).toBe("devbox");
  });
  test("an IPv4 address stays whole, so two tailnet hosts get different names", () => {
    expect(nameFromDestination("me@100.99.215.28")).toBe("100.99.215.28");
    expect(nameFromDestination("100.91.145.6")).toBe("100.91.145.6");
  });
  test("an IPv6 address stays whole, without brackets", () => {
    expect(nameFromDestination("me@fd7a:115c:a1e0::1")).toBe("fd7a:115c:a1e0::1");
    expect(nameFromDestination("me@[fd7a::1]")).toBe("fd7a::1");
  });
  test("nothing typed gives no name", () => {
    expect(nameFromDestination("")).toBe("");
    expect(nameFromDestination("me@")).toBe("");
  });
});
