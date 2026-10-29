import { describe, expect, test } from "vitest";
import type { Site } from "../../logic/types.ts";
import type { CenterDetails } from "./centers.ts";
import {
  NO_FILTERS, activeFilters, filterChanges, filtersFromUrl, passes, withFilters,
} from "./filters.ts";
import type { Filters } from "./filters.ts";

/** A center with `details`, open around the clock unless they say otherwise. */
function center(details: CenterDetails): Site {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-73.9, 40.8] },
    properties: {
      id: "c1", org: "Center", org_id: "c1", address: "1 Main Street, Bronx",
      opens: "00:00", closes: "24:00", ...details,
    } as Site["properties"],
  };
}

describe("filters in the address", () => {
  test("reads every filter", () => {
    expect(filtersFromUrl("?type=hospital,bus&open=1&wheelchair=1&pets=1")).toEqual({
      types: ["hospital", "bus"], openNow: true, wheelchair: true, pets: true,
    });
  });
  test("no parameters is no filters, and only 1 turns a filter on", () => {
    expect(filtersFromUrl("")).toEqual(NO_FILTERS);
    expect(filtersFromUrl("?open=true&pets=yes&type=")).toEqual(NO_FILTERS);
  });
  test("writes the filters in use, takes out the rest, and keeps other parameters", () => {
    const url = new URL("https://example.org/warming.html?lang=es&type=bus&open=1");
    expect(withFilters(url, { ...NO_FILTERS, pets: true }).search).toBe("?lang=es&pets=1");
  });
  test("what is written reads back the same", () => {
    const filters: Filters = { types: ["dropin", "bus"], openNow: true, wheelchair: false, pets: true };
    const url = withFilters(new URL("https://example.org/warming.html"), filters);
    expect(filtersFromUrl(url.search)).toEqual(filters);
  });
});

describe("activeFilters", () => {
  test("counts the types as one filter, however many are chosen", () => {
    expect(activeFilters(NO_FILTERS)).toBe(0);
    expect(activeFilters({ ...NO_FILTERS, types: ["hospital", "bus"] })).toBe(1);
    expect(activeFilters({ types: ["bus"], openNow: true, wheelchair: true, pets: true })).toBe(4);
  });
});

describe("filterChanges", () => {
  test("one change is one event, with the count of filters on after it", () => {
    expect(filterChanges(NO_FILTERS, { ...NO_FILTERS, wheelchair: true })).toEqual([
      { filter_name: "wheelchair", filter_value: "on", active_filter_count: 1 },
    ]);
    expect(filterChanges({ ...NO_FILTERS, pets: true, openNow: true },
      { ...NO_FILTERS, openNow: true })).toEqual([
      { filter_name: "pets", filter_value: "off", active_filter_count: 1 },
    ]);
  });

  test("open now is the when filter; types are the chosen ones, joined", () => {
    expect(filterChanges(NO_FILTERS, { ...NO_FILTERS, openNow: true })).toEqual([
      { filter_name: "when", filter_value: "now", active_filter_count: 1 },
    ]);
    expect(filterChanges({ ...NO_FILTERS, types: ["hospital"] },
      { ...NO_FILTERS, types: ["hospital", "bus"] })).toEqual([
      { filter_name: "type", filter_value: "hospital,bus", active_filter_count: 1 },
    ]);
  });

  test("clearing them all reports each filter it turned off, and no change reports none", () => {
    const all: Filters = { types: ["bus"], openNow: true, wheelchair: true, pets: true };
    expect(filterChanges(all, NO_FILTERS)).toEqual([
      { filter_name: "type", filter_value: "", active_filter_count: 0 },
      { filter_name: "when", filter_value: "any", active_filter_count: 0 },
      { filter_name: "wheelchair", filter_value: "off", active_filter_count: 0 },
      { filter_name: "pets", filter_value: "off", active_filter_count: 0 },
    ]);
    expect(filterChanges(all, { ...all })).toEqual([]);
  });
});

describe("passes", () => {
  test("no filters passes every center", () => {
    expect(passes(center({}), NO_FILTERS, 0)).toBe(true);
  });
  test("types keep only centers of those types", () => {
    const filters = { ...NO_FILTERS, types: ["hospital", "bus"] };
    expect(passes(center({ type: "bus" }), filters, 0)).toBe(true);
    expect(passes(center({ type: "dropin" }), filters, 0)).toBe(false);
    expect(passes(center({}), filters, 0)).toBe(false);
  });
  test("wheelchair and pets keep only centers that say yes", () => {
    expect(passes(center({ wheelchair: true }), { ...NO_FILTERS, wheelchair: true }, 0)).toBe(true);
    expect(passes(center({ wheelchair: false }), { ...NO_FILTERS, wheelchair: true }, 0)).toBe(false);
    expect(passes(center({}), { ...NO_FILTERS, pets: true }, 0)).toBe(false);
  });
  test("open now keeps centers open at that minute, and drops unreadable hours", () => {
    const filters = { ...NO_FILTERS, openNow: true };
    const overnight = center({ opens: "22:00", closes: "05:00" });
    expect(passes(overnight, filters, 23 * 60)).toBe(true);
    expect(passes(overnight, filters, 12 * 60)).toBe(false);
    expect(passes(center({}), filters, 12 * 60)).toBe(true);
    expect(passes(center({ opens: undefined }), filters, 12 * 60)).toBe(false);
  });
});
