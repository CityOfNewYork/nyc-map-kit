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

/** Every center's mark, whatever its kind: a white house on red, on the map's pins and
 *  beside each center in the list and the card. The red clears 3:1 against the
 *  basemap's land, and the white house 3:1 against the red. The house is a solid mark,
 *  within the 40% of its square that core/pins.ts holds marks to. */
export const CENTER_MARK: PinStyle = {
  color: "#f74226",
  glyph: "M12 2.5 22 11.5H19.5V21H14.25V15.5H9.75V21H4.5V11.5H2Z",
  fill: true,
};

/** What a center's card shows, as the block's config.json would say it (see Card in ui/):
 *  a Call button, the website as a fact row, how to get in, and the day it was updated.
 *  The hours row is worked out from `opens` and `closes` instead (see CenterCard). */
export const CENTER_CONFIG: Config = {
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
