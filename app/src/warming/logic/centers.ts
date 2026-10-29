import type { PinStyle } from "../../core/map-core.ts";
import type { Config, Site, SiteProperties } from "../../logic/types.ts";
import { statusAt } from "./hours.ts";
import type { OpenStatus } from "./hours.ts";

/** The fields of a center the warming app reads, beyond a site's. Any may be missing. */
export interface CenterDetails {
  type?: string;
  /** "HH:MM", New York time (see hours.ts). */
  opens?: string;
  closes?: string;
  phone?: string;
  /** The center's web page, with or without "https://". */
  website?: string;
  wheelchair?: boolean;
  pets?: boolean;
  /** How to get in, in a sentence or two. */
  instructions?: string;
  /** The day the center's details were last checked, "2026-10-04". */
  updated?: string;
}
type CenterProperties = SiteProperties & CenterDetails;

/** A kind of center: what the list, the card and the filters call it. */
export interface CenterKind {
  label: string;
}

/** The kinds, by the value of a center's `type`, in the order the filters list them. */
export const CENTER_KINDS = new Map<string, CenterKind>([
  ["hospital", { label: "Hospital" }],
  ["dropin", { label: "Drop-in center" }],
  ["bus", { label: "Warming bus" }],
]);

/** Every center's mark, whatever its kind: a red pin outlined in pale pink with a pale
 *  pink house in its head, and the same red circle and house beside each center in the
 *  list and the card. The red clears 3:1 against the basemap's land, and the pink 3:1
 *  against the red. The house, with its eaves and its door, is a solid mark within the
 *  40% of its square that core/pins.ts holds marks to. */
export const CENTER_MARK: PinStyle = {
  color: "#f74226",
  accent: "#ffe5e6",
  glyph: "M10.95 3.95Q12 3 13.05 3.95L21.1 11.2Q21.6 11.65 21 12.2H19V18.6Q19 20 17.6 20H6.4"
    + "Q5 20 5 18.6V12.2H3Q2.4 11.65 2.9 11.2ZM10.4 14.6Q10.4 14 11 14H13Q13.6 14 13.6 14.6V18"
    + "H10.4Z",
  fill: true,
};

/** What a center's card shows, as the block's config.json would say it (see Card in ui/):
 *  a Call button, the website as a fact row, how to get in, and the day it was updated.
 *  The hours row is worked out from `opens` and `closes` instead (see CenterCard). */
export const CENTER_CONFIG: Config = {
  featureType: "type",
  actions: [{ key: "phone", source: "site", label: "Call", as: "tel" }],
  facts: [{ key: "website", source: "site", label: "Website", as: "url", icon: "globe" }],
  card: [{ key: "instructions", source: "site", label: "How to get in" }],
  updated: { key: "updated", source: "site" },
};

/** A center's kind. Undefined for a type not listed above. */
export function centerKind(feature: Site): CenterKind | undefined {
  const { type } = feature.properties as CenterProperties;
  return type === undefined ? undefined : CENTER_KINDS.get(type);
}

/** A center's own fields. */
export function centerDetails(feature: Site): CenterDetails {
  return feature.properties as CenterProperties;
}

/** Whether a center is open at `minute` past midnight, New York time. Null when its
 *  hours cannot be read. */
export function centerStatus(feature: Site, minute: number): OpenStatus | null {
  const { opens, closes } = feature.properties as CenterProperties;
  return statusAt(opens, closes, minute);
}
