import { expect, test } from "bun:test";
import { mobileHost, mobileLink, testFlightLink } from "./mobile";
import { initial, reduce } from "./store";

test("phone setup accepts only private-network HTTPS page origins", () => {
  expect(mobileHost(" https://yard.example.ts.net/ ")).toBe("https://yard.example.ts.net");
  for (const value of ["http://yard.test", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://user:pass@yard.test", "https://yard.test/path", "https://yard.test/?token=x"]) {
    expect(mobileHost(value)).toBeNull();
  }
  const link = new URL(mobileLink("https://yard.test:8443")!);
  expect(link.protocol).toBe("switchyard:");
  expect(link.searchParams.get("host")).toBe("https://yard.test:8443");
  expect(mobileLink("http://localhost:47717")).toBeNull();
});

test("only real TestFlight invitations become install links", () => {
  expect(testFlightLink("https://testflight.apple.com/join/AbCd1234")).toBe("https://testflight.apple.com/join/AbCd1234");
  for (const value of [undefined, "javascript:alert(1)", "https://testflight.apple.com.evil/join/AbCd1234", "https://testflight.apple.com/", "https://testflight.apple.com/join/REPLACE_ME"]) expect(testFlightLink(value)).toBeNull();
});

test("setup state follows the hub, survives snapshots and ignores remote phones", () => {
  const connected = reduce(initial, { t: "server", msg: { op: "mobile.status", mobile: { configured: true } } });
  expect(connected.mobile.configured).toBe(true);
  expect(reduce(connected, { t: "server", msg: { op: "mobile.status", hostId: "remote", mobile: { configured: false } } }).mobile.configured).toBe(true);
  expect(reduce(initial, { t: "server", msg: { op: "snapshot", sessions: [], mobile: { configured: true } } }).mobile.configured).toBe(true);
  expect(reduce(connected, { t: "server", msg: { op: "snapshot", sessions: [] } }).mobile.configured).toBe(false);
});
