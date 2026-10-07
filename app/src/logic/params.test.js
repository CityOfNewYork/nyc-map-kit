import { describe, expect, test, vi } from "vitest";
import { readSettings, sameOriginUrl } from "./params.js";

const BASE = "https://cityofnewyork.github.io/nyc-map-kit/app/embed.html";
const ORIGIN = "https://cityofnewyork.github.io";

describe("readSettings", () => {
  test("defaults", () => {
    const s = readSettings("", BASE, ORIGIN);
    expect(s.data.href).toBe("https://cityofnewyork.github.io/nyc-map-kit/app/sites.geojson");
    expect(s.orgs.href).toBe("https://cityofnewyork.github.io/nyc-map-kit/app/orgs.json");
    expect(s).toMatchObject({ list: "on", lang: null, title: null, site: null });
  });

  test("reads every parameter", () => {
    const s = readSettings("?list=off&lang=es&title=Henry&site=abc&data=one-site.geojson",
      BASE, ORIGIN);
    expect(s).toMatchObject({ list: "off", lang: "es", title: "Henry", site: "abc" });
    expect(s.data.pathname).toBe("/nyc-map-kit/app/one-site.geojson");
  });

  test("anything but list=off is on", () => {
    expect(readSettings("?list=no", BASE, ORIGIN).list).toBe("on");
  });
});

describe("sameOriginUrl", () => {
  test("refuses data from another origin and falls back", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = sameOriginUrl("https://evil.example/x.geojson", "sites.geojson", BASE, ORIGIN);
    expect(url.href).toBe("https://cityofnewyork.github.io/nyc-map-kit/app/sites.geojson");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
