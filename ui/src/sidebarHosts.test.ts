import { describe, expect, test } from "bun:test";
import { readHidden, shownHosts, withHostShown } from "./sidebarHosts";

describe("readHidden", () => {
  test("a saved list of host ids", () => {
    expect(readHidden('["local","h1"]')).toEqual(["local", "h1"]);
  });
  test("nothing saved, or something unreadable, hides nothing", () => {
    expect(readHidden(null)).toEqual([]);
    expect(readHidden("not json")).toEqual([]);
    expect(readHidden('{"local":true}')).toEqual([]);
    expect(readHidden('["local",3,null]')).toEqual(["local"]);
  });
});

describe("shownHosts", () => {
  test("keeps the order and leaves out the hidden ones, This Mac included", () => {
    expect(shownHosts(["local", "h1", "h2"], [])).toEqual(["local", "h1", "h2"]);
    expect(shownHosts(["local", "h1", "h2"], ["local"])).toEqual(["h1", "h2"]);
    expect(shownHosts(["local", "h1", "h2"], ["h1", "local"])).toEqual(["h2"]);
  });
  test("an id of a host that is gone changes nothing", () => {
    expect(shownHosts(["local"], ["removed"])).toEqual(["local"]);
  });
  test("every host can be hidden", () => {
    expect(shownHosts(["local", "h1"], ["local", "h1"])).toEqual([]);
  });
});

describe("withHostShown", () => {
  test("hiding adds the id once, showing removes it", () => {
    expect(withHostShown([], "local", false)).toEqual(["local"]);
    expect(withHostShown(["local"], "local", false)).toEqual(["local"]);
    expect(withHostShown(["local", "h1"], "local", true)).toEqual(["h1"]);
    expect(withHostShown(["h1"], "local", true)).toEqual(["h1"]);
  });
});
