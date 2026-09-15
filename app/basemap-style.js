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

export { NAME_FIELDS };
