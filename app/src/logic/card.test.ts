import { describe, expect, test } from "vitest";
import {
  cardActions, cardFields, displayUrl, formatDate, hrefFor, mapsLink, mapsQuery,
  parseStructure, telHref,
} from "./card.ts";
import type { Config, FieldRef, Site, SiteProperties } from "./types.ts";

describe("telHref", () => {
  test("keeps an extension in its own RFC 3966 field", () => {
    expect(telHref("(212)766-9200 x2224")).toBe("tel:2127669200;ext=2224");
    expect(telHref("212-555-0100 ext. 12")).toBe("tel:2125550100;ext=12");
  });
  test("a plain number is just its digits", () => {
    expect(telHref("(718) 555-0199")).toBe("tel:7185550199");
  });
});

describe("links", () => {
  test("a website without a scheme gets https", () => {
    expect(hrefFor("example.org")).toBe("https://example.org");
    expect(hrefFor("http://example.org")).toBe("http://example.org");
  });
  test("a website is shown without its scheme or trailing slash", () => {
    expect(displayUrl("https://www.example.org/")).toBe("www.example.org");
  });
});

const p: SiteProperties = {
  id: "s1", org: "Example Org", org_id: "o1", address: "1 Centre St, New York, NY",
  phone: "(212)766-9200 x2224", website: "example.org", dba: "Example Org",
};
const org = { org_id: "o1", hours: "Mon–Fri", description: "" };
const feature: Site = {
  type: "Feature", properties: p, geometry: { type: "Point", coordinates: [-74.0, 40.7] },
};

describe("mapsQuery and mapsLink", () => {
  const byAddress: { query: FieldRef[] } = { query: [{ key: "address", source: "site" }] };
  test("searches the address by default", () => {
    expect(mapsQuery(byAddress, p, org)).toBe("1 Centre St, New York, NY");
  });
  test("a hand fix from overrides.json wins", () => {
    expect(mapsQuery(byAddress, { ...p, maps_query: "Fixed" }, org)).toBe("Fixed");
  });
  test("`true` means the coordinate", () => {
    expect(mapsQuery(true, p, org)).toBeNull();
    expect(mapsLink({ openInMaps: true }, feature, org))
      .toBe("https://www.google.com/maps/search/?api=1&query=40.7%2C-74");
  });
  test("repeated values are joined once", () => {
    const q: { query: FieldRef[] } =
      { query: [{ key: "address", source: "site" }, { key: "address", source: "site" }] };
    expect(mapsQuery(q, p, org)).toBe("1 Centre St, New York, NY");
  });
  test("`false` turns the link off", () => {
    expect(mapsLink({ openInMaps: false }, feature, org)).toBeNull();
  });
});

describe("card contents", () => {
  const config: Config = {
    actions: [
      { key: "phone", source: "site", label: "Call", as: "tel" },
      { key: "website", source: "site", label: "Website", as: "url" },
      { key: "missing", source: "site", label: "Nothing", as: "url" },
    ],
    card: [
      { key: "dba", source: "site", label: "Program or DBA" },
      { key: "hours", source: "org", label: "Hours" },
      { key: "description", source: "org", label: "About" },
    ],
  };
  test("actions skip empty fields and carry a label and a detail", () => {
    expect(cardActions(config, p, org)).toEqual([
      { key: "phone", label: "Call", as: "tel", value: p.phone,
        href: "tel:2127669200;ext=2224", detail: p.phone, external: false },
      { key: "website", label: "Website", as: "url", value: "example.org",
        href: "https://example.org", detail: "example.org", external: true },
    ]);
  });
  test("fields skip empty values and a dba that only repeats the org name", () => {
    expect(cardFields(config, p, org)).toEqual([
      { key: "hours", label: "Hours", as: undefined, value: "Mon–Fri" },
    ]);
    expect(cardFields(config, { ...p, dba: "Other Name" }, org).map((f) => f.key))
      .toEqual(["dba", "hours"]);
  });
});

describe("parseStructure", () => {
  test("semicolons make a list", () => {
    expect(parseStructure("a; b; c")).toEqual({ kind: "list", items: ["a", "b", "c"] });
  });
  test("a line ending in a colon introduces a list", () => {
    expect(parseStructure("You will:\nx\ny")).toEqual({ kind: "intro-list", intro: "You will:", items: ["x", "y"] });
  });
  test("other lines are paragraphs", () => {
    expect(parseStructure("one\ntwo")).toEqual({ kind: "paragraphs", items: ["one", "two"] });
    expect(parseStructure("Intro:\nonly one")).toEqual({ kind: "paragraphs", items: ["Intro:", "only one"] });
  });
  test("a single line is text", () => {
    expect(parseStructure("  just this  ")).toEqual({ kind: "text", text: "just this" });
    expect(parseStructure("   ")).toEqual({ kind: "text", text: "" });
  });
});

describe("formatDate", () => {
  test("writes the date in the reader's language", () => {
    expect(formatDate("2026-09-15", "en")).toBe("September 15, 2026");
    expect(formatDate("2026-09-15", "es")).toBe("15 de septiembre de 2026");
  });
  test("leaves an unreadable date as given", () => {
    expect(formatDate("September", "en")).toBe("September");
  });
});
