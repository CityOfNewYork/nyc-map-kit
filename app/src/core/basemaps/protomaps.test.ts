import { describe, expect, test } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { POSITRON_LAND } from "../basemap-style.ts";
import { protomapsStyle } from "./protomaps.ts";

const PALETTE = { water: "hsl(202, 42%, 80%)", park: "hsl(96, 30%, 84%)", cemetery: "hsl(96, 16%, 83%)" };

// The style @protomaps/basemaps writes is generated in code, so these run against the
// real thing, with no network.
const style = protomapsStyle("es", PALETTE, "https://example.test/nyc.pmtiles");
const ids = style.layers.map((l) => l.id);
const layer = (id: string) => style.layers.find((l) => l.id === id);
const filter = (id: string) => {
  const l = layer(id);
  return l && "filter" in l ? l.filter : undefined;
};
const paint = (s: StyleSpecification, id: string) => s.layers.find((l) => l.id === id)?.paint;

describe("the Protomaps basemap", () => {
  test("reads its tiles from the PMTiles file, credited to Protomaps and OpenStreetMap", () => {
    expect(style.sources.protomaps).toMatchObject({
      type: "vector", url: "pmtiles://https://example.test/nyc.pmtiles" });
    expect(JSON.stringify(style.sources.protomaps)).toMatch(/Protomaps.*OpenStreetMap/);
  });

  test("draws cemeteries apart from parks, directly above them, in the greyer green", () => {
    expect(JSON.stringify(filter("landuse_park"))).not.toContain("cemetery");
    expect(ids.indexOf("landuse_cemetery")).toBe(ids.indexOf("landuse_park") + 1);
    expect(paint(style, "landuse_cemetery")).toEqual({ "fill-color": PALETTE.cemetery });
    expect(paint(style, "landuse_park")).toEqual({ "fill-color": PALETTE.park });
  });

  test("draws no land use but green ground, runways and piers, so none covers a park", () => {
    expect(ids.filter((id) => id.startsWith("landuse_")))
      .toEqual(["landuse_park", "landuse_cemetery", "landuse_urban_green", "landuse_runway",
        "landuse_pier"]);
  });

  test("shields Interstates and US routes only", () => {
    expect(JSON.stringify(filter("roads_shields")))
      .toContain('["in",["get","network"],["literal",["US:I","US:US"]]]');
  });

  test("warms the land but not the water, parks or cemeteries", () => {
    expect(paint(style, "earth")).not.toEqual({ "fill-color": POSITRON_LAND });
    expect(paint(style, "water")).toMatchObject({ "fill-color": PALETTE.water });
  });

  test("names parks, above the street names, and no other points of interest", () => {
    expect(ids).not.toContain("pois");
    expect(ids).not.toContain("address_label");
    expect(ids).not.toContain("roads_oneway");
    expect(ids.indexOf("park_name")).toBe(ids.indexOf("roads_labels_major") + 1);
    expect(ids.indexOf("park_name")).toBeLessThan(ids.indexOf("places_subplace"));
  });

  test("leaves the boroughs to the block's own labels", () => {
    expect(filter("places_subplace")).toContainEqual(["!=", "kind_detail", "suburb"]);
    expect(layer("places_subplace")?.minzoom).toBe(13);
    expect(layer("borough_label")?.maxzoom).toBe(13);
  });

  test("names only villages and hamlets of the localities, from z12.5", () => {
    expect(filter("places_locality")).toContainEqual(["in", "kind_detail", "village", "hamlet"]);
    expect(layer("places_locality")?.minzoom).toBe(12.5);
  });

  test("greys the land outside the city under the water, with no test in the browser", () => {
    expect(ids.indexOf("outside_city")).toBe(ids.indexOf("water") - 1);
    // The file holds nothing outside the city to hide (build/protomaps-outside.py).
    expect(JSON.stringify(style.layers)).not.toContain('"within"');
  });

  test("draws the roads the file marks as outside the city pale, and unnamed", () => {
    expect(paint(style, "roads_minor")).toMatchObject({ "line-opacity":
      ["case", ["==", ["get", "outside_city"], true], 0.35, 1] });
    expect(filter("roads_labels_major")).toContainEqual(["!=", "outside_city", true]);
    expect(JSON.stringify(filter("roads_shields"))).not.toContain("outside_city");
  });
});
