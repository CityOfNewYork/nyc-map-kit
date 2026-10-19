import type { PinCategories } from "../../core/map-core.ts";
import type { Site, SiteProperties } from "../../logic/types.ts";
import { statusAt } from "./hours.ts";
import type { OpenStatus } from "./hours.ts";

/** The fields of a center the warming app reads, beyond a site's. */
type CenterProperties = SiteProperties & { type?: string; opens?: string; closes?: string };

/** A kind of center: what the list calls it, the colour of its pins and icons, and the
 *  glyph they carry, as SVG path data on a 24-unit square. */
export interface CenterKind {
  label: string;
  color: string;
  glyph: string;
}

/** The kinds, by the value of a center's `type`, in the order the map key lists them.
 *  Each colour clears 3:1 against the basemap's land, water and parks, and under its white
 *  glyph. The red and the green are alike in lightness, so the glyph is what tells them
 *  apart to a reader who cannot see the difference in hue. */
export const CENTER_KINDS = new Map<string, CenterKind>([
  ["hospital", { label: "Hospital", color: "#d71920", glyph: "M8 5v14M16 5v14M8 12h8" }],
  ["dropin", {
    label: "Drop-in center", color: "#1b7a3d",
    glyph: "M4.5 11.5 12 5l7.5 6.5M7 10v9h10v-9",
  }],
  ["bus", {
    label: "Warming bus", color: "#050560",
    glyph: "M7 4.5h10a2 2 0 0 1 2 2V17H5V6.5a2 2 0 0 1 2-2zM5 11.5h14M8 17v2.5M16 17v2.5",
  }],
]);

/** The pins map-core draws for each kind. */
export const CENTER_PINS: PinCategories = {
  field: "type",
  values: Object.fromEntries(
    [...CENTER_KINDS].map(([type, { color, glyph }]) => [type, { color, glyph }])),
};

/** A center's kind. Undefined for a type not listed above. */
export function centerKind(feature: Site): CenterKind | undefined {
  const { type } = feature.properties as CenterProperties;
  return type === undefined ? undefined : CENTER_KINDS.get(type);
}

/** Whether a center is open at `minute` past midnight, New York time. Null when its
 *  hours cannot be read. */
export function centerStatus(feature: Site, minute: number): OpenStatus | null {
  const { opens, closes } = feature.properties as CenterProperties;
  return statusAt(opens, closes, minute);
}
