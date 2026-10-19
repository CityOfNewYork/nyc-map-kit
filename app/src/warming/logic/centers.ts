import type { Site, SiteProperties } from "../../logic/types.ts";

/** What each value of a center's `type` is called in the list. */
const CENTER_TYPES = new Map([
  ["hospital", "Hospital"],
  ["dropin", "Drop-in center"],
  ["bus", "Warming bus"],
]);

/** The kind of center, as the list names it: "Warming bus". Undefined for a type not
 *  named above. */
export function centerType(feature: Site): string | undefined {
  const { type } = feature.properties as SiteProperties & { type?: string };
  return type === undefined ? undefined : CENTER_TYPES.get(type);
}
