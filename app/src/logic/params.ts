/**
 * params.ts — the block's URL parameters, read into settings.
 *
 * Pure: the page's address, base URI and origin are passed in rather than read from
 * `window`, so this runs (and is tested) without a browser.
 */

export const DEFAULTS = { data: "sites.geojson", orgs: "orgs.json", list: "on" } as const;

/** What the block reads from its URL. */
export interface Settings {
  /** The point data and orgs.json, resolved against the page and same-origin only. */
  data: URL;
  orgs: URL;
  /** The label language: a bare subtag such as "es". See basemap-style.ts's resolveLang. */
  lang: string;
  /** "off" hides the list and leaves the map alone in the frame. */
  list: "on" | "off";
  /** A heading that overrides config.json's `title`. */
  title: string | null;
  /** The site whose card opens on load. */
  site: string | null;
}

/**
 * Resolve a `data=` / `orgs=` parameter to a URL we are willing to fetch.
 *
 * These parameters are attacker-controllable — anyone can iframe this page with any
 * query string — so they are restricted to the block's own origin. Without this, the
 * embed is a content proxy: a third party could point it at their own GeoJSON and have
 * a city page render their text. Same-origin keeps "swap the data file" working (the
 * point of the parameter) without opening that door.
 */
export function sameOriginUrl(
  value: string | null, fallback: string, baseURI: string, origin: string,
): URL {
  const url = new URL(value || fallback, baseURI);
  if (url.origin !== origin) {
    console.warn(`[embed] ignoring cross-origin data URL ${url.href}; using ${fallback}`);
    return new URL(fallback, baseURI);
  }
  return url;
}

/**
 * Every parameter the block reads. `lang` is returned as given: resolving it against
 * `<html lang>` is basemap-style.ts's `resolveLang`, which needs the document.
 */
export function readSettings(
  search: string, baseURI: string, origin: string,
): Omit<Settings, "lang"> & { lang: string | null } {
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
