/**
 * filters.ts — which Trick-or-Streets events the reader has asked to see.
 *
 * A filter hides the same events from the list and the map, and lives in the address bar
 * so a copied link carries it: ?type=signature&now=1. No types named means every type.
 */
import type { Site } from "../../logic/types.ts";
import { eventDetails, eventStatus } from "./events.ts";

export interface Filters {
  /** The kinds of event to show, by `type`. Empty shows every kind. */
  types: string[];
  /** Only events on at this minute. */
  happeningNow: boolean;
}

export const NO_FILTERS: Filters = { types: [], happeningNow: false };

export function filtersFromUrl(search: string): Filters {
  const params = new URLSearchParams(search);
  return {
    types: (params.get("type") || "").split(",").filter(Boolean),
    happeningNow: params.get("now") === "1",
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
  set("now", filters.happeningNow ? "1" : null);
  return out;
}

/** How many filters are in use, for the count on the Filters button. */
export function activeFilters(filters: Filters): number {
  return (filters.types.length ? 1 : 0) + Number(filters.happeningNow);
}

/** Whether an event passes the filters at `minute` past midnight on `today`, New York
 *  time. */
export function passes(feature: Site, filters: Filters, today: string, minute: number): boolean {
  if (filters.types.length && !filters.types.includes(eventDetails(feature).type ?? "")) {
    return false;
  }
  if (filters.happeningNow && eventStatus(feature, today, minute) !== "now") return false;
  return true;
}
