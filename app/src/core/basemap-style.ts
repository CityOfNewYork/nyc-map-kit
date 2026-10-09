/**
 * basemap-style.ts — fetch a vector basemap style and set the language of its labels.
 *
 * WHY THIS FILE EXISTS
 * Basemap labels are drawn by the GPU onto a canvas, not laid out as HTML. The city's
 * translation proxy rewrites DOM text nodes, so it cannot see them and cannot translate
 * them. Every other string in this app is a real text node and the proxy handles it; the
 * basemap is the one place the app has to switch language itself. That is all the
 * language logic in the block — there are no string files anywhere.
 *
 * Vector tiles from OpenMapTiles carry a name field per language (`name:es`, `name:zh`,
 * `name:ru`, …) alongside `name` (local) and `name:latin`. The style ships with a
 * text-field expression that prefers the local name; this module rewrites those
 * expressions to prefer the requested language and fall back cleanly.
 *
 * SWAPPING THE BASEMAP is confined to this file. See README §Swapping a layer.
 */
import type { FeatureCollection, Point } from "geojson";
import type {
  ExpressionSpecification, FilterSpecification, LayerSpecification, StyleSpecification,
} from "maplibre-gl";

/** The label fields a text-field expression may read. If an expression mentions any of
 *  these, it is a name label and we rewrite it. `ref` (highway shields) is not one. */
const NAME_FIELDS = ["name", "name:latin", "name:nonlatin", "name_en", "name_int"];

/**
 * Resolve the display language, in priority order:
 *   1. an explicit `?lang=` URL parameter (the host page can force one)
 *   2. `<html lang>` — which is what the translation proxy sets when it serves a
 *      translated page, so the basemap follows the page without being told
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

/** Park names, on both basemaps: a dark shade of the park fill's green. */
const PARK_NAME_COLOR = "hsl(96, 25%, 30%)";

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

/** Islands whose name repeats a borough's. Positron labels them from the same
 *  `place` layer, so without this both would print over the same land. */
const ISLANDS_NAMED_FOR_BOROUGHS = ["Staten Island", "Manhattan Island"];

/** A layer filter that keeps what `existing` keeps and also meets every clause. The
 *  clauses must be written in the same syntax as `existing`, expression or legacy:
 *  MapLibre rejects a filter that mixes the two. */
function and(existing: FilterSpecification | undefined, ...clauses: FilterSpecification[]) {
  return (existing ? ["all", existing, ...clauses] : ["all", ...clauses]) as FilterSpecification;
}

/**
 * Rebalance the place labels for a map framed on New York City, in place.
 *
 * Four edits, each reversible on its own:
 *   1. Town labels wait until z11.5 and village labels until z12.5 — far enough in
 *      that a reader looking at Hoboken or Valley Stream is asking about it. City
 *      names (Newark, Jersey City, Hackensack) are untouched at every zoom, because
 *      they are what tells you which way you are facing.
 *   2. The boroughs are drawn from BOROUGH_LABELS below z14, where the tiles have
 *      nothing, and stop there because that is where real neighbourhood names take
 *      over and a borough name becomes noise.
 *   3. The tiles' own borough labels are dropped, along with the two islands named
 *      after boroughs, so no name is printed twice.
 *   4. "New York" is dropped. It is the city the whole map is of; once the labels
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
  const town = layer("label_town");
  if (town) town.minzoom = 11.5;
  const village = layer("label_village");
  if (village) village.minzoom = 12.5;

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
 *   2. Water and park layers are left alone by the tint. A beige Hudson looks
 *      broken, and the cool water against warm land is what makes the tint read
 *      as paper rather than as a colour cast over the whole map. The caller can
 *      instead hand each its own colour (`water`, `park`), which is how the block
 *      gives the rivers and the big parks just enough hue to be landmarks.
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

/* ---------------------------------------------------------- OTI's NYC basemap

 * OTI publishes its own vector basemap of the city, NYC_Basemap_v3, as an Esri vector
 * tile service on ArcGIS Online, with styles that sit on it as ArcGIS items. Esri's
 * styles are Mapbox GL style documents, and MapLibre draws them as they are. Their
 * labels are English only: every label layer prints a single `_name` field, so
 * setStyleLanguage has nothing to switch to and is not applied.
 */

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

/**
 * Report the rules that matched no layer, in place.
 *
 * The functions below change OTI's style by its layer and source-layer names, which
 * were set when the tiles were authored and can change when OTI re-releases the
 * basemap. A rule whose layer was renamed stops applying without an error, and the map
 * quietly drifts back towards OTI's own look. So each function counts the layers every
 * rule touched, and a rule that touched none is logged and listed in the style's
 * metadata. basemap-style.test.ts runs every rule against OTI's live style.
 */
function reportUnmatched(style: StyleSpecification, hits: Record<string, number>): void {
  const missed = Object.keys(hits).filter((rule) => hits[rule] === 0);
  if (!missed.length) return;
  console.warn(`[basemap] NYC basemap rules that matched no layer: ${missed.join(", ")}`);
  const before = (style.metadata as Record<string, unknown> | undefined)?.["nyc-map-kit:unmatched"];
  style.metadata = Object.assign({}, style.metadata, {
    "nyc-map-kit:unmatched": [...(Array.isArray(before) ? before : []), ...missed],
  });
}

/** The NYC basemap's source-layers, grouped by the colour this block gives them.
 *  Plazas count as parks: residents use them as open space, and OpenStreetMap maps the
 *  larger ones, MetroTech Commons among them, as parks. */
const NYC_WATER = ["Ocean", "Inland Hydrography", "Region Hydrography"];
const NYC_PARK = ["Parks", "Region Parks", "Plaza", "The High Line"];
const NYC_LAND = ["Land/Land_NYC", "Land/Land_Region"];
const NYC_LAND_COLOR = "rgb(242,243,240)";
/** Buildings in positron's fill and outline. */
const NYC_BUILDING = { fill: "rgb(234, 234, 229)", outline: "rgb(219, 219, 218)" };
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
 * Buildings, landmarks included, are drawn flat in positron's fill and outline. The
 * style draws them a darker grey, and landmarks darker still, which suits a reference
 * map but at street level outweighs the pins; quietNycDetail drops the outlines and
 * drop shadows it draws them with. Station platforms are drawn darker than the buildings but not in
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
      layer.paint = { "fill-color": NYC_BUILDING.fill, "fill-outline-color": NYC_BUILDING.outline };
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
 * Painted as park, it shows a vacant lot as a place to go.
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

/** OTI's road classes, by how positron draws their counterparts: side streets as one
 *  line, major roads as a white line on a pale casing. */
const NYC_MINOR_ROADS = ["Local Road", "Ramp", "Alley, Private Road"];
const NYC_MAJOR_ROADS = ["Primary", "Secondary", "Bridge"];

/** Positron's roads: its colours, before warmTint, and its widths, which grow
 *  exponentially with zoom. Side streets turn from grey to white at z14, as
 *  lightenSideStreets has them on positron. */
const POSITRON_ROADS: Record<"minor" | "major" | "casing",
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
/** Below this zoom positron draws every road but the motorways as one thin grey line,
 *  in this colour; from it, white on a casing. */
const POSITRON_MAJOR_ZOOM = 11;
const POSITRON_SUBTLE = "hsla(0, 0%, 85%, 0.69)";

/**
 * Draw streets as centre lines at every zoom, as positron does, in place.
 *
 * From z14 OTI's style stops drawing streets as lines and draws the survey's roadbed
 * instead: each street's pavement, curb to curb, outlined in grey. That is each
 * street's true shape, and it draws an avenue and a side street alike. The tiles carry
 * the centre lines at every zoom, so this drops the roadbed and keeps drawing the
 * lines, in positron's colours and widths: side streets as one line, major roads white
 * on a pale casing, so width tells the main road.
 * Below z11 secondary roads are one thin grey line, as positron draws its own, which
 * at city zoom gives the street grid some texture. The tiles carry secondary roads
 * from z10 and local streets from z12, so below those zooms there are none to draw.
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
    if (cls === "Secondary" && part === "1") layer.minzoom = POSITRON_MAJOR_ZOOM;
    else if (cls === "Secondary") {
      layer.paint["line-color"] = ["step", ["zoom"], POSITRON_SUBTLE, POSITRON_MAJOR_ZOOM, "#fff"];
    }
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

/** Towns outside the city named at every zoom, as the tiles spell them, line breaks and
 *  all: a large neighbour to the west and one to the north, to say which way the map
 *  is facing. Positron's balanced labels keep Newark and Jersey City for the same reason. */
const NYC_ORIENTING_CITIES = ["Newark", "Jersey\nCity", "Yonkers"];

/** Highway shields wait until this zoom, as positron's do, so that at city zoom they are
 *  not among the pins. */
const NYC_SHIELD_ZOOM = 11;

/** Below this zoom the boroughs are named; from it, the neighbourhoods. The tiles carry
 *  neighbourhood names from z10, where they pile up with the borough names under the
 *  pins; by z12 the screen shows a few neighbourhoods, not the city, and theirs are the
 *  useful names. */
const NYC_NEIGHBOURHOOD_ZOOM = 12;

/**
 * Bring the NYC basemap's labels in line with the rest of the block, in place.
 *
 *   1. Type. Every label is set in Noto Sans, the typeface of the list and the card:
 *      Regular, with water and park names in Italic and shield numbers in Bold, which
 *      is positron's scheme. Esri's font server carries Noto, so glyphs still come
 *      from the style's own `glyphs` URL.
 *   2. Colour. Each kind of label takes its NYC_LABEL_COLORS colour, on a white halo
 *      as positron's are. Highway shields keep theirs; the shield is the colour.
 *   3. Balance — the correction balancePlaceLabels makes to positron. At the opening
 *      zoom the tiles print a dozen New Jersey and Westchester towns, neighbourhood
 *      names, and borough names that land under the pins, all at once. So towns
 *      outside the city wait until z11.5, apart from NYC_ORIENTING_CITIES; the
 *      boroughs are drawn from BOROUGH_LABELS, anchored on open ground and translated,
 *      until neighbourhood names take over at NYC_NEIGHBOURHOOD_ZOOM; and county names
 *      outside the city are dropped, since they name nothing a resident is looking for.
 *      Highway shields wait until NYC_SHIELD_ZOOM.
 *   4. Placeholders. A few features in the data are named "NO NAME", and the style
 *      prints the placeholder. Those labels are filtered out.
 *
 * Takes `lang` for the borough labels. Every other label is English: the tiles carry no
 * other language.
 */
export function nycLabels(style: StyleSpecification, lang: string): StyleSpecification {
  const hits: Record<string, number> = {
    "place labels": 0, "water labels": 0, "park labels": 0,
    "City Labels/label/Region": 0, "City Labels/label/NYC": 0,
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

  // Region towns. The tiles rank none above another, so the orienting cities are named.
  // Esri writes its filters in the legacy syntax, so the added clauses are legacy too.
  const at = style.layers.findIndex((l) => l.id === "City Labels/label/Region");
  const region = style.layers[at];
  if (region && region.type === "symbol") {
    hits["City Labels/label/Region"]++;
    const orienting = structuredClone(region);
    orienting.id += "/orienting";
    orienting.filter = and(region.filter, ["in", "_name1", ...NYC_ORIENTING_CITIES]);
    region.filter = and(region.filter, ["!in", "_name1", ...NYC_ORIENTING_CITIES]);
    region.minzoom = 11.5;
    style.layers.splice(at + 1, 0, orienting);
  }

  const neighbourhoods = style.layers.find((l) => l.id === "Neighborhoods/label/Default");
  if (neighbourhoods) {
    hits["Neighborhoods/label/Default"]++;
    neighbourhoods.minzoom = NYC_NEIGHBOURHOOD_ZOOM;
  }
  addBoroughLabels(style, lang, NYC_NEIGHBOURHOOD_ZOOM);

  reportUnmatched(style, hits);
  return style;
}

export { NAME_FIELDS };
