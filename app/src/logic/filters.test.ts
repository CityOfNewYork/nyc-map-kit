import { describe, expect, test } from "vitest";
import { ofTypes, orgTypes, typesFromUrl, valuesByCount, withTypes } from "./filters.ts";
import type { Site } from "./types.ts";

function site(id: string, orgType?: string, borough?: string): Site {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-73.9, 40.8] },
    properties: { id, org: id, org_id: id, address: "", org_type: orgType, borough } as Site["properties"],
  };
}

const sites = [
  site("a", "Nonprofit", "Bronx"), site("b", "Library", "Bronx"), site("c", "Nonprofit"),
  site("d", "Government Agency", "Queens"), site("e"), site("f", "Library"), site("g", "Nonprofit"),
];

describe("orgTypes and valuesByCount", () => {
  test("lists each value once, most sites first, then alphabetically", () => {
    expect(orgTypes(sites)).toEqual([
      { type: "Nonprofit", count: 3 },
      { type: "Library", count: 2 },
      { type: "Government Agency", count: 1 },
    ]);
  });
  test("a tie is alphabetical", () => {
    expect(orgTypes([site("x", "Nonprofit"), site("y", "Library")]).map((v) => v.type))
      .toEqual(["Library", "Nonprofit"]);
  });
  test("reads any property, and skips sites without it", () => {
    expect(valuesByCount(sites, "borough")).toEqual([
      { type: "Bronx", count: 2 }, { type: "Queens", count: 1 },
    ]);
  });
});

describe("types in the address", () => {
  test("reads one `type` per organization type", () => {
    expect(typesFromUrl("?type=Nonprofit&type=Government+Agency&type=")).toEqual(
      ["Nonprofit", "Government Agency"]);
    expect(typesFromUrl("")).toEqual([]);
  });
  test("writes the types in place of any there before, and keeps other parameters", () => {
    const url = new URL("https://example.org/app/?lang=es&type=Library");
    const out = withTypes(url, ["Nonprofit", "Government Agency"]);
    expect(out.search).toBe("?lang=es&type=Nonprofit&type=Government+Agency");
    expect(typesFromUrl(out.search)).toEqual(["Nonprofit", "Government Agency"]);
    expect(url.search).toBe("?lang=es&type=Library");
  });
});

describe("ofTypes", () => {
  test("keeps the sites of the types named", () => {
    expect(ofTypes(sites, ["Library", "Government Agency"]).map((s) => s.properties.id))
      .toEqual(["b", "d", "f"]);
  });
  test("no types named keeps every site", () => {
    expect(ofTypes(sites, [])).toBe(sites);
  });
});
