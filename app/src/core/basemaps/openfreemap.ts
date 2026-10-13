/**
 * openfreemap.ts — OpenStreetMap through OpenFreeMap's positron style, in this block's look.
 *
 * OpenFreeMap serves OpenMapTiles-schema vector tiles of the whole planet, with positron
 * as one of its styles. Positron is the reference look the other basemaps are brought
 * to (see basemap-style.ts); these rules fill in what it leaves out for New York: city
 * parks, cemeteries, park names, white side streets, labels balanced on the city, and
 * the land outside the city greyed.
 */
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import {
  addBoroughLabels, and, greyOutsideCity, hideLabelsOutsideCity, loadBasemapStyle,
  nameExpression, PARK_NAME_COLOR, warmTint,
} from "../basemap-style.ts";
import type { Palette } from "./index.ts";

const STYLE = "https://tiles.openfreemap.org/styles/positron";

/** OpenFreeMap's positron, with every rule below applied, labels in `lang`. */
export async function loadOpenFreeMap(lang: string, palette: Palette): Promise<StyleSpecification> {
  const style = await loadBasemapStyle(STYLE, lang);
  const parkland = addLandcoverParks(dropHistoricDistricts(style));
  const ground = addCemeteries(parkland, palette.cemetery);
  const parks = addParkNames(lightenSideStreets(ground), lang);
  const labels = balancePlaceLabels(parks, lang);
  const outside = greyOutsideCity(landUnderWater(labels), "water");
  return warmTint(hideLabelsOutsideCity(outside, "openmaptiles", (l) => /shield/.test(l.id)
    || ("source-layer" in l && WATER_LABELS.includes(l["source-layer"] ?? ""))), palette);
}

/** Labels of the water, which stay outside the city as inside it. */
const WATER_LABELS = ["water_name", "waterway"];

/**
 * Draw every land fill under the water, in place, so that greyOutsideCity's grey,
 * which goes directly under the water, covers all of the land outside the city.
 * Positron draws woods, residential areas and ice above its water layer; they barely
 * meet the water, and where they do the water is the truer edge.
 */
function landUnderWater(style: StyleSpecification): StyleSpecification {
  const water = style.layers.findIndex((l) => l.id === "water");
  if (water < 0) return style;
  const above = style.layers.slice(water + 1).filter((l) => l.type === "fill"
    && ["landcover", "landuse"].includes(l["source-layer"] ?? ""));
  style.layers = style.layers.filter((l) => !above.includes(l));
  style.layers.splice(water, 0, ...above);
  return style;
}

/**
 * Add a fill layer for grass landcover, in place, so city parks are drawn at all.
 *
 * In the OpenMapTiles data positron draws, Central Park is not in the `park`
 * source-layer — that holds nature reserves, state parks and the Gateway National
 * Recreation Area. City parks are `landcover` polygons with class `grass` (subclass
 * `park`, `golf_course`, `garden`, …), at every zoom, and positron paints `landcover`
 * only for wood, ice and glaciers. Without this layer the only green over Central Park
 * is its wooded patches.
 *
 * The layer id contains "park", so warmTint() gives it the `park` colour. It is inserted
 * directly after positron's own `park` layer (below water and roads); a style with no
 * `park` layer gets it directly above the background.
 */
export function addLandcoverParks(style: StyleSpecification): StyleSpecification {
  const layers = style.layers || [];
  if (layers.some((l) => l.id === "landcover_park")) return style;
  const source = Object.keys(style.sources || {})
    .find((k) => style.sources[k] && style.sources[k].type === "vector");
  if (!source) return style;
  const layer: LayerSpecification = {
    id: "landcover_park",
    type: "fill",
    source,
    "source-layer": "landcover",
    filter: ["all",
      ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
      ["==", ["get", "class"], "grass"]],
    paint: { "fill-color": "rgb(230, 233, 229)", "fill-antialias": false },
  };
  let at = layers.findIndex((l) => l.id === "park");
  if (at < 0) at = layers.findIndex((l) => l.type === "background");
  layers.splice(at + 1, 0, layer);
  return style;
}

/** Classes in the `park` source-layer that are heritage designations, not open ground. */
const HISTORIC_PARK_CLASSES = ["historic", "historic_district"];

/**
 * Leave historic districts out of positron's `park` layer, in place.
 *
 * The `park` source-layer holds every protected area OpenStreetMap maps, and in New
 * York that includes historic districts: NoHo, DUMBO, Boerum Hill, Ditmas Park,
 * Prospect Park South. Positron paints the layer a grey close to the land's, so a
 * district barely shows; in the park green warmTint() gives it, whole neighbourhoods
 * read as parkland. Nature reserves, wildlife refuges, state parks, Gateway and the
 * national monuments stay.
 */
export function dropHistoricDistricts(style: StyleSpecification): StyleSpecification {
  const park = (style.layers || []).find((l) => l.id === "park");
  if (park?.type !== "fill") return style;
  park.filter = and(park.filter,
    ["!", ["in", ["get", "class"], ["literal", HISTORIC_PARK_CLASSES]]]);
  return style;
}

/**
 * Draw cemeteries in `color`, in place.
 *
 * The OpenMapTiles data carries cemeteries as `landuse` polygons with class `cemetery`,
 * from z10, and positron paints no landuse but residential. Green-Wood, Calvary and
 * Woodlawn are among the largest open spaces in the city; left out, each reads as a
 * block with nothing in it. They are inserted directly after the parks, below water and
 * roads, so a cemetery's ponds and drives are drawn over it. warmTint() leaves the
 * colour as it is.
 */
export function addCemeteries(style: StyleSpecification, color: string): StyleSpecification {
  const layers = style.layers || [];
  if (layers.some((l) => l.id === "landuse_cemetery")) return style;
  const source = Object.keys(style.sources || {})
    .find((k) => style.sources[k] && style.sources[k].type === "vector");
  if (!source) return style;
  const layer: LayerSpecification = {
    id: "landuse_cemetery",
    type: "fill",
    source,
    "source-layer": "landuse",
    filter: ["all",
      ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
      ["==", ["get", "class"], "cemetery"]],
    paint: { "fill-color": color, "fill-antialias": false },
  };
  let at = layers.findIndex((l) => l.id === "landcover_park");
  if (at < 0) at = layers.findIndex((l) => l.id === "park");
  if (at < 0) at = layers.findIndex((l) => l.type === "background");
  layers.splice(at + 1, 0, layer);
  return style;
}

/**
 * Draw side streets white from z14, as positron already draws the major roads, in place.
 *
 * Positron gives its two road classes opposite contrasts: major roads are white, lighter
 * than the blocks, and side streets (`minor`, `service`, `track`) are grey lines, darker
 * than them. At city zoom the grey keeps the street grid a quiet texture, so it stays.
 * From z14, where a reader is looking for one street, side streets fade to white over
 * one zoom level, so every street is lighter than the blocks either side of it and
 * width alone tells an avenue from a side street. Full opacity, as the major roads are.
 */
export function lightenSideStreets(style: StyleSpecification): StyleSpecification {
  const minor = (style.layers || []).find((l) => l.id === "highway_minor");
  // Only a plain colour is ramped: a zoom expression cannot nest inside another.
  if (minor?.type !== "line" || typeof minor.paint?.["line-color"] !== "string") return style;
  minor.paint["line-color"] =
    ["interpolate", ["linear"], ["zoom"], 13, minor.paint["line-color"], 14, "#fff"];
  minor.paint["line-opacity"] = 1;
  return style;
}

/**
 * Name the parks, in place, as the NYC basemap does and positron does not.
 *
 * The tiles carry a point for each park in the `poi` source-layer, class `park`, which
 * also covers plazas, playgrounds and community gardens. They carry them from z14, under
 * the names OpenStreetMap gives them: Squibb Park, Fruit Street Sitting Area, Cadman
 * Plaza. Positron prints no `poi` names at all. This prints the parks' in `lang`, in
 * the italic green the NYC basemap uses, below every other label, so where two collide
 * the street or place keeps its name.
 */
export function addParkNames(style: StyleSpecification, lang: string): StyleSpecification {
  const layers = style.layers || [];
  if (layers.some((l) => l.id === "park_name")) return style;
  const source = Object.keys(style.sources || {})
    .find((k) => style.sources[k] && style.sources[k].type === "vector");
  if (!source) return style;
  const layer: LayerSpecification = {
    id: "park_name",
    type: "symbol",
    source,
    "source-layer": "poi",
    filter: ["==", ["get", "class"], "park"],
    layout: {
      "text-field": nameExpression(lang),
      "text-font": ["Noto Sans Italic"],
      "text-size": 12,
      "text-max-width": 7,
    },
    paint: {
      "text-color": PARK_NAME_COLOR,
      "text-halo-color": "rgba(255, 255, 255, 0.8)",
      "text-halo-width": 1,
    },
  };
  const at = layers.findIndex((l) => l.type === "symbol");
  layers.splice(at < 0 ? layers.length : at, 0, layer);
  return style;
}

/* ------------------------------------------------------ place-label balance

 * WHY THIS EXISTS
 * At the zoom this block opens at — the whole city in frame, around z10.4 — the
 * vector tiles carry no place names inside the five boroughs at all. OpenMapTiles
 * holds borough names (class `suburb`) back until z11 and neighbourhood names
 * until z14, while New Jersey and Nassau towns start at z6 and villages at z9. So
 * the opening view printed 47 black labels, every one of them outside the city the
 * map is about, and nothing inside it. That reads as a mistake rather than as a
 * map, and it pulls the eye away from the pins.
 *
 * The fix runs in both directions: hold the surrounding labels back, and fill the
 * gap they leave in the middle.
 */

/** Islands whose name repeats a borough's. Positron labels them from the same
 *  `place` layer, so without this both would print over the same land. */
const ISLANDS_NAMED_FOR_BOROUGHS = ["Staten Island", "Manhattan Island"];

/**
 * Rebalance the place labels for a map framed on New York City, in place.
 *
 * Three edits, each reversible on its own. (Outside the city nothing is named at all;
 * see hideLabelsOutsideCity.)
 *   1. The boroughs are drawn from BOROUGH_LABELS below z14, where the tiles have
 *      nothing, and stop there because that is where real neighbourhood names take
 *      over and a borough name becomes noise.
 *   2. The tiles' own borough labels are dropped, along with the two islands named
 *      after boroughs, so no name is printed twice.
 *   3. "New York" is dropped. It is the city the whole map is of; once the labels
 *      around it thin out it wins its collision and stamps itself across Lower
 *      Manhattan, which tells the reader nothing.
 *
 * Takes `lang` because the borough labels are our own features: they print their
 * names through nameExpression() exactly as the basemap's labels do.
 */
export function balancePlaceLabels(
  style: StyleSpecification, lang: string,
): StyleSpecification {
  const layers = style.layers || [];
  // Only label layers are looked up, so the result is typed as a layer that can carry a
  // filter: every kind but background.
  const layer = (id: string) => layers.find((l) => l.id === id) as
    Exclude<LayerSpecification, { type: "background" }> | undefined;
  const other = layer("label_other");
  if (other) {
    other.filter = and(other.filter,
      ["!=", ["get", "class"], "suburb"],
      ["!", ["in", ["get", "name"], ["literal", ISLANDS_NAMED_FOR_BOROUGHS]]]);
  }

  const city = layer("label_city");
  if (city) city.filter = and(city.filter, ["!=", ["get", "name"], "New York"]);

  addBoroughLabels(style, lang, 14);
  style.metadata = Object.assign({}, style.metadata, {
    "nyc-map-kit:place-labels": "balanced",
  });
  return style;
}
