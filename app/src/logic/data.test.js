import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  BOROUGH_ORDER, boroughRank, compareSites, groupByOrgProperty, indexByLocation,
  metresBetween, prepareData,
} from "./data.js";

const read = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));
const sites = read("sites.geojson");
const orgs = read("orgs.json");
const oneSite = read("one-site.geojson");

/** The co-location groups with more than one record, as sorted id lists. */
function multiGroups(atCoord) {
  const seen = new Set();
  const out = [];
  for (const group of atCoord.values()) {
    if (group.length < 2 || seen.has(group)) continue;
    seen.add(group);
    out.push(group.map((f) => f.properties.id).sort());
  }
  return out;
}

describe("co-location", () => {
  test("at 35 m the snapshot has 8 multi-record locations covering 16 sites", () => {
    const groups = multiGroups(indexByLocation(sites.features, 35));
    expect(groups).toHaveLength(8);
    expect(groups.flat()).toHaveLength(16);
    expect(groups).toContainEqual(["henry-street-settlement-1", "henry-street-settlement-2"]);
    expect(groups).toContainEqual(["metropolitan-new-york-coordinating-council-on-jewish-poverty-1",
                                   "women-in-need-inc-1"]);
  });

  test("the 39.4 m pair on W 145th and W 146th Streets is apart at 35 m and together at 40 m", () => {
    const pair = (radius) => multiGroups(indexByLocation(sites.features, radius))
      .some((g) => g.some((id) => sites.features.find((f) => f.properties.id === id)
        .properties.address.startsWith("454 West 146th")));
    expect(pair(35)).toBe(false);
    expect(pair(40)).toBe(true);
  });

  test("grouping is complete-link: a record must be within the radius of every member", () => {
    const at = (lon) => ({ properties: { id: String(lon) }, geometry: { coordinates: [lon, 40.7] } });
    // 0 m, ~25 m, ~50 m along one line: the first two group; the third is near only the second.
    const a = at(-74.0), b = at(-74.0 + 25 / 84300), c = at(-74.0 + 50 / 84300);
    const index = indexByLocation([a, b, c], 35);
    expect(index.get("-74").map((f) => f.properties.id)).toEqual(["-74", b.properties.id]);
    expect(index.get(c.properties.id)).toEqual([c]);
  });

  test("metresBetween is about right at NYC's latitude", () => {
    expect(metresBetween([-74, 40.7], [-74, 40.701])).toBeCloseTo(110.5, 0);
  });

  test("config.json's coLocationRadiusM overrides the default", () => {
    const wide = prepareData({ coLocationRadiusM: 40 }, sites, orgs);
    const deflt = prepareData({}, sites, orgs);
    expect(multiGroups(wide.atCoord).length).toBeGreaterThan(multiGroups(deflt.atCoord).length);
  });
});

describe("list order", () => {
  const sorted = sites.features.slice().sort(compareSites);

  test("boroughs come in BOROUGH_ORDER, anything else after them", () => {
    const ranks = sorted.map(boroughRank);
    expect(ranks).toEqual(ranks.slice().sort((a, b) => a - b));
    expect(sorted[0].properties.borough).toBe(BOROUGH_ORDER[0]);
  });

  test("inside a borough the rows run north to south", () => {
    const bronx = sorted.filter((f) => f.properties.borough === "Bronx")
      .map((f) => f.geometry.coordinates[1]);
    expect(bronx).toEqual(bronx.slice().sort((a, b) => b - a));
  });

  test("the order does not depend on the file's order", () => {
    const reversed = sites.features.slice().reverse().sort(compareSites);
    expect(reversed.map((f) => f.properties.id)).toEqual(sorted.map((f) => f.properties.id));
  });
});

describe("organizations", () => {
  test("orgs.json is cut down to the organizations actually on this map", () => {
    const d = prepareData({}, oneSite, orgs);
    expect(d.orgs).toHaveLength(1);
    expect(d.orgs[0].sites.map((s) => s.id)).toEqual([oneSite.features[0].properties.id]);
  });

  test("without orgs.json the organizations come from the features' org property", () => {
    const d = prepareData({}, sites, null);
    expect(d.orgs.length).toBe(new Set(sites.features.map((f) => f.properties.org_id)).size);
    expect(groupByOrgProperty(sites.features).map((o) => o.name))
      .toEqual(d.orgs.map((o) => o.name));
  });

  test("the data date comes from the GeoJSON", () => {
    expect(prepareData({}, sites, orgs).generated).toBe(sites.generated);
  });
});
