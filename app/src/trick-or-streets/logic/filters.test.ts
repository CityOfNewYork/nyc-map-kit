import { describe, expect, test } from "vitest";
import { site } from "../../test/fixtures.ts";
import { NO_FILTERS, activeFilters, filtersFromUrl, passes, withFilters } from "./filters.ts";
import type { Filters } from "./filters.ts";

const ghost = site("ghost", { type: "signature", date: "2026-10-31", starts: "10:00", ends: "15:00" });
const pumpkin = site("pumpkin", { type: "partner", date: "2026-10-31", starts: "16:00", ends: "20:00" });
const NOON = 12 * 60;

describe("filters in the address", () => {
  test("reads every filter", () => {
    expect(filtersFromUrl("?type=signature,partner&now=1")).toEqual({
      types: ["signature", "partner"], happeningNow: true,
    });
  });
  test("no parameters is no filters, and only 1 turns a filter on", () => {
    expect(filtersFromUrl("")).toEqual(NO_FILTERS);
    expect(filtersFromUrl("?now=true&type=")).toEqual(NO_FILTERS);
  });
  test("writes the filters in use, takes out the rest, and keeps other parameters", () => {
    const url = new URL("https://example.org/trick-or-streets.html?lang=es&type=partner");
    expect(withFilters(url, { ...NO_FILTERS, happeningNow: true }).search).toBe("?lang=es&now=1");
  });
  test("what is written reads back the same", () => {
    const filters: Filters = { types: ["signature"], happeningNow: true };
    const url = withFilters(new URL("https://example.org/trick-or-streets.html"), filters);
    expect(filtersFromUrl(url.search)).toEqual(filters);
  });
});

describe("activeFilters", () => {
  test("counts the kinds as one filter, and Happening now as another", () => {
    expect(activeFilters(NO_FILTERS)).toBe(0);
    expect(activeFilters({ types: ["signature", "partner"], happeningNow: false })).toBe(1);
    expect(activeFilters({ types: ["partner"], happeningNow: true })).toBe(2);
  });
});

describe("passes", () => {
  test("no filters passes every event", () => {
    expect(passes(ghost, NO_FILTERS, "2026-10-31", NOON)).toBe(true);
  });
  test("the kinds named, and only those", () => {
    const filters = { ...NO_FILTERS, types: ["partner"] };
    expect(passes(pumpkin, filters, "2026-10-31", NOON)).toBe(true);
    expect(passes(ghost, filters, "2026-10-31", NOON)).toBe(false);
    expect(passes(site("plain"), filters, "2026-10-31", NOON)).toBe(false);
  });
  test("Happening now passes only the events on at that minute", () => {
    const filters = { ...NO_FILTERS, happeningNow: true };
    expect(passes(ghost, filters, "2026-10-31", NOON)).toBe(true);
    expect(passes(pumpkin, filters, "2026-10-31", NOON)).toBe(false);
    expect(passes(ghost, filters, "2026-10-30", NOON)).toBe(false);
  });
});
