/**
 * protomaps.ts — OpenStreetMap from a Protomaps file the block hosts, in this block's look.
 *
 * Protomaps builds the planet from OpenStreetMap every day in its own tile schema, and
 * build/protomaps.sh cuts the map's area out of a build into one file, nyc.pmtiles,
 * served next to the app. The browser reads the tiles it needs out of that file by HTTP
 * range request (the `pmtiles://` protocol, registered in map-core.ts), so there is no
 * tile server to run.
 *
 * The style is not fetched: @protomaps/basemaps writes it in code from a flavor, a table
 * of colours. This file sets that table to positron's colours and the block's palette,
 * then applies the few rules a colour cannot express, the same ones the other basemaps
 * get: cemeteries apart from parks, park names, the borough labels, and place labels
 * balanced on the city.
 */
import { layers, namedFlavor } from "@protomaps/basemaps";
import type { Flavor } from "@protomaps/basemaps";
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import {
  addBoroughLabels, and, nameExpression, PARK_NAME_COLOR, POSITRON_BUILDING, POSITRON_LAND,
  POSITRON_MAJOR_ZOOM, POSITRON_ROADS, POSITRON_SUBTLE, warmTint,
} from "../basemap-style.ts";
import type { Palette } from "./index.ts";

/** The basemap file, next to the page. Written by build/protomaps.sh. */
const TILES = "nyc.pmtiles";
/** Protomaps' fonts and icons, which its style is written against. */
const ASSETS = "https://protomaps.github.io/basemaps-assets";
const SOURCE = "protomaps";

/** The basemap, with labels in `lang` where OpenStreetMap has that language. */
export async function loadProtomaps(lang: string, palette: Palette): Promise<StyleSpecification> {
  return protomapsStyle(lang, palette, new URL(TILES, document.baseURI).href);
}

/** The style itself, for a tile file at `tilesUrl`. Separate so it can be tested
 *  without a page. */
export function protomapsStyle(
  lang: string, palette: Palette, tilesUrl: string,
): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    glyphs: `${ASSETS}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${ASSETS}/sprites/v4/light`,
    sources: {
      [SOURCE]: {
        type: "vector",
        url: `pmtiles://${tilesUrl}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © '
          + '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers(SOURCE, flavor(palette), { lang }),
  };
  parkland(style, palette);
  flatBuildings(style);
  positronRoads(style);
  placeLabels(style, lang);
  return warmTint(style);
}

/**
 * Positron's colours, in Protomaps' terms. Points of interest are left out, as positron
 * leaves them out: the pins are the points on this map. The low-zoom land cover is left
 * out too; the map never shows it.
 */
function flavor(palette: Palette): Flavor {
  const land = POSITRON_LAND;
  const casing = POSITRON_ROADS.casing.color as string;
  const path = "rgb(234, 234, 234)";      // positron's paths, tunnels' fill
  const label = { halo: "#fff", place: "#000", subplace: "#333", road: "#666" };
  return {
    ...namedFlavor("light"),
    background: land, earth: land, water: palette.water,
    park_a: palette.park, park_b: palette.park, wood_a: palette.park, wood_b: palette.park,
    scrub_a: palette.park, scrub_b: palette.park,
    pier: land, runway: "#fff",
    buildings: POSITRON_BUILDING.fill,
    highway: "#fff", highway_casing_early: casing, highway_casing_late: casing,
    major: "#fff", major_casing_early: casing, major_casing_late: casing,
    link: "#fff", link_casing: casing,
    minor_a: POSITRON_SUBTLE, minor_b: "#fff", minor_casing: casing,
    minor_service: "#fff", minor_service_casing: casing, other: path,
    tunnel_highway: path, tunnel_major: path, tunnel_link: path, tunnel_minor: path,
    tunnel_other: path, tunnel_highway_casing: casing, tunnel_major_casing: casing,
    tunnel_link_casing: casing, tunnel_minor_casing: casing, tunnel_other_casing: casing,
    bridges_highway: "#fff", bridges_major: "#fff", bridges_link: "#fff", bridges_minor: "#fff",
    bridges_other: path, bridges_highway_casing: casing, bridges_major_casing: casing,
    bridges_link_casing: casing, bridges_minor_casing: casing, bridges_other_casing: casing,
    railway: "#dddddd", boundaries: "hsl(0, 0%, 70%)",
    city_label: label.place, city_label_halo: label.halo,
    subplace_label: label.subplace, subplace_label_halo: label.halo,
    state_label: label.subplace, state_label_halo: label.halo,
    ocean_label: "#495e91",
    roads_label_major: label.road, roads_label_major_halo: label.halo,
    roads_label_minor: label.road, roads_label_minor_halo: label.halo,
    address_label: label.road, address_label_halo: label.halo,
    pois: undefined, landcover: undefined,
  };
}

const layer = (style: StyleSpecification, id: string) =>
  style.layers.find((l) => l.id === id);

/** Land use that is green ground, drawn in the park colour. */
const GREEN_KINDS = ["national_park", "park", "protected_area", "nature_reserve", "forest",
  "golf_course", "wood", "scrub", "grassland", "grass"];

/** Land use positron gives no colour of its own. */
const UNCOLOURED_LAND_USE = ["landuse_hospital", "landuse_industrial", "landuse_school",
  "landuse_beach", "landuse_zoo", "landuse_aerodrome", "landuse_pedestrian"];

/**
 * Parks opaque at every zoom, as positron draws them, cemeteries apart from them, and
 * no other land use.
 *
 * Protomaps' park layer covers cemeteries, and military land, glaciers and sand in the
 * land colour. It fades in from z6 to z11, which at the opening zoom leaves the parks a
 * wash. It keeps only the green kinds here, in one colour: warmTint() skips park layers,
 * so a land colour inside this one would stay cool against the warmed ground. The
 * cemeteries go in a layer of their own, directly above, in the palette's greyer green.
 *
 * Schools, hospitals, industry, beaches, the zoo, airports and plazas are left out, as
 * positron leaves them out. Protomaps draws them above the parks, so in any colour they
 * cover the green inside them: a university campus covers MetroTech's Brooklyn Commons.
 */
function parkland(style: StyleSpecification, palette: Palette) {
  style.layers = style.layers.filter((l) => !UNCOLOURED_LAND_USE.includes(l.id));
  const at = style.layers.findIndex((l) => l.id === "landuse_park");
  const park = style.layers[at];
  if (park?.type !== "fill") return;
  park.filter = ["in", "kind", ...GREEN_KINDS];
  park.paint = { "fill-color": palette.park };
  style.layers.splice(at + 1, 0, {
    id: "landuse_cemetery", type: "fill", source: SOURCE, "source-layer": "landuse",
    filter: ["==", "kind", "cemetery"],
    paint: { "fill-color": palette.cemetery },
  });
  const green = layer(style, "landuse_urban_green");
  if (green?.type === "fill") green.paint = { "fill-color": palette.park };
}

/** Buildings opaque, with positron's outline. Protomaps draws them half-transparent. */
function flatBuildings(style: StyleSpecification) {
  const buildings = layer(style, "buildings");
  if (buildings?.type !== "fill") return;
  buildings.paint = {
    "fill-color": POSITRON_BUILDING.fill, "fill-outline-color": POSITRON_BUILDING.outline,
  };
}

/** Route networks that get a shield: Interstates and US routes, the two OTI's map
 *  shields. Protomaps shields every numbered road, state, county and parkway, which
 *  at z11–12 puts some thirty shields over the city and New Jersey. */
const SHIELD_NETWORKS = ["US:I", "US:US"];

/**
 * Streets in positron's widths and colours, as nycRoadsAsLines draws OTI's: side streets
 * one line that turns from grey to white at z14, major roads white on a pale casing from
 * z11 and one thin grey line below it. Protomaps draws every street thinner, cased in
 * grey, which reads as a different map at street level. Highway shields wait until z11,
 * as positron's do, and only Interstates and US routes get one.
 */
function positronRoads(style: StyleSpecification) {
  const drop = new Set(["roads_minor_casing", "roads_minor_service_casing",
    "roads_major_casing_late"]);
  style.layers = style.layers.filter((l) => !drop.has(l.id));
  for (const id of ["roads_minor", "roads_minor_service"]) {
    const minor = layer(style, id);
    if (minor?.type === "line") {
      minor.paint = { "line-color": POSITRON_ROADS.minor.color, "line-width": POSITRON_ROADS.minor.width };
    }
  }
  const major = layer(style, "roads_major");
  if (major?.type === "line") {
    major.paint = {
      "line-color": ["step", ["zoom"], POSITRON_SUBTLE, POSITRON_MAJOR_ZOOM, "#fff"],
      "line-width": POSITRON_ROADS.major.width,
    };
  }
  const casing = layer(style, "roads_major_casing_early");
  if (casing?.type === "line") {
    delete casing.maxzoom;
    casing.minzoom = POSITRON_MAJOR_ZOOM;
    casing.paint = { "line-color": POSITRON_ROADS.casing.color, "line-width": POSITRON_ROADS.casing.width };
  }
  const shields = layer(style, "roads_shields");
  if (shields?.type === "symbol") {
    shields.minzoom = POSITRON_MAJOR_ZOOM;
    shields.filter = and(shields.filter,
      ["in", ["get", "network"], ["literal", SHIELD_NETWORKS]]);
  }
}

/** Places outside the city that are not cities wait until a reader has zoomed in on
 *  them, as balancePlaceLabels has them on positron. */
const TOWN_ZOOM = 11.5;
const VILLAGE_ZOOM = 12.5;
const CITIES = ["city"];
const TOWNS = ["town"];
const VILLAGES = ["village", "hamlet"];
/** Below this zoom the boroughs are named; from it, the neighbourhoods the tiles carry. */
const NEIGHBOURHOOD_ZOOM = 13;
/** Islands whose name repeats a borough's. */
const ISLANDS_NAMED_FOR_BOROUGHS = ["Manhattan", "Staten Island", "Manhattan Island"];
/** Points of interest that name a park; Protomaps files playgrounds as parks too.
 *  Community gardens, which Protomaps keeps apart as `garden`, are not named: in the
 *  Lower East Side they more than double the labels at z14. Each park carries the
 *  zoom Protomaps would name it from, z15 for most; the big parks are named from it,
 *  and every park from PARK_NAME_ZOOM, as positron names them. */
const PARK_KINDS = ["park"];
const PARK_NAME_ZOOM = 14;
/** Positron's label sizes: neighbourhoods small, and towns outside the city smaller
 *  than the boroughs. Protomaps sizes places by population, which at city zoom sets
 *  Jersey City larger than any borough name. */
const POSITRON_SUBPLACE_SIZE = ["interpolate", ["linear"], ["zoom"], 8, 9, 12, 10];
const POSITRON_TOWN_SIZE = ["interpolate", ["exponential", 1.2], ["zoom"], 7, 12, 11, 14];
/** Positron names major roads from this zoom; Protomaps from z11. */
const POSITRON_ROAD_NAME_ZOOM = 12.2;

/**
 * The labels, balanced on the city as the other basemaps' are.
 *
 *   1. The tiles' own borough labels (neighbourhoods of kind `suburb`), the islands named
 *      after boroughs, and "New York" are dropped. The block draws the boroughs itself,
 *      translated and anchored on open ground, until NEIGHBOURHOOD_ZOOM.
 *   2. Towns and villages outside the city wait until TOWN_ZOOM and VILLAGE_ZOOM; cities
 *      (Newark, Jersey City, Yonkers) are named at every zoom, for orientation. The other
 *      things OpenStreetMap files as places, such as named localities and farms ("Clinton
 *      Hill Historic District", a rooftop farm), are left out, as positron leaves them out.
 *   3. Neighbourhood and town names are set as positron sets them: neighbourhoods small,
 *      in Noto Sans Italic, and every place with positron's narrow collision margin.
 *      Protomaps pads neighbourhood names by up to 20 px, which at street level leaves
 *      no room for the park names below them.
 *   4. House numbers and one-way arrows are dropped, as positron and quietNycDetail leave
 *      them out.
 *   5. Parks are named in the green italic the other basemaps use, above the street names
 *      and below the place names. Protomaps names more streets than positron, so below
 *      the street names, as the other basemaps put them, few park names find room.
 *
 * Protomaps writes its filters in the legacy syntax, so the clauses added are legacy too.
 */
function placeLabels(style: StyleSpecification, lang: string) {
  const subplace = layer(style, "places_subplace");
  if (subplace?.type === "symbol") {
    subplace.filter = and(subplace.filter, ["!=", "kind_detail", "suburb"]);
    subplace.minzoom = NEIGHBOURHOOD_ZOOM;
    const { "text-padding": _, ...layout } = subplace.layout ?? {};
    subplace.layout = { ...layout, "text-font": ["Noto Sans Italic"],
      "text-size": POSITRON_SUBPLACE_SIZE as ExpressionSpecification, "text-max-width": 9 };
  }
  const roadNames = layer(style, "roads_labels_major");
  if (roadNames) roadNames.minzoom = POSITRON_ROAD_NAME_ZOOM;
  style.layers = style.layers.filter((l) => l.id !== "address_label" && l.id !== "roads_oneway");
  const islands = layer(style, "earth_label_islands");
  if (islands?.type === "symbol") {
    islands.filter = and(islands.filter, ["!in", "name", ...ISLANDS_NAMED_FOR_BOROUGHS]);
  }

  const at = style.layers.findIndex((l) => l.id === "places_locality");
  const locality = style.layers[at];
  if (locality?.type === "symbol") {
    const { "text-padding": _, ...layout } = locality.layout ?? {};
    locality.layout = { ...layout, "text-size": POSITRON_TOWN_SIZE as ExpressionSpecification };
    const base = and(locality.filter, ["!=", "name", "New York"]);
    const towns = { ...structuredClone(locality), id: "places_locality_town",
      filter: and(base, ["in", "kind_detail", ...TOWNS]), minzoom: TOWN_ZOOM };
    const villages = { ...structuredClone(locality), id: "places_locality_village",
      filter: and(base, ["in", "kind_detail", ...VILLAGES]), minzoom: VILLAGE_ZOOM };
    locality.filter = and(base, ["in", "kind_detail", ...CITIES]);
    style.layers.splice(at + 1, 0, towns, villages);
  }

  const parkNames: LayerSpecification = {
    id: "park_name", type: "symbol", source: SOURCE, "source-layer": "pois",
    filter: ["all", ["in", ["get", "kind"], ["literal", PARK_KINDS]],
      [">=", ["zoom"], ["min", ["get", "min_zoom"], PARK_NAME_ZOOM]]],
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
  const roads = style.layers.findIndex((l) => l.id === "roads_labels_major");
  style.layers.splice(roads < 0 ? style.layers.length : roads + 1, 0, parkNames);

  addBoroughLabels(style, lang, NEIGHBOURHOOD_ZOOM);
}
