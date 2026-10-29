// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { stubScreen } from "../test/fixtures.ts";
import {
  GA_ID, GTM_ID, NO_FEATURE, landingType, featureFields, searchFields, track,
} from "./analytics.ts";
import type { Found } from "./places.ts";
import type { SiteProperties } from "./types.ts";

beforeEach(() => { window.dataLayer = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("track", () => {
  test("every push says how the page was seen, then the event's own fields", () => {
    stubScreen(false);
    track("filter_select", { filter_name: "pets", filter_value: "on", active_filter_count: 1 });
    expect(window.dataLayer).toEqual([{
      event: "filter_select", view_mode: "mobile", language: "en", ga_id: GA_ID, gtm_id: GTM_ID,
      filter_name: "pets", filter_value: "on", active_filter_count: 1,
    }]);
    // In the order of the spec, so a push reads the same in Tag Manager's preview.
    expect(Object.keys(window.dataLayer![0]).slice(0, 5))
      .toEqual(["event", "view_mode", "language", "ga_id", "gtm_id"]);
  });

  test("a desktop's layout is desktop, from 768 px", () => {
    stubScreen(true);
    track("card_open", NO_FEATURE);
    expect(window.dataLayer![0].view_mode).toBe("desktop");
  });
});

describe("landingType", () => {
  test("an address with a card, the map view or a filter in it is a shared link", () => {
    for (const search of ["?site=a", "?view=map", "?type=bus", "?open=1", "?pets=1",
      "?wheelchair=1", "?lang=es&type=Library"]) {
      expect(landingType(search)).toBe("shared_link");
    }
  });

  test("a plain address, or one that only sets the language or basemap, is home", () => {
    for (const search of ["", "?lang=es", "?basemap=oti", "?list=off&title=Map"]) {
      expect(landingType(search)).toBe("home");
    }
  });
});

describe("featureFields", () => {
  const p = (props: Partial<SiteProperties> & Record<string, unknown>) =>
    ({ id: "a", org: "Alpha", org_id: "o1", address: "1 Main St", ...props }) as SiteProperties;

  test("a site's id, name and borough, and its org_type as its type", () => {
    expect(featureFields(p({ borough: "Bronx", org_type: "Library" }), {})).toEqual({
      feature_id: "a", feature_name: "Alpha", feature_type: "Library", feature_borough: "Bronx",
    });
  });

  test("the type is the property featureType names, and what a site lacks is null", () => {
    expect(featureFields(p({ type: "bus", org_type: "Library" }), { featureType: "type" }))
      .toEqual({ feature_id: "a", feature_name: "Alpha", feature_type: "bus", feature_borough: null });
    expect(featureFields(p({}), {}).feature_type).toBeNull();
  });
});

describe("searchFields", () => {
  const found = (f: Partial<Found>): Found =>
    ({ kind: "address", name: "", cross: null, borough: null, center: [0, 0], bbox: null, ...f });
  const ntas = { MN0101: "Financial District-Battery Park City" };

  test("an address reports its ZIP code, borough and neighborhood, never itself", () => {
    expect(searchFields(found({
      name: "120 Broadway", borough: "Manhattan", zip: "10271", nta: "MN0101",
    }), ntas)).toEqual({
      search_zip: "10271", search_borough: "Manhattan",
      search_neighborhood: "Financial District-Battery Park City",
    });
  });

  test("an NTA code with no name, or no codes at all, leave those fields null", () => {
    expect(searchFields(found({ kind: "intersection", borough: "Queens", nta: "QN9999" }), ntas))
      .toEqual({ search_zip: null, search_borough: "Queens", search_neighborhood: null });
  });

  test("a neighborhood, a ZIP code and a borough report themselves", () => {
    expect(searchFields(found({ kind: "nbhd", name: "Harlem", borough: "Manhattan" }), ntas))
      .toEqual({ search_zip: null, search_borough: "Manhattan", search_neighborhood: "Harlem" });
    expect(searchFields(found({ kind: "zip", name: "10027" }), ntas))
      .toEqual({ search_zip: "10027", search_borough: null, search_neighborhood: null });
    expect(searchFields(found({ kind: "borough", name: "Bronx" }), ntas))
      .toEqual({ search_zip: null, search_borough: "Bronx", search_neighborhood: null });
  });
});

describe("the map pages' Tag Manager snippets", () => {
  const PAGES = ["index", "computer-centers", "snap", "warming", "wheelchair-friendly"];

  test.each(PAGES)("%s.html loads the container analytics.ts names, and only that one", (page) => {
    const html = readFileSync(resolve(import.meta.dirname, `../../${page}.html`), "utf8");
    expect(html).toContain(`'script','dataLayer','${GTM_ID}'`);
    expect(html).toContain(`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`);
    expect(new Set(html.match(/GTM-[A-Z0-9]+/g))).toEqual(new Set([GTM_ID]));
  });
});
