/**
 * analytics.ts — the events a map pushes to window.dataLayer, and the fields each carries.
 * Google Tag Manager, loaded by the snippet in each map page's <head>, reads the pushes
 * and sends them to Google Analytics.
 *
 * Every push also says how the page was seen: `view_mode`, `language`, and the container
 * and GA4 property, `gtm_id` and `ga_id`. No push carries text a resident typed or a full
 * address: a search reports only its ZIP code, borough and neighborhood.
 */
import { language } from "./i18n.ts";
import type { Found } from "./places.ts";
import type { Config, SiteProperties } from "./types.ts";

/** The Tag Manager container each map page's snippet loads. analytics.test.ts checks the
 *  pages name this one. */
export const GTM_ID = "GTM-W7Z4H9CG";
/** The GA4 property the container's tags send to. */
export const GA_ID = "G-RX85E7KWD4";

/** The width from which the layout is a desktop's rather than a phone's (style.css). */
const DESKTOP = "(min-width: 768px)";

/** The site an event is about: the one whose card it came from. */
export interface FeatureFields {
  feature_id: string | null;
  feature_name: string | null;
  feature_type: string | null;
  feature_borough: string | null;
}

/** Each event, and the fields it carries besides the four every push has. */
export interface Events {
  /** Once per page load, as the app starts. */
  map_view: { landing_type: "home" | "shared_link" };
  /** A card opened, however it was reached: a pin, the list, a link, the stepper. */
  card_open: FeatureFields;
  /** A phone number on a card was pressed. */
  call_action: FeatureFields;
  /** Directions on a card was pressed. */
  direction_action: FeatureFields;
  /** A website on a card was pressed. */
  website_action: FeatureFields;
  /** A link was copied: a card's ("feature"), or the map view's ("map", no feature). */
  share_action: FeatureFields & { share_scope: "feature" | "map" };
  /** One filter changed. `active_filter_count` is how many are on after the change. */
  filter_select: { filter_name: string; filter_value: string; active_filter_count: number };
  /** A search result was chosen. */
  map_search: {
    search_zip: string | null;
    search_borough: string | null;
    search_neighborhood: string | null;
  };
}

/** Push `event` with `fields`, after the fields every push carries. */
export function track<E extends keyof Events>(event: E, fields: Events[E]): void {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event,
    view_mode: window.matchMedia?.(DESKTOP).matches ? "desktop" : "mobile",
    language: language(),
    ga_id: GA_ID,
    gtm_id: GTM_ID,
    ...fields,
  });
}

/** The feature fields for a site. Its type is the property config.json's `featureType`
 *  names, `org_type` when absent. */
export function featureFields(p: SiteProperties, config: Config): FeatureFields {
  const fields = p as unknown as Record<string, string | undefined>;
  return {
    feature_id: p.id,
    feature_name: p.org || null,
    feature_type: fields[config.featureType || "org_type"] || null,
    feature_borough: p.borough || null,
  };
}

/** No feature: for a link to the map view rather than to one site. */
export const NO_FEATURE: FeatureFields = {
  feature_id: null, feature_name: null, feature_type: null, feature_borough: null,
};

/** The parameters that make an address a shared view: a site's card, the map view or a
 *  filter. `lang`, `basemap` and the rest only set how a page looks. */
const SHARED = ["site", "view", "type", "open", "pets", "wheelchair"];

/** How the page was reached: from an address that carries a view, or plainly. */
export function landingType(search: string): Events["map_view"]["landing_type"] {
  const params = new URLSearchParams(search);
  return SHARED.some((key) => params.has(key)) ? "shared_link" : "home";
}

/** What a search reports: the ZIP code, borough and neighborhood of the result, never
 *  its name. A Geoclient result names its neighborhood by 2020 NTA code; `ntas` (from
 *  places.json) has the names. */
export function searchFields(found: Found, ntas: Record<string, string>): Events["map_search"] {
  return {
    search_zip: found.kind === "zip" ? found.name : found.zip || null,
    search_borough: found.kind === "borough" ? found.name : found.borough,
    search_neighborhood: found.kind === "nbhd" ? found.name
      : (found.nta && ntas[found.nta]) || null,
  };
}
