/**
 * params.js — the block's URL parameters, read into settings.
 *
 * Pure: the page's address, base URI and origin are passed in rather than read from
 * `window`, so this runs (and is tested) without a browser.
 */

export const DEFAULTS = { data: "sites.geojson", orgs: "orgs.json", list: "on" };

/**
 * Resolve a `data=` / `orgs=` parameter to a URL we are willing to fetch.
 *
 * These parameters are attacker-controllable — anyone can iframe this page with any
 * query string — so they are restricted to the block's own origin. Without this, the
 * embed is a content proxy: a third party could point it at their own GeoJSON and have
 * a city page render their text. Same-origin keeps "swap the data file" working (the
 * point of the parameter) without opening that door.
 */
export function sameOriginUrl(value, fallback, baseURI, origin) {
  const url = new URL(value || fallback, baseURI);
  if (url.origin !== origin) {
    console.warn(`[embed] ignoring cross-origin data URL ${url.href}; using ${fallback}`);
    return new URL(fallback, baseURI);
  }
  return url;
}

/**
 * Every parameter the block reads. `lang` is returned as given: resolving it against
 * `<html lang>` is basemap-style.js's `resolveLang`, which needs the document.
 */
export function readSettings(search, baseURI, origin) {
  const params = new URLSearchParams(search);
  return {
    data: sameOriginUrl(params.get("data"), DEFAULTS.data, baseURI, origin),
    orgs: sameOriginUrl(params.get("orgs"), DEFAULTS.orgs, baseURI, origin),
    lang: params.get("lang"),
    list: params.get("list") === "off" ? "off" : DEFAULTS.list,
    title: params.get("title"),
    site: params.get("site"),
  };
}
