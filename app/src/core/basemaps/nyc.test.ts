import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { OUTSIDE, warmTint } from "../basemap-style.ts";
import {
  addNycCemeteries, loadEsriStyle, NYC_BASEMAP_STYLE, nycBasemapPalette, nycLabels,
  nycRoadsAsLines, quietNycDetail, quietNycRegion,
} from "./nyc.ts";

const PALETTE = { water: "hsl(202, 42%, 80%)", park: "hsl(96, 30%, 84%)" };
const CEMETERY = "hsl(96, 16%, 83%)";

/** The six NYC steps, in the order the app runs them. */
function styleNyc(style: StyleSpecification, lang = "en") {
  const quiet = nycRoadsAsLines(quietNycDetail(nycBasemapPalette(style, PALETTE)));
  return quietNycRegion(nycLabels(addNycCemeteries(quiet, "cemeteries.geojson", CEMETERY), lang));
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
      fill("Inland Hydrography", "Inland Hydrography", { "fill-color": "#88A9BC" }),
      line("Roadbeds/Roadbed/1", "Roadbeds", { minzoom: 14 }),
      fill("Roadbeds/Roadbed/0", "Roadbeds"),
      line("Roadbed Edge", "Roadbed Edge"),
      line("NYC Roads/Local Road/1", "NYC Roads", { minzoom: 12, maxzoom: 14 }),
      line("NYC Roads/Local Road/0", "NYC Roads", { minzoom: 12, maxzoom: 14 }),
      line("NYC Roads/Secondary/1", "NYC Roads", { minzoom: 10, maxzoom: 14 }),
      line("NYC Roads/Secondary/0", "NYC Roads", { minzoom: 10, maxzoom: 14 }),
      line("NYC Roads/Primary/1", "NYC Roads", { minzoom: 6, maxzoom: 14 }),
      line("NYC Roads/Primary/0", "NYC Roads", { minzoom: 6, maxzoom: 14 }),
      line("Region Roads/Local Road/0", "Region Roads", { minzoom: 12 }),
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
    const flat = {
      "fill-color": "rgb(234, 234, 229)", "fill-outline-color": "rgb(219, 219, 218)",
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 15.5, 0, 16, 1],
    };
    expect(paint("Buildings/Building/1")).toEqual(flat);
    expect(paint("Buildings/Landmark Building/1")).toEqual(flat);
  });

  test("draw the cemeteries where the open-space layer was, below the ponds", () => {
    const style = styleNyc(fixture());
    const ids = style.layers.map((l) => l.id);
    // Below the ponds, with only the grey outside the city between them.
    expect(ids.slice(ids.indexOf("cemetery") + 1, ids.indexOf("Inland Hydrography")))
      .toEqual(["outside_city"]);
    expect(style.sources.cemeteries).toEqual({ type: "geojson", data: "cemeteries.geojson" });
    expect(warmTint(style).layers.find((l) => l.id === "cemetery")?.paint)
      .toMatchObject({ "fill-color": CEMETERY });
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
    // Secondary roads as the other major roads: white on a casing from the zoom the tiles
    // carry them, with no grey stage first.
    expect(layer("NYC Roads/Secondary/1")?.minzoom).toBe(10);
    expect(layer("NYC Roads/Secondary/0")?.paint).toMatchObject({ "line-color": "#fff" });
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

  test("grey the land outside the city, fade its streets and name only its highways", () => {
    const style = styleNyc(fixture());
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf("outside_city")).toBe(ids.indexOf("Inland Hydrography") - 1);
    expect(style.layers.find((l) => l.id === "outside_city")).toMatchObject({
      "source-layer": "Land", paint: { "fill-color": OUTSIDE.color, "fill-opacity": OUTSIDE.opacity } });
    expect(ids).not.toContain("City Labels/label/Region");
    expect(ids).toContain("Region Road Labels/label/Interstate Shield");
    expect(style.layers.find((l) => l.id === "Region Roads/Local Road/0")?.paint)
      .toMatchObject({ "line-opacity": OUTSIDE.streets });
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

/** How long to wait for OTI's style before skipping, well inside the test's own limit. */
const STYLE_WAIT_MS = 15_000;

/**
 * Against OTI's live style, on purpose: what this guards against is OTI re-releasing
 * the basemap with layers renamed, which no copy checked in here would show. If the
 * style cannot be fetched, or takes longer than STYLE_WAIT_MS, it skips rather than
 * fails, so an ArcGIS outage or a slow answer does not block a deploy.
 */
test("every NYC basemap rule matches a layer in OTI's live style", async (ctx) => {
  let style: StyleSpecification;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    style = await Promise.race([
      loadEsriStyle(NYC_BASEMAP_STYLE),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer in ${STYLE_WAIT_MS} ms`)),
          STYLE_WAIT_MS);
      }),
    ]);
  } catch (err) {
    console.warn(`[test] OTI's NYC basemap style could not be fetched: ${err}`);
    ctx.skip();
    return;
  } finally {
    clearTimeout(timer);
  }
  expect(unmatched(styleNyc(style))).toEqual([]);
}, STYLE_WAIT_MS + 5_000);
