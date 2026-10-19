/**
 * filters.ts — which warming centers the reader has asked to see.
 *
 * A filter hides the same centers from the list and the map, and lives in the address bar
 * so a copied link carries it: ?type=hospital,bus&open=1&wheelchair=1&pets=1. No types
 * named means every type.
 */
import type { Site } from "../../logic/types.ts";
import { centerDetails, centerStatus } from "./centers.ts";

export interface Filters {
  /** The kinds of center to show, by `type`. Empty shows every kind. */
  types: string[];
  /** Only centers open at this minute. */
  openNow: boolean;
  wheelchair: boolean;
  pets: boolean;
}

export const NO_FILTERS: Filters = { types: [], openNow: false, wheelchair: false, pets: false };

export function filtersFromUrl(search: string): Filters {
  const params = new URLSearchParams(search);
  return {
    types: (params.get("type") || "").split(",").filter(Boolean),
    openNow: params.get("open") === "1",
    wheelchair: params.get("wheelchair") === "1",
    pets: params.get("pets") === "1",
  };
}

/** `url` with the filters written into it, and any filter not in use taken out. */
export function withFilters(url: URL, filters: Filters): URL {
  const out = new URL(url);
  const set = (key: string, value: string | null) => {
    if (value) out.searchParams.set(key, value);
    else out.searchParams.delete(key);
  };
  set("type", filters.types.join(",") || null);
  set("open", filters.openNow ? "1" : null);
  set("wheelchair", filters.wheelchair ? "1" : null);
  set("pets", filters.pets ? "1" : null);
  return out;
}

/** How many filters are in use, for the count on the Filters button. */
export function activeFilters(filters: Filters): number {
  return (filters.types.length ? 1 : 0) + Number(filters.openNow) + Number(filters.wheelchair)
    + Number(filters.pets);
}

/** Whether a center passes the filters at `minute` past midnight, New York time. */
export function passes(feature: Site, filters: Filters, minute: number): boolean {
  const details = centerDetails(feature);
  if (filters.types.length && !filters.types.includes(details.type ?? "")) return false;
  if (filters.wheelchair && !details.wheelchair) return false;
  if (filters.pets && !details.pets) return false;
  if (filters.openNow) {
    const status = centerStatus(feature, minute);
    if (!status || status.state === "closed") return false;
  }
  return true;
}
