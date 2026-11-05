import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { OTI_CREDIT, OUTSIDE, POSITRON_LAND } from "../basemap-style.ts";
import { protomapsStyle } from "./protomaps.ts";

const PALETTE = { water: "hsl(202, 42%, 80%)", park: "hsl(96, 30%, 84%)", cemetery: "hsl(96, 16%, 83%)" };

// The style @protomaps/basemaps writes is generated in code, so these run against the
// real thing, with no network.
const style = protomapsStyle("es", PALETTE, "https://example.test/maps/warming.html");
const ids = style.layers.map((l) => l.id);
const layer = (id: string) => style.layers.find((l) => l.id === id);
const filter = (id: string) => {
  const l = layer(id);
  return l && "filter" in l ? l.filter : undefined;
};
const paint = (s: StyleSpecification, id: string) => s.layers.find((l) => l.id === id)?.paint;

describe("the Protomaps basemap", () => {
  test("reads its tiles from the PMTiles file, credited to OTI and OpenStreetMap", () => {
    expect(style.sources.protomaps).toMatchObject({
      type: "vector", url: "pmtiles://https://example.test/maps/nyc.pmtiles" });
    const credit = "attribution" in style.sources.protomaps
      ? style.sources.protomaps.attribution : "";
    expect(credit).toBe(`${OTI_CREDIT} | © `
      + '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
  });

  test("reads its fonts and icons from the page's own host", () => {
    expect(style.glyphs).toBe("https://example.test/maps/protomaps/fonts/{fontstack}/{range}.pbf");
    expect(style.sprite).toBe("https://example.test/maps/protomaps/sprites/v4/light");
  });

  test("ships every font the style names, and its icons at both pixel densities", () => {
    const shipped = (path: string) =>
      existsSync(new URL(`../../../public/protomaps/${path}`, import.meta.url));
    const fonts = new Set(style.layers.flatMap((l) =>
      l.type === "symbol" ? l.layout?.["text-font"] as string[] ?? [] : []));
    expect(fonts.size).toBeGreaterThan(0);
    for (const font of fonts) {
      expect(shipped(`fonts/${font}/0-255.pbf`), font).toBe(true);
      expect(shipped(`fonts/${font}/65280-65535.pbf`), font).toBe(true);
    }
    for (const name of ["light.json", "light.png", "light@2x.json", "light@2x.png"]) {
      expect(shipped(`sprites/v4/${name}`), name).toBe(true);
    }
  });

  test("draws cemeteries apart from parks, directly above them, in the greyer green", () => {
    expect(JSON.stringify(filter("landuse_park"))).not.toContain("cemetery");
    expect(ids.indexOf("landuse_cemetery")).toBe(ids.indexOf("landuse_park") + 1);
    expect(paint(style, "landuse_cemetery")).toEqual({ "fill-color": PALETTE.cemetery });
    expect(paint(style, "landuse_park")).toEqual({ "fill-color": PALETTE.park });
  });

  test("draws no land use but green ground, airports and piers, and only airports over a park", () => {
    expect(ids.filter((id) => id.startsWith("landuse_")))
      .toEqual(["landuse_park", "landuse_cemetery", "landuse_urban_green", "landuse_aerodrome",
        "landuse_runway", "landuse_pier"]);
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
    expect(layer("places_subplace")?.minzoom).toBe(13);
    expect(layer("borough_label")?.maxzoom).toBe(13);
  });

  test("draws the subway's stations above its own labels, under the landmarks and boroughs", () => {
    expect(ids.slice(-3)).toEqual(["subway_station", "landmark_label", "borough_label"]);
  });

  test("names neighbourhoods from the file build/neighborhoods.py writes, in English", () => {
    expect(style.sources.neighbourhoods).toEqual({ type: "geojson", data: "neighborhoods.geojson" });
    expect(layer("places_subplace")).toMatchObject({ source: "neighbourhoods",
      layout: { "text-field": ["get", "name"] } });
  });

  test("names no localities", () => {
    expect(ids).not.toContain("places_locality");
  });

  test("greys the land outside the city under the water, with no test in the browser", () => {
    expect(ids.indexOf("outside_city")).toBe(ids.indexOf("water") - 1);
    // The file holds nothing outside the city to hide (build/protomaps-outside.py).
    expect(JSON.stringify(style.layers)).not.toContain('"within"');
  });

  test("mutes the parks outside the city under the land's colour, above every green", () => {
    const earth = layer("earth");
    const land = earth?.type === "fill" ? earth.paint?.["fill-color"] : undefined;
    expect(layer("outside_land")).toMatchObject({ source: "outside_city",
      paint: { "fill-color": land, "fill-opacity": 1 - OUTSIDE.parks } });
    expect(ids.indexOf("outside_land")).toBe(ids.indexOf("landuse_runway") - 1);
    expect(ids.indexOf("outside_land")).toBeGreaterThan(ids.indexOf("landuse_urban_green"));
  });

  test("draws airports as positron does: grounds as land over the grass, runways one grey", () => {
    const earth = layer("earth");
    expect(layer("landuse_aerodrome")).toMatchObject({ "source-layer": "landuse",
      filter: ["==", "kind", "aerodrome"],
      paint: { "fill-color": earth?.type === "fill" ? earth.paint?.["fill-color"] : undefined } });
    expect(ids.indexOf("landuse_aerodrome")).toBeGreaterThan(ids.indexOf("landuse_urban_green"));
    expect(ids.indexOf("landuse_aerodrome")).toBeLessThan(ids.indexOf("roads_runway"));
    const runway = (id: string) => {
      const l = layer(id);
      return l?.type === "line" ? l.paint?.["line-color"] : l?.type === "fill" ? l.paint?.["fill-color"] : null;
    };
    expect(runway("roads_taxiway")).toEqual(runway("roads_runway"));
    expect(runway("landuse_runway")).toEqual(runway("roads_runway"));
    expect(runway("roads_runway")).not.toBe("#fff");
  });

  test("draws river lines from street level, and no pools, fountains or basins", () => {
    expect(layer("water_river")?.minzoom).toBe(12);
    expect(filter("water")).toContainEqual(["!in", "kind", "swimming_pool", "fountain", "basin"]);
  });

  test("draws the roads the file marks as outside the city pale, and unnamed", () => {
    expect(paint(style, "roads_minor")).toMatchObject({ "line-opacity":
      ["case", ["==", ["get", "outside_city"], true], 0.35, 1] });
    expect(filter("roads_labels_major")).toContainEqual(["!=", "outside_city", true]);
    expect(JSON.stringify(filter("roads_shields"))).not.toContain("outside_city");
  });

  test("dashes the city line where it crosses land, above the streets", () => {
    expect(ids.indexOf("city_line")).toBeGreaterThan(ids.indexOf("roads_major"));
    expect(ids.indexOf("city_line")).toBeLessThan(ids.indexOf("park_name"));
    expect(layer("city_line")?.paint).toMatchObject({ "line-width": 2 / 3, "line-dasharray": [4, 6] });
  });
});
