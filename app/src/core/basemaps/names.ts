/**
 * names.ts — the basemaps the block can draw, by id and display name.
 *
 * No map code, so the URL parser and the pages' basemap menus can list the basemaps
 * without loading MapLibre. index.ts says how each one is drawn.
 */

export const BASEMAP_NAMES = {
  protomaps: "Protomaps, self-hosted",
  openfreemap: "OpenFreeMap",
  nyc: "OTI NYC Basemap, our palette",
  "nyc-original": "OTI NYC Basemap, its own colours",
} as const;

export type BasemapId = keyof typeof BASEMAP_NAMES;

export const DEFAULT_BASEMAP: BasemapId = "openfreemap";

/** Older links name OpenFreeMap by its style, positron. */
const ALIASES: Record<string, BasemapId> = { positron: "openfreemap" };

/** The basemap a `?basemap=` value names, or the default for anything else. */
export function basemapId(value: string | null): BasemapId {
  if (value && Object.hasOwn(BASEMAP_NAMES, value)) return value as BasemapId;
  return (value && Object.hasOwn(ALIASES, value) && ALIASES[value]) || DEFAULT_BASEMAP;
}
