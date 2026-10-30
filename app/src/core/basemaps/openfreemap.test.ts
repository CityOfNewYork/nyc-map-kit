import { expect, test } from "vitest";
import type { LayerSpecification } from "maplibre-gl";
import { OTI_CREDIT, warmTint } from "../basemap-style.ts";
import {
  addCemeteries, addLandcoverParks, addParkNames, creditOpenFreeMap, dropHistoricDistricts,
} from "./openfreemap.ts";

const PALETTE = { water: "hsl(202, 42%, 80%)", park: "hsl(96, 30%, 84%)" };
const CEMETERY = "hsl(96, 16%, 83%)";

test("credit positron's tiles to OTI, then OpenFreeMap, OpenMapTiles and OpenStreetMap", () => {
  const { openmaptiles } = creditOpenFreeMap({
    version: 8,
    sources: { openmaptiles: { type: "vector", url: "https://example.test/tiles.json" } },
    layers: [],
  }).sources;
  const credit = "attribution" in openmaptiles ? openmaptiles.attribution : "";
  expect(credit?.startsWith(`${OTI_CREDIT} | `)).toBe(true);
  expect(credit?.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")).toBe(
    "NYC Office of Technology & Innovation | OpenFreeMap © OpenMapTiles © OpenStreetMap");
});

test("name positron's parks in the reader's language, below every other label", () => {
  const style = addParkNames({
    version: 8,
    sources: { openmaptiles: { type: "vector", url: "https://example.test/tiles.json" } },
    layers: [
      { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park" },
      { id: "water_name", type: "symbol", source: "openmaptiles", "source-layer": "water_name" },
    ],
  }, "es");
  expect(style.layers.map((l) => l.id)).toEqual(["park", "park_name", "water_name"]);
  const layer = style.layers[1];
  expect(layer).toMatchObject({ "source-layer": "poi", filter: ["==", ["get", "class"], "park"] });
  expect(layer.type === "symbol" && layer.layout?.["text-field"]).toEqual(
    ["coalesce", ["get", "name:es"], ["get", "name:latin"], ["get", "name"]]);
});

test("draw positron's cemeteries above the parks, below water, in their own colour", () => {
  const ground = addCemeteries(addLandcoverParks({
    version: 8,
    sources: { openmaptiles: { type: "vector", url: "https://example.test/tiles.json" } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "rgb(242,243,240)" } },
      { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park" },
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water" },
    ],
  }), CEMETERY);
  const style = warmTint(ground, PALETTE);
  expect(style.layers.map((l) => l.id))
    .toEqual(["background", "park", "landcover_park", "landuse_cemetery", "water"]);
  expect(style.layers[3]).toMatchObject({ "source-layer": "landuse",
    paint: { "fill-color": CEMETERY } });
});

test("leave historic districts out of positron's parks", () => {
  const geometry = ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false];
  const style = dropHistoricDistricts({
    version: 8,
    sources: { openmaptiles: { type: "vector", url: "https://example.test/tiles.json" } },
    layers: [{ id: "park", type: "fill", source: "openmaptiles", "source-layer": "park",
      filter: geometry } as LayerSpecification],
  });
  const park = style.layers[0];
  expect(park.type === "fill" && park.filter).toEqual(["all", geometry,
    ["!", ["in", ["get", "class"], ["literal", ["historic", "historic_district"]]]]]);
});
