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
 * Rewrite label expressions in place. Exported separately so a caller that already has a
 * style object (a self-hosted one, a city-branded one) can language-switch it without a
 * fetch — the PMTiles swap in the README does exactly that.
 *
 * The replacement expression is a coalesce chain:
 *   requested language -> latin transliteration -> whatever the tile calls it locally
 * so a place with no translation still gets a label instead of a blank.
 */
export function setStyleLanguage(style, lang) {
  const target = (lang || "en") === "en"
    // For English, name:latin is the better first choice than name:en: OpenMapTiles
    // populates it for far more features, and for NYC the two agree.
    ? ["coalesce", ["get", "name:latin"], ["get", "name:en"], ["get", "name"]]
    : ["coalesce", ["get", `name:${lang}`], ["get", "name:latin"], ["get", "name"]];

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
