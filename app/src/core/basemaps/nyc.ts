/**
 * nyc.ts — OTI's NYC Basemap v3, in this block's look or in its own.
 *
 * OTI publishes its own vector basemap of the city, NYC_Basemap_v3, as an Esri vector
 * tile service on ArcGIS Online, with styles that sit on it as ArcGIS items. Esri's
 * styles are Mapbox GL style documents, and MapLibre draws them as they are. Their
 * labels are English only: every label layer prints a single `_name` field, so
 * setStyleLanguage has nothing to switch to and is not applied.
 */
import type { StyleSpecification, SymbolLayerSpecification } from "maplibre-gl";
import {
  addBoroughLabels, addLandmarkLabels, and, flatBuildings, OUTSIDE, PARK_NAME_COLOR,
  POSITRON_LAND, POSITRON_ROADS, reportUnmatched, warmTint,
} from "../basemap-style.ts";
import type { Palette } from "./index.ts";

/** The city's cemeteries, written by build/cemeteries.py. */
const CEMETERIES = "cemeteries.geojson";

/** OTI's style repainted in the block's palette, with every rule below applied. Only the
 *  borough names follow `lang`; the tiles carry no other language. */
export async function loadNyc(lang: string, palette: Palette): Promise<StyleSpecification> {
  const style = await loadEsriStyle(NYC_BASEMAP_STYLE);
  const quiet = nycRoadsAsLines(quietNycDetail(nycBasemapPalette(style, palette)));
  const cemeteries = addNycCemeteries(quiet, CEMETERIES, palette.cemetery);
  return warmTint(quietNycRegion(nycLabels(cemeteries, lang)));
}

/** OTI's style as published, for comparison. */
export function loadNycOriginal(): Promise<StyleSpecification> {
  return loadEsriStyle(NYC_BASEMAP_STYLE);
}

/** The "NYC Basemap" style, the default look of the tiles. */
export const NYC_BASEMAP_STYLE =
  "https://www.arcgis.com/sharing/rest/content/items/df7862bfd7984baab51ff9df8e214278/resources/styles/root.json";

/**
 * Fetch an Esri vector tile style. Each vector source names its tiles twice: `tiles`
 * (absolute tile URLs) and `url`, the tile service's root. Given `url`, MapLibre
 * fetches it before the first tile, then lets `tiles` override what it says. Dropping
 * `url` saves that round trip. The source's own `attribution` is what the map credits,
 * set in sentence case like the rest of the attribution line: "Source: NYC OTI".
 */
export async function loadEsriStyle(styleUrl: string): Promise<StyleSpecification> {
  const resp = await fetch(styleUrl);
  if (!resp.ok) throw new Error(`basemap style ${styleUrl} returned ${resp.status}`);
  const style = await resp.json();
  for (const source of Object.values(style.sources || {}) as Record<string, unknown>[]) {
    if (source.type === "vector" && Array.isArray(source.tiles)) delete source.url;
    if (typeof source.attribution === "string") {
      source.attribution = source.attribution.replace(/^SOURCE:/, "Source:");
    }
  }
  return style;
}

/** The NYC basemap's source-layers, grouped by the colour this block gives them.
 *  Plazas count as parks: residents use them as open space, and OpenStreetMap maps the
 *  larger ones, MetroTech Commons among them, as parks. */
const NYC_WATER = ["Ocean", "Inland Hydrography", "Region Hydrography"];
const NYC_PARK = ["Parks", "Region Parks", "Plaza", "The High Line"];
const NYC_LAND = ["Land/Land_NYC", "Land/Land_Region"];
const NYC_LAND_COLOR = POSITRON_LAND;
/** Walking paths: OTI's sidewalk layer, which also holds the paths through parks. It is
 *  drawn in the land colour, so sidewalks vanish into the blocks, and part-transparent,
 *  so a path through grass takes the tone of positron's paths rather than the land's. */
const NYC_PATH_OPACITY = 0.74;
/** Station platforms: darker than the buildings, not the dark grey OTI draws. */
const NYC_STATION = "rgb(191,191,187)";

/**
 * Repaint the NYC Basemap style in this block's palette, in place.
 *
 * The style's own palette is made for a full reference map: mid-green parks, slate
 * water, dark green sports fields. This brings it to the same quiet ground positron gives the
 * block — positron's land greys, the caller's `water` and `park` — and warmTint() then
 * warms the neutrals exactly as it does positron's. Fill patterns (wetland, beach) are
 * left as the style draws them; labels are nycLabels' job.
 *
 * Water and parks are drawn opaque at every zoom, as positron draws them. OTI's style
 * fades parks in instead, from transparent at z5 to opaque at z16 or later, which at
 * the opening zoom leaves Central Park a pale wash rather than a landmark.
 *
 * Land is one colour inside the city and out, as positron draws it. The style draws
 * the region around the city a step darker; this block keeps positron's single ground,
 * and water already outlines most of the city.
 *
 * Buildings, landmarks included, are drawn flat in positron's fill and outline, from the
 * zoom flatBuildings sets rather than the style's z12. The style draws them a darker
 * grey, and landmarks darker still, which suits a reference map but at street level
 * outweighs the pins; quietNycDetail drops the outlines and drop shadows it draws them
 * with. Station platforms are drawn darker than the buildings but not in
 * the style's dark grey, which along an elevated line like the 7 in Jackson Heights
 * is the heaviest thing at street level. A dark block reads as a mark on the map,
 * which is the pins' job.
 *
 * Sidewalks are drawn in the land colour, at NYC_PATH_OPACITY: on a block they cannot
 * be seen, and through a park they are its paths, as positron draws them.
 */
export function nycBasemapPalette(
  style: StyleSpecification, options: { water: string; park: string },
): StyleSpecification {
  const hits: Record<string, number> = { water: 0, park: 0, stations: 0, buildings: 0, paths: 0 };
  for (const key of NYC_LAND) hits[key] = 0;
  for (const layer of style.layers || []) {
    if (layer.type !== "fill" && layer.type !== "line") continue;
    const paint = layer.paint as Record<string, unknown> | undefined;
    if (!paint || "fill-pattern" in paint) continue;
    const sourceLayer = layer["source-layer"] || "";
    if (sourceLayer === "Buildings" && layer.type === "fill") {
      hits.buildings++;
      flatBuildings(layer);
      continue;
    }
    if (layer.id === "Sidewalks/Sidewalk") {
      hits.paths++;
      layer.paint = { "fill-color": NYC_LAND_COLOR, "fill-opacity": NYC_PATH_OPACITY };
      continue;
    }
    const land = NYC_LAND.find((k) => layer.id.startsWith(k + "/"));
    let rule: string | undefined;
    let color: string | undefined;
    if (layer.id === "Parks/Pool" || NYC_WATER.includes(sourceLayer)) [rule, color] = ["water", options.water];
    else if (NYC_PARK.includes(sourceLayer)) [rule, color] = ["park", options.park];
    else if (sourceLayer === "Rail Stations") [rule, color] = ["stations", NYC_STATION];
    else if (land) [rule, color] = [land, NYC_LAND_COLOR];
    if (!rule || !color) continue;
    hits[rule]++;
    for (const prop of Object.keys(paint)) {
      if (prop.includes("color")) paint[prop] = color;
      else if (prop.endsWith("-opacity") && (rule === "water" || rule === "park")) delete paint[prop];
    }
  }
  reportUnmatched(style, hits);
  return style;
}

/** What quietNycDetail drops: source-layers, plus the layers that share theirs with
 *  something kept (station entrances, and the buildings' drop shadows and outlines). */
const NYC_DETAIL = [
  "Sidewalks/Elevated Sidewalk/1", "Sidewalks/Elevated Sidewalk/0",
  "Medians", "Parking Lots", "Pedestrian Overpass", "Traffic Direction",
  "Addresses", "Rail Stations/Station Entrance", "NYC Open Space",
  "Buildings/Building/2", "Buildings/Building/0",
  "Buildings/Landmark Building/2", "Buildings/Landmark Building/0",
];

/**
 * Drop the survey detail, and the open-space layer, in place.
 *
 * The tiles are drawn from the city's planimetric survey, which maps every sidewalk,
 * median and parking lot. That is accurate, and from z14 in it fills much of the
 * screen, so a resident looking for one address sees the survey before the pins. This
 * keeps what people find their way by — streets, buildings, parks, plazas, water, rail
 * lines and stations — and drops medians, parking lots, pedestrian overpasses, one-way
 * arrows and address numbers, which the hurricane finder's Human Geography style leaves
 * out as well. Station entrances go too: they are small dark shapes with no label,
 * which read as data. Sidewalks stay, since the same layer holds the paths through
 * parks, and nycBasemapPalette draws them so only those show; elevated sidewalks go,
 * since they are drawn over the roads.
 *
 * So do the buildings' drop shadows and outlines, which give a reference map depth
 * but here compete with the pins, and "open space": the survey's layer for schoolyards,
 * cemeteries and vacant lots, which reaches the tiles with no field to tell them apart.
 * Painted as park, it shows a vacant lot as a place to go. addNycCemeteries draws the
 * cemeteries back from the survey's own data.
 */
export function quietNycDetail(style: StyleSpecification): StyleSpecification {
  const hits: Record<string, number> = Object.fromEntries(NYC_DETAIL.map((k) => [k, 0]));
  style.layers = (style.layers || []).filter((layer) => {
    const key = [layer.id, "source-layer" in layer ? layer["source-layer"] : undefined]
      .find((k) => k !== undefined && k in hits);
    if (key === undefined) return true;
    hits[key]++;
    return false;
  });
  reportUnmatched(style, hits);
  return style;
}

/**
 * Draw the city's cemeteries in `color` from the GeoJSON at `url`, in place.
 *
 * The open-space layer quietNycDetail drops is where the tiles keep the cemeteries. The
 * survey's own open-space data does tell a cemetery from a vacant lot, and
 * build/cemeteries.py extracts the city's 111 cemeteries from it into
 * app/public/cemeteries.geojson. This draws them where the open-space layer was: above
 * the parks, directly below the lakes and ponds. The survey stops at the city line, so
 * cemeteries outside the city are not drawn. MapLibre resolves `url` against the page
 * and fetches it alongside the tiles, so the map does not wait for it.
 */
export function addNycCemeteries(
  style: StyleSpecification, url: string, color: string,
): StyleSpecification {
  const layers = style.layers || [];
  if (layers.some((l) => l.id === "cemetery")) return style;
  const hits = { "Inland Hydrography": 0 };
  const at = layers.findIndex((l) => "source-layer" in l && l["source-layer"] === "Inland Hydrography");
  if (at >= 0) {
    hits["Inland Hydrography"]++;
    style.sources = Object.assign({}, style.sources, {
      cemeteries: { type: "geojson" as const, data: url },
    });
    layers.splice(at, 0, {
      id: "cemetery",
      type: "fill",
      source: "cemeteries",
      paint: { "fill-color": color, "fill-antialias": false },
    });
  }
  reportUnmatched(style, hits);
  return style;
}

/** OTI's road classes, by how positron draws their counterparts: side streets as one
 *  line, major roads as a white line on a pale casing. */
const NYC_MINOR_ROADS = ["Local Road", "Ramp", "Alley, Private Road"];
const NYC_MAJOR_ROADS = ["Primary", "Secondary", "Bridge"];

/**
 * Draw streets as centre lines at every zoom, as positron does, in place.
 *
 * From z14 OTI's style stops drawing streets as lines and draws the survey's roadbed
 * instead: each street's pavement, curb to curb, outlined in grey. That is each
 * street's true shape, and it draws an avenue and a side street alike. The tiles carry
 * the centre lines at every zoom, so this drops the roadbed and keeps drawing the
 * lines, in positron's colours and widths: side streets as one line, major roads white
 * on a pale casing, so width tells the main road. The tiles carry secondary roads from
 * z10 and local streets from z12, so below those zooms there are none to draw.
 */
export function nycRoadsAsLines(style: StyleSpecification): StyleSpecification {
  const hits: Record<string, number> = { Roadbeds: 0, "Roadbed Edge": 0 };
  for (const cls of [...NYC_MINOR_ROADS, ...NYC_MAJOR_ROADS]) hits[cls] = 0;
  style.layers = (style.layers || []).filter((layer) => {
    const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
    if (sourceLayer === "Roadbeds" || sourceLayer === "Roadbed Edge") {
      hits[sourceLayer]++;
      return false;
    }
    // Each road is a casing (".../1") drawn under a fill (".../0"), in the city and out.
    const [, cls, part] = layer.id.match(/^(?:NYC|Region) Roads\/(.+)\/([01])$/) || [];
    const minor = NYC_MINOR_ROADS.includes(cls);
    if (layer.type !== "line" || (!minor && !NYC_MAJOR_ROADS.includes(cls))) return true;
    hits[cls]++;
    if (minor && part === "1") return false;
    const look = minor ? POSITRON_ROADS.minor
      : part === "1" ? POSITRON_ROADS.casing : POSITRON_ROADS.major;
    delete layer.maxzoom;
    layer.paint = { "line-color": look.color, "line-width": look.width };
    return true;
  });
  reportUnmatched(style, hits);
  return style;
}

/** Label source-layers by what they name, and the colour each kind is printed in. */
const NYC_LABEL_KINDS = {
  place: ["City Labels", "Neighborhoods"],
  water: ["Water Area Labels", "Water Line Labels/label", "Region Hydrography/label"],
  park: ["Parks/label", "The High Line/label"],
};
const NYC_LABEL_COLORS = {
  place: "#4a4a4a",              // the borough labels' soft near-black
  water: "#495e91",              // positron's water labels
  park: PARK_NAME_COLOR,
  other: "#666",                 // positron's road labels; streets, airports, buildings
};

/** Highway shields wait until this zoom, as positron's do, so that at city zoom they are
 *  not among the pins. */
const NYC_SHIELD_ZOOM = 11;

/** Below this zoom the boroughs are named; from it, the neighbourhoods. The tiles carry
 *  neighbourhood names from z10, where they pile up with the borough names under the
 *  pins; by z12 the screen shows a few neighbourhoods, not the city, and theirs are the
 *  useful names. */
const NYC_NEIGHBOURHOOD_ZOOM = 12;

/** Neighbourhood names in italic capitals, spaced a tenth of an em apart, as the Protomaps
 *  basemap sets them, so the two name a neighbourhood alike. */
const NYC_NEIGHBOURHOOD_TYPE: SymbolLayerSpecification["layout"] = {
  "text-font": ["Noto Sans Italic"], "text-transform": "uppercase", "text-letter-spacing": 0.1,
};

/**
 * Bring the NYC basemap's labels in line with the rest of the block, in place.
 *
 *   1. Type. Every label is set in Noto Sans, the typeface of the list and the card:
 *      Regular, with water and park names in Italic and shield numbers in Bold, which
 *      is positron's scheme; neighbourhood names are Italic too (step 3). Esri's font
 *      server carries Noto, so glyphs still come from the style's own `glyphs` URL.
 *   2. Colour. Each kind of label takes its NYC_LABEL_COLORS colour, on a white halo
 *      as positron's are. Highway shields keep theirs; the shield is the colour.
 *   3. Balance — the correction balancePlaceLabels makes to positron. At the opening
 *      zoom the tiles print neighbourhood names and borough names that land under the
 *      pins, all at once. So the tiles' borough names give way to BOROUGH_LABELS,
 *      anchored on open ground and translated, until neighbourhood names take over at
 *      NYC_NEIGHBOURHOOD_ZOOM, and county names are dropped. Neighbourhood names are set
 *      in NYC_NEIGHBOURHOOD_TYPE. Highway shields wait until NYC_SHIELD_ZOOM. Places
 *      outside the city are not named at all (quietNycRegion).
 *   4. Placeholders. A few features in the data are named "NO NAME", and the style
 *      prints the placeholder. Those labels are filtered out.
 *   5. The Statue of Liberty and Ellis Island are named (addLandmarkLabels).
 *
 * Takes `lang` for the borough labels. Every other label is English: the tiles carry no
 * other language.
 */
export function nycLabels(style: StyleSpecification, lang: string): StyleSpecification {
  const hits: Record<string, number> = {
    "place labels": 0, "water labels": 0, "park labels": 0,
    "City Labels/label/NYC": 0,
    "Neighborhoods/label/Default": 0, "Boundaries/Counties/label/Default": 0,
  };
  const dropped = ["City Labels/label/NYC", "Boundaries/Counties/label/Default"];
  style.layers = (style.layers || []).filter((l) => {
    if (!dropped.includes(l.id)) return true;
    hits[l.id]++;
    return false;
  });

  for (const layer of style.layers) {
    if (layer.type !== "symbol" || !layer.layout?.["text-font"]) continue;
    const shield = "icon-image" in layer.layout;
    const italic = /Italic/.test(JSON.stringify(layer.layout["text-font"]));
    layer.layout["text-font"] =
      [shield ? "Noto Sans Bold" : italic ? "Noto Sans Italic" : "Noto Sans Regular"];
    if (JSON.stringify(layer.layout["text-field"]).includes("_name}")) {
      layer.filter = and(layer.filter, ["!=", "_name", "NO NAME"]);
    }
    if (shield) {
      if (layer["source-layer"] === "Region Road Labels/label") {
        layer.minzoom = Math.max(layer.minzoom ?? 0, NYC_SHIELD_ZOOM);
      }
      continue;
    }
    const kind = (Object.keys(NYC_LABEL_KINDS) as (keyof typeof NYC_LABEL_KINDS)[])
      .find((k) => NYC_LABEL_KINDS[k].includes(layer["source-layer"] || ""));
    if (kind) hits[`${kind} labels`]++;
    layer.paint = Object.assign({}, layer.paint, {
      "text-color": NYC_LABEL_COLORS[kind || "other"],
      "text-halo-color": "rgba(255, 255, 255, 0.8)",
    });
  }

  const neighbourhoods = style.layers.find((l) => l.id === "Neighborhoods/label/Default");
  if (neighbourhoods?.type === "symbol") {
    hits["Neighborhoods/label/Default"]++;
    neighbourhoods.minzoom = NYC_NEIGHBOURHOOD_ZOOM;
    neighbourhoods.layout = { ...neighbourhoods.layout, ...NYC_NEIGHBOURHOOD_TYPE };
  }
  addLandmarkLabels(style, lang);
  addBoroughLabels(style, lang, NYC_NEIGHBOURHOOD_ZOOM);

  reportUnmatched(style, hits);
  return style;
}

/** Region labels kept outside the city: the highway shields. Water labels stay too. */
const NYC_REGION_SHIELDS = [
  "Region Road Labels/label/Interstate Shield", "Region Road Labels/label/US Route",
];

/**
 * Grey the land outside the city, fade its streets and drop its labels, in place, as
 * the other basemaps empty the outside.
 *
 * OTI's tiles split their layers at the city line, Land_NYC from Land_Region and NYC
 * Roads from Region Roads, so here the outside is drawn from the region layers, on
 * OTI's own line, with no shape to test against. The grey is a copy of the region's
 * land in OUTSIDE's colour, laid over it and its parks, under the water: the tiles' sea
 * lies under the land, so a shape laid over everything would grey the harbour too.
 * Airport grounds outside the city are dropped, as positron leaves them out.
 */
export function quietNycRegion(style: StyleSpecification): StyleSpecification {
  const hits: Record<string, number> = {
    "Land/Land_Region/1": 0, "Inland Hydrography": 0, "Region Roads": 0,
    "City Labels/label/Region": 0,
  };
  const land = style.layers.find((l) => l.id === "Land/Land_Region/1");
  const water = style.layers.findIndex((l) => "source-layer" in l
    && l["source-layer"] === "Inland Hydrography");
  if (land?.type === "fill" && water >= 0) {
    hits["Land/Land_Region/1"]++;
    hits["Inland Hydrography"]++;
    style.layers.splice(water, 0, { ...structuredClone(land), id: "outside_city",
      paint: { "fill-color": OUTSIDE.color, "fill-opacity": OUTSIDE.opacity } });
  }
  style.layers = style.layers.filter((l) => {
    const sourceLayer = "source-layer" in l ? l["source-layer"] ?? "" : "";
    if (l.id === "City Labels/label/Region") {
      hits[l.id]++;
      return false;
    }
    if (l.type === "fill" && sourceLayer === "Region Airports") return false;
    return !(l.type === "symbol" && sourceLayer.startsWith("Region")
      && !sourceLayer.startsWith("Region Hydrography") && !NYC_REGION_SHIELDS.includes(l.id));
  });
  for (const l of style.layers) {
    if (l.type !== "line" || l["source-layer"] !== "Region Roads") continue;
    hits["Region Roads"]++;
    l.paint = { ...l.paint, "line-opacity": OUTSIDE.streets };
  }
  reportUnmatched(style, hits);
  return style;
}
