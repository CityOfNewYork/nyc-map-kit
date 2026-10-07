/**
 * basemap-style.js — fetch a vector basemap style and set the language of its labels.
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
export function resolveLang(explicit) {
  const raw = explicit || document.documentElement.getAttribute("lang") || "en";
  return String(raw).trim().toLowerCase().split(/[-_]/)[0] || "en";
}

/** True if this text-field expression is a name label rather than, say, a road shield. */
function readsAName(expr) {
  return JSON.stringify(expr ?? "").includes('"name');
}

/**
 * Fetch the style JSON and return it with every name label switched to `lang`.
 * Returns a plain object, which is handed to MapLibre as `style:` — MapLibre never sees
 * the URL, so it never re-fetches and undoes the rewrite.
 */
export async function loadBasemapStyle(styleUrl, lang) {
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
export function nameExpression(lang) {
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
export function setStyleLanguage(style, lang) {
  const target = nameExpression(lang);

  let rewritten = 0;
  for (const layer of style.layers || []) {
    if (layer.type !== "symbol") continue;
    const field = layer.layout && layer.layout["text-field"];
    if (!readsAName(field)) continue;          // leaves highway shields (["get","ref"]) alone
    layer.layout["text-field"] = target;
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
export function addLandcoverParks(style) {
  const layers = style.layers || [];
  if (layers.some((l) => l.id === "landcover_park")) return style;
  const source = Object.keys(style.sources || {})
    .find((k) => style.sources[k] && style.sources[k].type === "vector");
  if (!source) return style;
  const layer = {
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
const BOROUGH_LABELS = {
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
export function balancePlaceLabels(style, lang) {
  const layers = style.layers || [];
  const layer = (id) => layers.find((l) => l.id === id);
  const and = (existing, ...clauses) =>
    (existing ? ["all", existing, ...clauses] : ["all", ...clauses]);

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

  if (layer("borough_label")) return style;
  style.sources = Object.assign({}, style.sources, {
    boroughs: { type: "geojson", data: BOROUGH_LABELS },
  });
  // Appended last, so it is placed before the labels underneath it and an island
  // never wins the collision against the borough it sits in. The pins are added
  // after the style loads and sit above this.
  layers.push({
    id: "borough_label",
    type: "symbol",
    source: "boroughs",
    maxzoom: 14,
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
  style.metadata = Object.assign({}, style.metadata, {
    "nyc-map-kit:place-labels": "balanced",
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

/** rgb/rgba/hsl/hsla/#rgb/#rrggbb -> {h,s,l,a}, or null if it is not a colour
 *  literal we recognise. Named CSS colours ("white") return null and are left
 *  untouched; positron uses none, but a future style might. */
function parseColor(value) {
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

function rgbToHsl(r, g, b, a) {
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
function warmed({ s, l, a }) {
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

/** Walk a paint value — a colour string, or an expression array with colour
 *  literals buried in it — and tint every colour leaf. Non-colour strings in an
 *  expression ("interpolate", "linear", "zoom") fail to parse and pass through. */
function tintValue(value, counter) {
  if (Array.isArray(value)) return value.map((v) => tintValue(v, counter));
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
export function warmTint(style, options = {}) {
  const { water, park } = options;
  const counter = { n: 0 };
  // Rule 2: the two feature classes that carry hue on a map people navigate by. A caller
  // that has its own opinion about them passes a colour; otherwise they pass through.
  const setColor = (layer, color) => {
    if (!color || !layer.paint) return;
    for (const prop of Object.keys(layer.paint)) {
      if (prop.includes("color")) layer.paint[prop] = color;
    }
  };
  for (const layer of style.layers || []) {
    if (layer.type === "symbol") continue;                        // rule 1
    if (/water/.test(layer.id || "")) { setColor(layer, water); continue; }
    if (/park|wood/.test(layer.id || "")) { setColor(layer, park); continue; }
    if (layer.type === "background" && layer.paint == null) continue;
    for (const [prop, value] of Object.entries(layer.paint || {})) {
      if (!prop.includes("color")) continue;                      // rule 3
      layer.paint[prop] = tintValue(value, counter);
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

export { NAME_FIELDS };
