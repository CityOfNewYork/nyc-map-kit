import { describe, expect, test, vi } from "vitest";
import { editDistance, geocode, parseGeoclient, streetName } from "./geocode.ts";
import fixtures from "./geoclient.fixtures.json" with { type: "json" };

// Real /search responses, trimmed to the fields geocode.ts reads.
const response = (input: keyof typeof fixtures) =>
  fixtures[input] as Parameters<typeof parseGeoclient>[0];

describe("parseGeoclient", () => {
  test("an address in three boroughs is three choices, in Geoclient's order", () => {
    const result = parseGeoclient(response("120 broadway"));
    expect(result.type).toBe("found");
    if (result.type !== "found") return;
    expect(result.matches.map((m) => m.borough)).toEqual(["Manhattan", "Brooklyn", "Staten Island"]);
    expect(result.matches[0]).toMatchObject({
      kind: "address", name: "120 Broadway", cross: null, bbox: null,
      center: [-74.011041, 40.708546],
    });
  });

  test("a match whose house number Geoclient altered gives way to a clean one", () => {
    const result = parseGeoclient(response("37-11 74th st"));
    expect(result).toMatchObject({
      type: "found", matches: [{ name: "37-11 74th Street", borough: "Queens" }],
    });
  });

  test("an intersection names both streets", () => {
    const result = parseGeoclient(response("broadway and w 100 st"));
    expect(result).toMatchObject({
      type: "found",
      matches: [{ kind: "intersection", name: "Broadway", cross: "West 100th Street", borough: "Manhattan" }],
    });
  });

  test("a misspelled street suggests the close spelling, not every similar name", () => {
    expect(parseGeoclient(response("851 grand concurse"))).toEqual({
      type: "suggest",
      suggestions: [{
        house: "851", street: "Grand Concourse", borough: "Bronx",
        query: "851 Grand Concourse, Bronx",
      }],
    });
  });

  test("a named place is found, under its full name", () => {
    expect(parseGeoclient(response("yankee stadium"))).toMatchObject({
      type: "found",
      matches: [{ kind: "landmark", name: "Yankee Stadium", borough: "Bronx", bbox: null,
                  center: [-73.926505, 40.829646] }],
    });
    expect(parseGeoclient(response("jfk airport"))).toMatchObject({
      type: "found", matches: [{ name: "John F Kennedy Airport", borough: "Queens" }],
    });
  });

  test("a place name in two boroughs is two choices; one without coordinates is dropped", () => {
    const msg = parseGeoclient(response("madison square garden"));
    expect(msg.type === "found" && msg.matches.map((m) => m.borough)).toEqual(["Manhattan", "Brooklyn"]);
    expect(parseGeoclient(response("pier 17"))).toMatchObject({
      type: "found", matches: [{ name: "Pier 17", borough: "Manhattan" }],
    });
    const pier = parseGeoclient(response("pier 17"));
    expect(pier.type === "found" && pier.matches.length).toBe(1);
  });

  test("a neighborhood or an address outside the city is nothing", () => {
    expect(parseGeoclient(response("harlem"))).toEqual({ type: "none" });
    expect(parseGeoclient(response("1 main st springfield"))).toEqual({ type: "none" });
    expect(parseGeoclient({})).toEqual({ type: "none" });
  });
});

describe("geocode", () => {
  test("sends the key in a header, not the URL", async () => {
    const fetchFn = vi.fn(async () => Response.json(response("harlem")));
    await geocode("harlem", "KEY", undefined, fetchFn as typeof fetch);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("input")).toBe("harlem");
    expect(url.toString()).not.toContain("KEY");
    expect(init.headers).toEqual({ "Ocp-Apim-Subscription-Key": "KEY" });
  });

  test("an HTTP error throws", async () => {
    const fetchFn = async () => new Response("", { status: 401 });
    await expect(geocode("x", "KEY", undefined, fetchFn as typeof fetch)).rejects.toThrow("401");
  });

  test("the caller can abort", async () => {
    const controller = new AbortController();
    const fetchFn = (_: unknown, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("", "AbortError")));
    });
    const pending = geocode("x", "KEY", controller.signal, fetchFn as typeof fetch);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe("streetName", () => {
  test("title case, single spaces, ordinals on numbered streets", () => {
    expect(streetName("WEST  100 STREET")).toBe("West 100th Street");
    expect(streetName("1 AVENUE")).toBe("1st Avenue");
    expect(streetName("EAST 112 STREET")).toBe("East 112th Street");
    expect(streetName("BEACH 23 STREET")).toBe("Beach 23rd Street");
  });
});

test("editDistance", () => {
  expect(editDistance("grandconcurse", "grandconcourse")).toBe(1);
  expect(editDistance("", "abc")).toBe(3);
});
