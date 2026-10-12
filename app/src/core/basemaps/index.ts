/**
 * basemaps/index.ts — load a basemap by id, in the one palette every basemap shares.
 *
 * Each basemap has its own file, because each one's rules are written against its own
 * tile schema. What they share (the warm tint, the borough labels, positron's look) is
 * in ../basemap-style.ts. Adding a basemap means a file here, an entry in LOADERS and a
 * name in names.ts.
 */
import type { StyleSpecification } from "maplibre-gl";
import type { BasemapId } from "./names.ts";
import { loadNyc, loadNycOriginal } from "./nyc.ts";
import { loadOpenFreeMap } from "./openfreemap.ts";
import { loadProtomaps } from "./protomaps.ts";

/**
 * Water and parks get real, if quiet, colour. Positron draws both as greys a few steps
 * from the land, which is faithful to its brief as a background but leaves a resident
 * with no landmarks: the East River and Prospect Park are what tell someone which part
 * of the city they are looking at. Both stay well below the pins in saturation, so the
 * data is still the loudest thing on the map. Cemeteries are open green ground too, and
 * are drawn in a greyer green than the parks, as OpenStreetMap's own style draws them,
 * so that they do not read as parks.
 */
export const BASEMAP_PALETTE = {
  water: "hsl(202, 42%, 80%)",
  park:  "hsl(96, 30%, 84%)",
  cemetery: "hsl(96, 16%, 83%)",
};

export type Palette = typeof BASEMAP_PALETTE;

const LOADERS: Record<BasemapId, (lang: string) => Promise<StyleSpecification>> = {
  protomaps: (lang) => loadProtomaps(lang, BASEMAP_PALETTE),
  openfreemap: (lang) => loadOpenFreeMap(lang, BASEMAP_PALETTE),
  nyc: (lang) => loadNyc(lang, BASEMAP_PALETTE),
  "nyc-original": () => loadNycOriginal(),
};

/** The style for basemap `id`, with labels in `lang` where its tiles carry that language. */
export function loadBasemap(id: BasemapId, lang: string): Promise<StyleSpecification> {
  return LOADERS[id](lang);
}
