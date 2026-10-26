// @vitest-environment jsdom

import { afterEach, describe, expect, test } from "vitest";
import { loadLanguage } from "../../logic/i18n.ts";
import { clockTime, minutesOf, nycMinute, statusAt } from "./hours.ts";

describe("minutesOf", () => {
  test("reads HH:MM as minutes past midnight", () => {
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("22:00")).toBe(1320);
    expect(minutesOf("24:00")).toBe(1440);
  });
  test("anything that is not a time of day is null", () => {
    for (const time of ["24:01", "12:60", "7:00", "22:00 ", "noon", "", undefined]) {
      expect(minutesOf(time)).toBeNull();
    }
  });
});

describe("statusAt", () => {
  test("00:00 to 24:00, or the same time twice, is open all day", () => {
    expect(statusAt("00:00", "24:00", 600)).toEqual({ state: "always" });
    expect(statusAt("09:00", "09:00", 600)).toEqual({ state: "always" });
  });
  test("a daytime center is open from its opening minute until its closing one", () => {
    expect(statusAt("09:00", "17:00", 539)).toEqual({ state: "closed", opens: 540 });
    expect(statusAt("09:00", "17:00", 540)).toEqual({ state: "open", until: 1020 });
    expect(statusAt("09:00", "17:00", 1019)).toEqual({ state: "open", until: 1020 });
    expect(statusAt("09:00", "17:00", 1020)).toEqual({ state: "closed", opens: 540 });
  });
  test("a closing time before the opening time runs past midnight", () => {
    expect(statusAt("22:00", "05:00", 1319)).toEqual({ state: "closed", opens: 1320 });
    expect(statusAt("22:00", "05:00", 1320)).toEqual({ state: "open", until: 300 });
    expect(statusAt("22:00", "05:00", 0)).toEqual({ state: "open", until: 300 });
    expect(statusAt("22:00", "05:00", 299)).toEqual({ state: "open", until: 300 });
    expect(statusAt("22:00", "05:00", 300)).toEqual({ state: "closed", opens: 1320 });
  });
  test("hours that cannot be read give no status", () => {
    expect(statusAt(undefined, "05:00", 0)).toBeNull();
    expect(statusAt("22:00", "late", 0)).toBeNull();
  });
});

describe("nycMinute", () => {
  test("reads New York time in winter and in summer", () => {
    expect(nycMinute(new Date("2026-01-15T15:30:00Z"))).toBe(10 * 60 + 30);
    expect(nycMinute(new Date("2026-07-15T15:30:00Z"))).toBe(11 * 60 + 30);
  });
  test("follows the clocks across the spring change", () => {
    expect(nycMinute(new Date("2026-03-08T06:59:00Z"))).toBe(1 * 60 + 59);
    expect(nycMinute(new Date("2026-03-08T07:00:00Z"))).toBe(3 * 60);
  });
  test("midnight is minute 0, not 1440", () => {
    expect(nycMinute(new Date("2026-01-15T05:00:00Z"))).toBe(0);
  });
});

describe("clockTime", () => {
  afterEach(() => loadLanguage("en"));

  test("writes English times on a 12-hour clock, minutes only when there are some", () => {
    expect(clockTime(0)).toBe("12 AM");
    expect(clockTime(65)).toBe("1:05 AM");
    expect(clockTime(720)).toBe("12 PM");
    expect(clockTime(1320)).toBe("10 PM");
    expect(clockTime(1350)).toBe("10:30 PM");
    expect(clockTime(1440)).toBe("12 AM");
  });
  test("writes another language's times its own way", async () => {
    await loadLanguage("es");
    expect(clockTime(1320)).toBe("22");
    expect(clockTime(1350)).toBe("22:30");
  });
});
