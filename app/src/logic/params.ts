/**
 * params.ts — the block's URL parameters, read into settings.
 *
 * Pure: the page's address, base URI and origin are passed in rather than read from
 * `window`, so this runs (and is tested) without a browser.
 *
 * Each map is a page that names its own files (see main.tsx), so one build serves several
 * maps: app/ is the SNAP map, app/computer-centers.html the computer centers.
 */
import { basemapId } from "../core/basemaps/names.ts";
import type { BasemapId } from "../core/basemaps/names.ts";

export const DEFAULTS = {
  config: "config.json", data: "sites.geojson", orgs: "orgs.json", list: "on",
} as const;

/** The files a page names for itself, in place of DEFAULTS. `orgs: ""` means the map has
 *  no orgs.json, and the block groups the sites by their `org` property instead. */
export interface PageFiles {
  config?: string;
  data?: string;
  orgs?: string;
}

/** What the block reads from its URL. */
export interface Settings {
  /** config.json, the point data and orgs.json, resolved against the page and same-origin
   *  only. `orgs` is null for a map without one. */
  config: URL;
  data: URL;
  orgs: URL | null;
  /** The label language: a bare subtag such as "es". See basemap-style.ts's resolveLang. */
  lang: string;
  /** "off" hides the list and leaves the map alone in the frame. */
  list: "on" | "off";
  /** A heading that overrides config.json's `title`. */
  title: string | null;
  /** The site whose card opens on load. */
  site: string | null;
  /** Which basemap to draw. See core/basemaps/names.ts. */
  basemap: BasemapId;
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
 * `<html lang>` is basemap-style.ts's `resolveLang`, which needs the document. `files` are
 * the page's own; `?data=` and `?orgs=` still override them.
 */
export function readSettings(
  search: string, baseURI: string, origin: string, files: PageFiles = {},
): Omit<Settings, "lang"> & { lang: string | null } {
  const params = new URLSearchParams(search);
  const orgs = params.get("orgs") || files.orgs;
  return {
    // Not a URL parameter: config.json decides what the card says, which an embed's
    // query string should not.
    config: sameOriginUrl(null, files.config || DEFAULTS.config, baseURI, origin),
    data: sameOriginUrl(params.get("data"), files.data || DEFAULTS.data, baseURI, origin),
    orgs: orgs === "" ? null : sameOriginUrl(orgs ?? null, DEFAULTS.orgs, baseURI, origin),
    lang: params.get("lang"),
    list: params.get("list") === "off" ? "off" : DEFAULTS.list,
    title: params.get("title"),
    site: params.get("site"),
    basemap: basemapId(params.get("basemap")),
  };
}
