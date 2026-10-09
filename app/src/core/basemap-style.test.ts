import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import {
  addParkNames, loadEsriStyle, NYC_BASEMAP_STYLE, nycBasemapPalette, nycLabels, nycRoadsAsLines,
  quietNycDetail,
} from "./basemap-style.ts";

const PALETTE = { water: "hsl(202, 42%, 80%)", park: "hsl(96, 30%, 84%)" };

/** The four NYC steps, in the order the app runs them. */
function styleNyc(style: StyleSpecification, lang = "en") {
  return nycLabels(nycRoadsAsLines(quietNycDetail(nycBasemapPalette(style, PALETTE))), lang);
}

const unmatched = (style: StyleSpecification) =>
  (style.metadata as Record<string, unknown> | undefined)?.["nyc-map-kit:unmatched"] ?? [];

/** A few of the NYC style's layers, as Esri writes them. */
function fixture(): StyleSpecification {
  const label = (id: string, sourceLayer: string, font: string, extra = {}) => ({
    id, type: "symbol", source: "esri", "source-layer": sourceLayer,
    layout: { "text-field": "{_name}", "text-font": [font], ...extra },
    paint: { "text-color": "#4E4E4E", "text-halo-color": "#F5F0EA" },
  });
  const fill = (id: string, sourceLayer: string, paint = {}) => ({
    id, type: "fill", source: "esri", "source-layer": sourceLayer,
    paint: { "fill-color": "#CCC9C4", ...paint },
  });
  const line = (id: string, sourceLayer: string, extra = {}) => ({
    id, type: "line", source: "esri", "source-layer": sourceLayer,
    paint: { "line-color": "#B2B2B2", "line-width": { stops: [[12, 1.3], [18, 2.7]] } }, ...extra,
  });
  return {
    version: 8,
    sources: { esri: { type: "vector", tiles: ["https://example.test/{z}/{y}/{x}.pbf"] } },
    layers: [
      fill("Land/Land_NYC/1", "Land", { "fill-color": "#F2F3F0" }),
      fill("Land/Land_Region/1", "Land", { "fill-color": "#E8E9E5" }),
      fill("Sidewalks/Sidewalk", "Sidewalks"),
      fill("Sidewalks/Elevated Sidewalk/1", "Sidewalks"),
      fill("NYC Open Space", "NYC Open Space", { "fill-color": "#96A797" }),
      fill("Plaza/Plaza", "Plaza", { "fill-opacity": { stops: [[14, 0.25], [15, 1]] } }),
      line("Roadbeds/Roadbed/1", "Roadbeds", { minzoom: 14 }),
      fill("Roadbeds/Roadbed/0", "Roadbeds"),
      line("Roadbed Edge", "Roadbed Edge"),
      line("NYC Roads/Local Road/1", "NYC Roads", { minzoom: 12, maxzoom: 14 }),
      line("NYC Roads/Local Road/0", "NYC Roads", { minzoom: 12, maxzoom: 14 }),
      line("NYC Roads/Secondary/1", "NYC Roads", { minzoom: 10, maxzoom: 14 }),
      line("NYC Roads/Secondary/0", "NYC Roads", { minzoom: 10, maxzoom: 14 }),
      line("NYC Roads/Primary/1", "NYC Roads", { minzoom: 6, maxzoom: 14 }),
      line("NYC Roads/Primary/0", "NYC Roads", { minzoom: 6, maxzoom: 14 }),
      fill("Buildings/Building/2", "Buildings", { "fill-translate": [2, 2] }),
      fill("Buildings/Building/1", "Buildings", { "fill-color": "#DCDBDA" }),
      line("Buildings/Building/0", "Buildings"),
      fill("Buildings/Landmark Building/1", "Buildings", { "fill-color": "#B3AFA4" }),
      { id: "Rail Stations/Station", type: "fill", source: "esri", "source-layer": "Rail Stations",
        paint: { "fill-color": "#828282" } },
      { id: "Rail Stations/Station Entrance", type: "fill", source: "esri",
        "source-layer": "Rail Stations", paint: { "fill-color": "#4E4E4E" } },
      label("Water Area Labels/label/Default", "Water Area Labels", "Source Serif Pro Italic"),
      label("Parks/label/Default", "Parks/label", "Source Sans Pro Italic"),
      label("NYC Roads/label/Streets", "NYC Roads/label", "NimbusSanL Regular"),
      label("Region Road Labels/label/US Route", "Region Road Labels/label", "Source Sans Pro Bold",
        { "icon-image": "US Route" }),
      { ...label("Region Road Labels/label/Interstate Shield", "Region Road Labels/label",
        "Source Sans Pro Bold", { "icon-image": "Interstate Shield" }), minzoom: 7 },
      { ...label("City Labels/label/Region", "City Labels", "NimbusSanL Bold",
        { "text-field": "{_name1}" }), filter: ["==", "_label_class1", 1] },
      label("City Labels/label/NYC", "City Labels", "NimbusSanL Bold"),
      label("Neighborhoods/label/Default", "Neighborhoods", "NimbusSanL Bold"),
      label("Boundaries/Counties/label/Default", "Counties", "Source Sans Pro Regular"),
    ] as LayerSpecification[],
  };
}

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

test("load an Esri style without its service URL, credited in sentence case", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
    version: 8,
    sources: { esri: { type: "vector", url: "https://example.test/VectorTileServer",
      tiles: ["https://example.test/tile/{z}/{y}/{x}.pbf"], attribution: "SOURCE: NYC OTI" } },
    layers: [],
  })));
  try {
    const { esri } = (await loadEsriStyle("https://example.test/style.json")).sources;
    expect(esri).not.toHaveProperty("url");
    expect(esri).toHaveProperty("attribution", "Source: NYC OTI");
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("the NYC basemap steps", () => {
  // A fixture this small leaves most rules unmatched, and each one says so.
  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  test("drop the survey detail, shadows and open space; keep sidewalks, stations and plazas", () => {
    const ids = quietNycDetail(fixture()).layers.map((l) => l.id);
    for (const id of ["Sidewalks/Elevated Sidewalk/1", "Rail Stations/Station Entrance",
      "NYC Open Space", "Buildings/Building/2", "Buildings/Building/0"]) {
      expect(ids).not.toContain(id);
    }
    for (const id of ["Sidewalks/Sidewalk", "Rail Stations/Station", "Plaza/Plaza",
      "Buildings/Building/1"]) {
      expect(ids).toContain(id);
    }
  });

  test("paint land one colour, sidewalks in it, plazas as parks and every building flat", () => {
    const style = nycBasemapPalette(fixture(), PALETTE);
    const paint = (id: string) => style.layers.find((l) => l.id === id)?.paint;
    expect(paint("Land/Land_Region/1")).toEqual(paint("Land/Land_NYC/1"));
    expect(paint("Sidewalks/Sidewalk"))
      .toEqual({ "fill-color": "rgb(242,243,240)", "fill-opacity": 0.74 });
    expect(paint("Plaza/Plaza")).toEqual({ "fill-color": PALETTE.park });
    const flat = { "fill-color": "rgb(234, 234, 229)", "fill-outline-color": "rgb(219, 219, 218)" };
    expect(paint("Buildings/Building/1")).toEqual(flat);
    expect(paint("Buildings/Landmark Building/1")).toEqual(flat);
  });

  test("draw streets as centre lines at every zoom, not as roadbed", () => {
    const style = nycRoadsAsLines(fixture());
    const layer = (id: string) => style.layers.find((l) => l.id === id);
    const ids = style.layers.map((l) => l.id);
    for (const id of ["Roadbeds/Roadbed/1", "Roadbeds/Roadbed/0", "Roadbed Edge",
      "NYC Roads/Local Road/1"]) expect(ids).not.toContain(id);
    for (const id of ["NYC Roads/Local Road/0", "NYC Roads/Primary/1", "NYC Roads/Primary/0"]) {
      expect(layer(id)?.maxzoom).toBeUndefined();
    }
    expect(layer("NYC Roads/Local Road/0")?.paint).toMatchObject({ "line-color":
      ["interpolate", ["linear"], ["zoom"], 13, "hsl(0, 0%, 88%)", 14, "#fff"] });
    expect(layer("NYC Roads/Primary/1")?.paint).toMatchObject({ "line-color": "rgb(213, 213, 213)" });
    expect(layer("NYC Roads/Primary/0")?.paint).toMatchObject({ "line-color": "#fff" });
    expect(layer("NYC Roads/Secondary/1")?.minzoom).toBe(11);
    expect(layer("NYC Roads/Secondary/0")?.paint).toMatchObject({ "line-color":
      ["step", ["zoom"], "hsla(0, 0%, 85%, 0.69)", 11, "#fff"] });
  });

  test("hold highway shields until z11", () => {
    const style = nycLabels(fixture(), "en");
    const minzoom = (id: string) => style.layers.find((l) => l.id === id)?.minzoom;
    expect(minzoom("Region Road Labels/label/Interstate Shield")).toBe(11);
    expect(minzoom("Region Road Labels/label/US Route")).toBe(11);
  });

  test("set every label in Noto Sans, by kind", () => {
    const style = nycLabels(fixture(), "en");
    const font = (id: string) => {
      const layer = style.layers.find((l) => l.id === id);
      return layer?.type === "symbol" ? layer.layout?.["text-font"] : undefined;
    };
    expect(font("Water Area Labels/label/Default")).toEqual(["Noto Sans Italic"]);
    expect(font("NYC Roads/label/Streets")).toEqual(["Noto Sans Regular"]);
    expect(font("Region Road Labels/label/US Route")).toEqual(["Noto Sans Bold"]);
    expect(font("City Labels/label/Region")).toEqual(["Noto Sans Regular"]);
  });

  test("skip labels the data names \"NO NAME\"", () => {
    const park = nycLabels(fixture(), "en").layers.find((l) => l.id === "Parks/label/Default");
    expect(park && "filter" in park && park.filter).toEqual(["all", ["!=", "_name", "NO NAME"]]);
  });

  test("hold back the region's towns but not the orienting cities", () => {
    const style = nycLabels(fixture(), "en");
    const towns = style.layers.find((l) => l.id === "City Labels/label/Region");
    const cities = style.layers.find((l) => l.id === "City Labels/label/Region/orienting");
    expect(towns?.minzoom).toBe(11.5);
    expect(cities?.minzoom).toBeUndefined();
    // Legacy syntax throughout, as Esri's own filter is: MapLibre rejects a mix.
    expect(towns && "filter" in towns && towns.filter).toEqual(["all",
      ["==", "_label_class1", 1], ["!in", "_name1", "Newark", "Jersey\nCity", "Yonkers"]]);
    expect(cities && "filter" in cities && cities.filter).toEqual(["all",
      ["==", "_label_class1", 1], ["in", "_name1", "Newark", "Jersey\nCity", "Yonkers"]]);
  });

  test("hand the boroughs over to the neighbourhoods at z12", () => {
    const style = nycLabels(fixture(), "es");
    const ids = style.layers.map((l) => l.id);
    expect(ids).not.toContain("City Labels/label/NYC");
    expect(ids).not.toContain("Boundaries/Counties/label/Default");
    expect(style.layers.find((l) => l.id === "borough_label")?.maxzoom).toBe(12);
    expect(style.layers.find((l) => l.id === "Neighborhoods/label/Default")?.minzoom).toBe(12);
  });

  test("report a rule that matched nothing", () => {
    const style = fixture();
    style.layers = style.layers.filter((l) => l.id !== "Parks/label/Default");
    expect(unmatched(nycLabels(style, "en"))).toEqual(["park labels"]);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});

/**
 * Against OTI's live style, on purpose: what this guards against is OTI re-releasing
 * the basemap with layers renamed, which no copy checked in here would show. If the
 * style cannot be fetched at all it skips rather than fails, so an ArcGIS outage does
 * not block a deploy.
 */
test("every NYC basemap rule matches a layer in OTI's live style", async (ctx) => {
  let style: StyleSpecification;
  try {
    style = await loadEsriStyle(NYC_BASEMAP_STYLE);
  } catch (err) {
    console.warn(`[test] OTI's NYC basemap style could not be fetched: ${err}`);
    ctx.skip();
    return;
  }
  expect(unmatched(styleNyc(style))).toEqual([]);
});
