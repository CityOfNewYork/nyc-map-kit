/**
 * basemap-style.ts — what every basemap shares: label language, the borough labels, the
 * warm tint, and positron's look, which the other basemaps are brought to.
 *
 * WHY THIS FILE EXISTS
 * Basemap labels are drawn by the GPU onto a canvas, not laid out as HTML, and their
 * words come from the tiles rather than from the interface's own (logic/i18n.ts). So
 * the basemap switches language here, by which of the tiles' name fields it reads.
 *
 * Vector tiles from OpenMapTiles carry a name field per language (`name:es`, `name:zh`,
 * `name:ru`, …) alongside `name` (local) and `name:latin`. The style ships with a
 * text-field expression that prefers the local name; this module rewrites those
 * expressions to prefer the requested language and fall back cleanly.
 *
 * Each basemap's own rules live in basemaps/, one file per basemap; basemaps/index.ts
 * lists them.
 */
import type { Feature, FeatureCollection, MultiLineString, Point, Polygon } from "geojson";
import { convertFilter } from "@maplibre/maplibre-gl-style-spec";
import type {
  ExpressionSpecification, FillLayerSpecification, FilterSpecification, LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import CITY_LIMITS from "./city-limits.json";
import CITY_LINE from "./city-line.json";
import { STATION_COLOR, STATION_ICON } from "./station-icon.ts";

/** The label fields a text-field expression may read. If an expression mentions any of
 *  these, it is a name label and we rewrite it. `ref` (highway shields) is not one. */
const NAME_FIELDS = ["name", "name:latin", "name:nonlatin", "name_en", "name_int"];

/**
 * Resolve the label language, in priority order:
 *   1. `explicit`, the interface's language (logic/i18n.ts's chooseLanguage)
 *   2. `<html lang>`
 *   3. English
 * Returns a bare subtag ("es", not "es-419") because that is how OpenMapTiles keys its
 * name fields.
 */
export function resolveLang(explicit?: string | null): string {
  const raw = explicit || document.documentElement.getAttribute("lang") || "en";
  return String(raw).trim().toLowerCase().split(/[-_]/)[0] || "en";
}

/** True if this text-field expression is a name label rather than, say, a road shield. */
function readsAName(expr: unknown): boolean {
  return JSON.stringify(expr ?? "").includes('"name');
}

/**
 * Fetch the style JSON and return it with every name label switched to `lang`.
 * Returns a plain object, which is handed to MapLibre as `style:` — MapLibre never sees
 * the URL, so it never re-fetches and undoes the rewrite.
 */
export async function loadBasemapStyle(
  styleUrl: string, lang: string,
): Promise<StyleSpecification> {
  const resp = await fetch(styleUrl);
  if (!resp.ok) throw new Error(`basemap style ${styleUrl} returned ${resp.status}`);
  const style = await resp.json();
  return setStyleLanguage(style, lang);
}

/**
 * The text-field expression that prints a feature's name in `lang`: the requested
 * language, then the latin transliteration, then whatever the tile calls it locally.
 * Exported because the borough labels below are our own features and have to print
 * their names by the same rule the basemap's own labels follow.
 */
export function nameExpression(lang: string): ExpressionSpecification {
  return (lang || "en") === "en"
    // For English, name:latin is the better first choice than name:en: OpenMapTiles
    // populates it for far more features, and for NYC the two agree.
    ? ["coalesce", ["get", "name:latin"], ["get", "name:en"], ["get", "name"]]
    : ["coalesce", ["get", `name:${lang}`], ["get", "name:latin"], ["get", "name"]];
}

/**
 * Rewrite label expressions in place. Exported separately so a caller that already has a
 * style object (a self-hosted one, a city-branded one) can language-switch it without a
 * fetch — the PMTiles swap in the README does exactly that.
 *
 * Every name label becomes the coalesce chain above, so a place with no translation
 * still gets a label instead of a blank.
 */
export function setStyleLanguage(style: StyleSpecification, lang: string): StyleSpecification {
  const target = nameExpression(lang);

  let rewritten = 0;
  for (const layer of style.layers || []) {
    if (layer.type !== "symbol") continue;
    const field = layer.layout && layer.layout["text-field"];
    if (!readsAName(field)) continue;          // leaves highway shields (["get","ref"]) alone
    layer.layout!["text-field"] = target;
    rewritten++;
  }
  style.metadata = Object.assign({}, style.metadata, {
    "nyc-map-kit:lang": lang,
    "nyc-map-kit:label-layers-rewritten": rewritten,
  });
  return style;
}

/** Park names, on every basemap: a dark shade of the park fill's green. */
export const PARK_NAME_COLOR = "hsl(96, 25%, 30%)";

/**
 * The five boroughs as label points, for the z9–14 band where the tiles have no
 * name to print inside the city.
 *
 * Names are lifted from the tiles' own `place` layer at z11 — the same OpenStreetMap
 * features positron labels one zoom further in — so these carry the translations the
 * basemap would have used. `name` is the English label; the `name:xx` fields are the
 * ones OpenStreetMap has that differ from it, which is why the list is uneven.
 *
 * The coordinates are not OpenStreetMap's. They are label anchors, nudged onto open
 * ground — Central Park, Prospect Park, Bronx Park — because the pins are drawn above
 * this layer and never move out of a label's way, so OpenStreetMap's own points (Midtown,
 * central Brooklyn) put the borough's name under a pile of pins. Moving a pin is not an
 * option; moving the name a mile costs nothing at this zoom.
 */
const BOROUGH_LABELS: FeatureCollection<Point> = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [-73.9665, 40.7831] },
      properties: { name: "Manhattan", "name:zh": "曼哈頓", "name:ru": "Манхэттен",
        "name:bn": "ম্যানহাটন", "name:ko": "맨해튼", "name:ar": "مانهاتن", "name:ur": "مینہیٹن" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-73.876, 40.862] },
      properties: { name: "The Bronx", "name:es": "El Bronx", "name:zh": "布朗克斯", "name:ru": "Бронкс",
        "name:bn": "দ্য ব্রংক্স", "name:ko": "브롱크스", "name:ar": "البرونكس", "name:ur": "برونکس کاؤنٹی",
        "name:fr": "Bronx", "name:pl": "Bronx" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-73.7949, 40.7282] },
      properties: { name: "Queens", "name:zh": "皇后區", "name:ru": "Куинс",
        "name:bn": "কুইন্স", "name:ko": "퀸스", "name:ar": "كوينز", "name:ur": "کوئینز" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-73.959, 40.6827] },
      properties: { name: "Brooklyn", "name:zh": "布魯克林區", "name:ru": "Бруклин",
        "name:bn": "ব্রুকলিন", "name:ko": "브루클린", "name:ar": "بروكلين", "name:ur": "بروکلن" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-74.1502, 40.5795] },
      properties: { name: "Staten Island", "name:zh": "史泰登岛", "name:ru": "Статен-Айленд",
        "name:bn": "স্ট্যাটেন আইল্যান্ড", "name:ko": "스태튼아일랜드", "name:ar": "جزيرة ستاتن", "name:ur": "سٹیٹن جزیرہ" } },
  ],
};

/** A layer filter that keeps what `existing` keeps and also meets every clause. The
 *  clauses must be written in the same syntax as `existing`, expression or legacy:
 *  MapLibre rejects a filter that mixes the two. */
export function and(existing: FilterSpecification | undefined, ...clauses: FilterSpecification[]) {
  return (existing ? ["all", existing, ...clauses] : ["all", ...clauses]) as FilterSpecification;
}

/**
 * Add the five borough names from BOROUGH_LABELS as the top label layer, in place, up
 * to `maxzoom`: the zoom at which the basemap's neighbourhood names take over and a
 * borough name becomes noise.
 */
export function addBoroughLabels(
  style: StyleSpecification, lang: string, maxzoom: number,
): StyleSpecification {
  const layers = style.layers || [];
  if (layers.some((l) => l.id === "borough_label")) return style;
  style.sources = Object.assign({}, style.sources, {
    boroughs: { type: "geojson" as const, data: BOROUGH_LABELS },
  });
  // Appended last, so it is placed before the labels underneath it and an island
  // never wins the collision against the borough it sits in. The pins are added
  // after the style loads and sit above this.
  layers.push({
    id: "borough_label",
    type: "symbol",
    source: "boroughs",
    maxzoom,
    layout: {
      "text-field": nameExpression(lang),
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 9, 13, 12, 17],
      "text-max-width": 8,
    },
    // Softer than the near-black the basemap gives Newark and Jersey City: these
    // name the ground the pins are standing on, and should not compete with them.
    paint: {
      "text-color": "#4a4a4a",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.4,
      "text-halo-blur": 1,
    },
  });
  return style;
}

/**
 * Two landmarks in the harbour, as label points: the Statue of Liberty and Ellis Island.
 * No basemap's tiles name them as places: Protomaps and OpenFreeMap carry them as points
 * of interest, which the block does not draw, and OTI's tiles name only the statue's
 * building, from z17. Names and translations are OpenStreetMap's, lifted from the
 * Protomaps tiles' points, as BOROUGH_LABELS' are; the points are the statue and the
 * middle of Ellis Island.
 */
const LANDMARK_LABELS: FeatureCollection<Point> = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [-74.0445, 40.6893] },
      properties: { name: "Statue of Liberty", "name:es": "Estatua de la Libertad",
        "name:zh": "自由女神像", "name:ru": "Статуя Свободы", "name:ko": "자유의 여신상",
        "name:ar": "تمثال الحرية", "name:ur": "مجسمہ آزادی", "name:fr": "Statue de la Liberté",
        "name:pl": "Statua Wolności", "name:it": "Statua della Libertà" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-74.0397, 40.6990] },
      properties: { name: "Ellis Island", "name:es": "Isla Ellis", "name:ru": "Остров Эллис" } },
  ],
};

/** The landmarks are named from this zoom, the one the Protomaps tiles name them from. */
const LANDMARK_ZOOM = 13;

/**
 * Add the LANDMARK_LABELS names as a top label layer, in place, from LANDMARK_ZOOM: grey
 * italic, as the other basemaps' street and building names are grey and park names
 * italic.
 */
export function addLandmarkLabels(style: StyleSpecification, lang: string): StyleSpecification {
  const layers = style.layers || [];
  if (layers.some((l) => l.id === "landmark_label")) return style;
  style.sources = Object.assign({}, style.sources, {
    landmarks: { type: "geojson" as const, data: LANDMARK_LABELS },
  });
  layers.push({
    id: "landmark_label",
    type: "symbol",
    source: "landmarks",
    minzoom: LANDMARK_ZOOM,
    layout: {
      "text-field": nameExpression(lang),
      "text-font": ["Noto Sans Italic"],
      "text-size": 12,
      "text-max-width": 7,
    },
    paint: {
      "text-color": "#666",
      "text-halo-color": "rgba(255, 255, 255, 0.8)",
      "text-halo-width": 1,
    },
  });
  return style;
}

/* ---------------------------------------------------------------- subway stations */

/** One point per station complex, from build/subway-stations.py. MapLibre resolves it
 *  against the page and fetches it alongside the tiles, so the map does not wait for it. */
export const SUBWAY_STATIONS = "subway-stations.geojson";

/** Stations show from this zoom, and are named from the next, where there is room: the
 *  zoom the default basemap names its side streets from. */
const STATION_ZOOM = 14;
const STATION_NAME_ZOOM = 15;

/**
 * Add the subway's stations, in place: an icon at each station complex, from
 * STATION_ZOOM, and its name beside it where there is room.
 *
 * Where a basemap's tiles have stations, they have one per platform: Fulton St is four
 * stations in OTI's tiles, which its published style hides, and in OpenStreetMap's, whose
 * points of interest the block does not draw. So this draws the MTA's own list instead,
 * one point per complex, the same on every basemap. The icon follows OTI's: a train in
 * a ring. The layer sits above the basemap's other labels, so a station is placed before
 * the street names around it; the pins are drawn above it and keep their place.
 */
export function addSubwayStations(
  style: StyleSpecification, url = SUBWAY_STATIONS,
): StyleSpecification {
  const layers = style.layers || [];
  if (layers.some((l) => l.id === "subway_station")) return style;
  style.sources = Object.assign({}, style.sources, {
    subway: {
      type: "geojson" as const, data: url,
      attribution: 'Subway stations: <a href="https://data.ny.gov/d/5f5g-n3cz">MTA</a>',
    },
  });
  layers.push({
    id: "subway_station",
    type: "symbol",
    source: "subway",
    minzoom: STATION_ZOOM,
    layout: {
      "icon-image": STATION_ICON,
      // Smaller until they are named, while they are many to the screen, so the pins stay
      // the loudest.
      "icon-size": ["interpolate", ["linear"], ["zoom"], STATION_ZOOM, 0.7, STATION_NAME_ZOOM, 1],
      "text-field": ["step", ["zoom"], "", STATION_NAME_ZOOM, ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-max-width": 8,
      // Right of the icon first, as transit maps put it; then wherever there is room.
      "text-variable-anchor": ["left", "right", "top", "bottom"],
      "text-radial-offset": 0.9,
      "text-justify": "auto",
      "text-optional": true,
    },
    paint: {
      "text-color": STATION_COLOR,
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.2,
    },
  });
  return style;
}

/* ---------------------------------------------------------------- warm tint

 * WHY THIS EXISTS
 * Positron is the right basemap for a locator map: it is quiet, it is flat (no
 * 3D building extrusions to fight with at high zoom), and it stays neutral no
 * matter what data is drawn on top of it — which matters, because this block is
 * meant to carry datasets nobody has picked yet. Its one drawback is that its
 * greys are cool, which reads as clinical.
 *
 * So rather than adopt a warmer style and inherit its opinions about roads,
 * parks and buildings, we keep positron and shift its neutrals to a warm paper
 * tone. Warmth is the only change: saturation stays low enough that the basemap
 * is still a background, and no layer gains a colour it did not have.
 *
 * THE RULE, in three parts:
 *   1. Symbol layers are left alone. Label colours are a contrast decision, not
 *      a palette one, and their halos are meant to read as separation.
 *   2. Water, park and cemetery layers are left alone by the tint. A beige Hudson
 *      looks broken, and the cool water against warm land is what makes the tint
 *      read as paper rather than as a colour cast over the whole map. The caller can
 *      instead hand water and parks their own colour (`water`, `park`), which is how
 *      the block gives the rivers and the big parks just enough hue to be landmarks;
 *      cemeteries are added with theirs (addCemeteries, addNycCemeteries).
 *   3. Every other paint colour that is already near-neutral is re-emitted at
 *      the warm hue, keeping its original lightness and alpha. Anything that
 *      carries real colour is left as-is, so pointing this at a style with a
 *      green park or a blue motorway shield does not mangle it.
 *
 * Because it works on lightness rather than on a list of layer ids, an upstream
 * restyle of positron does not silently un-tint the map the way a hard-coded
 * colour table would.
 */

/** Warm hue (~orange-tan), and how much colour to actually put there.
 *
 *  WARM_CHROMA is a target *chroma* — roughly the red-to-blue spread in the
 *  resulting RGB, here about 9 of 255 — not a saturation. This matters: HSL
 *  saturation means less and less as a colour approaches white, so a fixed 10%
 *  saturation that warms a mid-grey boundary line visibly does nothing at all
 *  to a near-white background. Holding chroma constant and solving for the
 *  saturation each lightness needs puts the same amount of warmth on every
 *  layer, from the background down to the boundary lines. */
const WARM_HUE = 35;
const WARM_CHROMA = 0.035;
const MAX_SAT = 0.6;
/** Lightness outside this band has no room for chroma; leave it exactly alone,
 *  which is why the white road fills stay white against the warmed ground. */
const TINTABLE_L = [0.02, 0.99];
/** A colour at or below this saturation counts as "neutral" and gets tinted. */
const NEUTRAL_MAX_SAT = 0.12;

/** A colour as hue (degrees), saturation, lightness and alpha, each but hue from 0 to 1. */
interface Hsla {
  h: number;
  s: number;
  l: number;
  a: number;
}

/** rgb/rgba/hsl/hsla/#rgb/#rrggbb -> {h,s,l,a}, or null if it is not a colour
 *  literal we recognise. Named CSS colours ("white") return null and are left
 *  untouched; positron uses none, but a future style might. */
function parseColor(value: unknown): Hsla | null {
  const str = String(value).trim().toLowerCase();

  let m = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return rgbToHsl(rgb[0], rgb[1], rgb[2], 1);
  }

  m = str.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(parseFloat);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    const [r, g, b] = parts;
    return rgbToHsl(r / 255, g / 255, b / 255, parts.length > 3 ? parts[3] : 1);
  }

  m = str.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(parseFloat);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return { h: parts[0], s: parts[1] / 100, l: parts[2] / 100, a: parts.length > 3 ? parts[3] : 1 };
  }

  return null;
}

function rgbToHsl(r: number, g: number, b: number, a: number): Hsla {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s, l, a };
}

/** Round-trip a colour through the warm hue, keeping lightness and alpha.
 *  Returns null for anything that should be left exactly as it was. */
function warmed({ s, l, a }: Hsla): string | null {
  if (s > NEUTRAL_MAX_SAT) return null;                 // already has real colour
  if (l < TINTABLE_L[0] || l > TINTABLE_L[1]) return null;
  // How much saturation this lightness needs to land on WARM_CHROMA.
  const headroom = 1 - Math.abs(2 * l - 1);
  const sat = Math.min(WARM_CHROMA / headroom, MAX_SAT);
  const satPct = (sat * 100).toFixed(1);
  const light = (l * 100).toFixed(1);
  return a >= 1
    ? `hsl(${WARM_HUE}, ${satPct}%, ${light}%)`
    : `hsla(${WARM_HUE}, ${satPct}%, ${light}%, ${a})`;
}

/** Walk a paint value — a colour string, an expression array with colour literals
 *  buried in it, or a legacy zoom function (`{"stops": [[12, "#f0ece9"], …]}`, which
 *  Esri's styles use) — and tint every colour leaf. Non-colour strings in an
 *  expression ("interpolate", "linear", "zoom") fail to parse and pass through. */
function tintValue(value: unknown, counter: { n: number }): unknown {
  if (Array.isArray(value)) return value.map((v) => tintValue(v, counter));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tintValue(v, counter)]));
  }
  if (typeof value !== "string") return value;
  const parsed = parseColor(value);
  if (!parsed) return value;
  const next = warmed(parsed);
  if (!next) return value;
  counter.n++;
  return next;
}

/**
 * Shift a style's neutral paint colours to a warm paper tone, in place.
 *
 * Exported separately from loadBasemapStyle so a caller holding a style object
 * — a self-hosted one, the PMTiles swap in the README — can warm it without a
 * fetch, and so it can be skipped entirely by passing `warm: false`.
 */
export function warmTint(
  style: StyleSpecification, options: { water?: string; park?: string } = {},
): StyleSpecification {
  const { water, park } = options;
  const counter = { n: 0 };
  // Rule 2: the two feature classes that carry hue on a map people navigate by. A caller
  // that has its own opinion about them passes a colour; otherwise they pass through.
  //
  // This and the loop below walk paint properties by name, whatever the layer type, so
  // they write to a layer's paint as a plain record rather than through its type.
  const setColor = (layer: LayerSpecification, color?: string) => {
    if (!color || !layer.paint) return;
    for (const prop of Object.keys(layer.paint)) {
      if (prop.includes("color")) (layer.paint as Record<string, unknown>)[prop] = color;
    }
  };
  for (const layer of style.layers || []) {
    if (layer.type === "symbol") continue;                        // rule 1
    if (/water/.test(layer.id || "")) { setColor(layer, water); continue; }
    if (/park|wood/.test(layer.id || "")) { setColor(layer, park); continue; }
    if (/cemetery/.test(layer.id || "")) continue;
    if (layer.type === "background" && layer.paint == null) continue;
    for (const [prop, value] of Object.entries(layer.paint || {})) {
      if (!prop.includes("color")) continue;                      // rule 3
      (layer.paint as Record<string, unknown>)[prop] = tintValue(value, counter);
    }
  }
  style.metadata = Object.assign({}, style.metadata, {
    "nyc-map-kit:warm-tint": `${WARM_HUE}deg/chroma ${WARM_CHROMA}`,
    "nyc-map-kit:colors-tinted": counter.n,
    "nyc-map-kit:water": water || "unchanged",
    "nyc-map-kit:park": park || "unchanged",
  });
  return style;
}

/**
 * Report the rules that matched no layer, in place.
 *
 * The NYC basemap's rules change OTI's style by its layer and source-layer names, which
 * were set when the tiles were authored and can change when OTI re-releases the
 * basemap. A rule whose layer was renamed stops applying without an error, and the map
 * quietly drifts back towards OTI's own look. So each function counts the layers every
 * rule touched, and a rule that touched none is logged and listed in the style's
 * metadata. basemaps/nyc.test.ts runs every rule against OTI's live style.
 */
export function reportUnmatched(style: StyleSpecification, hits: Record<string, number>): void {
  const missed = Object.keys(hits).filter((rule) => hits[rule] === 0);
  if (!missed.length) return;
  console.warn(`[basemap] rules that matched no layer: ${missed.join(", ")}`);
  const before = (style.metadata as Record<string, unknown> | undefined)?.["nyc-map-kit:unmatched"];
  style.metadata = Object.assign({}, style.metadata, {
    "nyc-map-kit:unmatched": [...(Array.isArray(before) ? before : []), ...missed],
  });
}

/* ------------------------------------------------------------ outside the city

 * WHY THIS EXISTS
 * The map is of New York City. The land around it is there to show where the city ends,
 * not to be read, and at street level New Jersey's streets and town names compete with
 * the city's own. So outside the city line the ground is a cool grey, the roads are
 * pale, and nothing is named but the highways and the water, as the City's Summer in NYC
 * map draws it. The grey goes under the water, so a river or the harbour stays one colour
 * from shore to shore.
 *
 * The line is the city's own: City Planning's borough boundaries with water included,
 * merged into one outline by build/city-limits.py. Each basemap empties the outside its
 * own way, as cheaply as its tiles allow: the Protomaps file is cut down when it is built
 * (build/protomaps-outside.py), so the browser has nothing to hide; OTI's tiles split
 * their layers at the city line (quietNycRegion); only OpenFreeMap, whose tiles we do not
 * build, hides its labels in the browser (hideLabelsOutsideCity).
 */

/** The outside: a cool grey laid over the ground, how much of a road remains, and the
 *  city line's colour, positron's for boundaries. */
export const OUTSIDE = { color: "#4f5b78", opacity: 0.1, streets: 0.35, line: "hsl(0, 0%, 70%)" };

/** Everything outside the city: the world, with the city's rings cut out of it. */
const OUTSIDE_CITY: Polygon = {
  type: "Polygon",
  coordinates: [
    [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]],
    ...CITY_LIMITS.geometry.coordinates.map((polygon) => [...polygon[0]].reverse()),
  ],
};

/**
 * Grey the land outside the city, in place, directly under the layer `below`: the first
 * water layer drawn over the land, so water outside the city keeps its colour. It is one
 * fill of one polygon, which costs the map next to nothing to draw.
 */
export function greyOutsideCity(style: StyleSpecification, below: string,
  opacity = OUTSIDE.opacity): StyleSpecification {
  const at = style.layers.findIndex((l) => l.id === below);
  if (at < 0) {
    reportUnmatched(style, { [below]: 0 });
    return style;
  }
  style.sources = Object.assign({}, style.sources, {
    outside_city: { type: "geojson" as const, data: OUTSIDE_CITY },
  });
  style.layers.splice(at, 0, {
    id: "outside_city", type: "fill", source: "outside_city",
    paint: { "fill-color": OUTSIDE.color, "fill-opacity": opacity },
  });
  return style;
}

/**
 * Dot the city line where it crosses land, in place, as the NYC basemap draws it: Queens
 * against Nassau, the Bronx against Westchester. Inserted at `at`, above the streets,
 * since the line runs down some of them. Only the land stretches are drawn
 * (app/src/core/city-line.json, from build/city-limits.py), so no line crosses the water.
 * For a basemap whose own boundary lines do not already draw it.
 */
export function dotCityLine(style: StyleSpecification, at: number): StyleSpecification {
  style.sources = Object.assign({}, style.sources, {
    city_line: { type: "geojson" as const, data: CITY_LINE as Feature<MultiLineString> },
  });
  style.layers.splice(at < 0 ? style.layers.length : at, 0, {
    id: "city_line", type: "line", source: "city_line",
    paint: { "line-color": OUTSIDE.line, "line-width": 1, "line-dasharray": [1, 2] },
  });
  return style;
}

/**
 * Show the labels of `source` only inside the city, in place, except those `keep` names
 * (the highway shields and the water).
 *
 * This uses MapLibre's `within` test, which the browser runs on every label as its tile
 * loads, and which counts a label along a street that crosses the city line as outside.
 * It is for basemaps whose tiles we do not build; where we build the tiles, the labels
 * outside the city are left out of the file instead.
 */
export function hideLabelsOutsideCity(style: StyleSpecification, source: string,
  keep: (layer: LayerSpecification) => boolean): StyleSpecification {
  const inside = ["within", CITY_LIMITS] as ExpressionSpecification;
  for (const layer of style.layers) {
    if (layer.type !== "symbol" || layer.source !== source || keep(layer)) continue;
    // Expression and legacy filters cannot be mixed, so the layer's own is converted.
    layer.filter = layer.filter
      ? ["all", convertFilter(layer.filter) as ExpressionSpecification, inside]
      : inside;
  }
  return style;
}

/* ---------------------------------------------------------- positron's look

 * Positron, the style OpenFreeMap serves, is the reference look: the other basemaps are
 * repainted to its land, buildings and roads, so that switching basemap changes the
 * data underneath and not the design. Colours are as positron writes them, before
 * warmTint.
 */

/** Land, and buildings in positron's fill and outline. */
export const POSITRON_LAND = "rgb(242,243,240)";
export const POSITRON_BUILDING = { fill: "rgb(234, 234, 229)", outline: "rgb(219, 219, 218)" };

/** Buildings appear from BUILDING_ZOOM, the scale at which Google's map first shows them,
 *  once its streets are block by block, and fade in over the half zoom before it. */
const BUILDING_ZOOM = 16;

/** Draw a building layer flat, in positron's fill and outline, from BUILDING_ZOOM, in
 *  place. The Protomaps and NYC basemaps' buildings go through this, so they appear at
 *  the same zoom. */
export function flatBuildings(layer: FillLayerSpecification) {
  layer.minzoom = BUILDING_ZOOM - 0.5;
  layer.paint = {
    "fill-color": POSITRON_BUILDING.fill, "fill-outline-color": POSITRON_BUILDING.outline,
    "fill-opacity": ["interpolate", ["linear"], ["zoom"], BUILDING_ZOOM - 0.5, 0, BUILDING_ZOOM, 1],
  };
}

/** Positron's roads: its colours, before warmTint, and its widths, which grow
 *  exponentially with zoom. Side streets turn from grey to white at z14, as
 *  lightenSideStreets has them on positron. */
export const POSITRON_ROADS: Record<"minor" | "major" | "casing",
  { color: string | ExpressionSpecification; width: ExpressionSpecification }> = {
  minor: {
    color: ["interpolate", ["linear"], ["zoom"], 13, "hsl(0, 0%, 88%)", 14, "#fff"],
    width: ["interpolate", ["exponential", 1.55], ["zoom"], 13, 1.8, 20, 20],
  },
  major: {
    color: "#fff",
    width: ["interpolate", ["exponential", 1.3], ["zoom"], 10, 2, 20, 20],
  },
  casing: {
    color: "rgb(213, 213, 213)",
    width: ["interpolate", ["exponential", 1.3], ["zoom"], 10, 3, 20, 23],
  },
};

export { NAME_FIELDS };
