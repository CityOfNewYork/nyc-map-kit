// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import places from "../../public/places.json";
import { createMap } from "../core/map-core.ts";
import type { MapCoreOptions } from "../core/map-core.ts";
import { readSettings } from "../logic/params.ts";
import type { Settings } from "../logic/params.ts";
import type { Config, SiteProperties } from "../logic/types.ts";
import { pushed, site, stubDialog, stubScreen } from "../test/fixtures.ts";
import App from "./App.tsx";

// MapLibre needs WebGL, which jsdom lacks: each map is a stub that reports select() to
// onSelect, as map-core does, and the basemap is an empty style.
vi.mock("../core/map-core.ts", () => ({ createMap: vi.fn() }));
vi.mock("../core/basemaps/index.ts", () => ({ loadBasemap: vi.fn(async () => ({})) }));

const sites = [
  site("a", { org: "Alpha", org_id: "o1", org_type: "Nonprofit", borough: "Bronx" }, [-73.9, 40.85]),
  site("b", { org: "Alpha", org_id: "o1", org_type: "Nonprofit", borough: "Bronx" }, [-73.9, 40.82]),
  site("c", { org: "Gamma", org_id: "o2", org_type: "Library", borough: "Bronx" }, [-73.9, 40.88]),
];
const config: Config = { title: "Volunteer opportunities", coLocationRadiusM: 35 };

/** A map-core map: what it was made with, and the calls the app makes on it. */
function fakeMap(options: MapCoreOptions<SiteProperties>) {
  const map = {
    options,
    raw: {
      isMoving: () => false, once: vi.fn(), off: vi.fn(), easeTo: vi.fn(),
      setPadding: vi.fn(), getPadding: () => ({ left: 0 }),
      scrollZoom: { disable: vi.fn() }, resize: vi.fn(), jumpTo: vi.fn(), getMaxZoom: () => 18,
      getCanvas: () => document.createElement("canvas"),
      getContainer: () => document.createElement("div"),
    },
    select: vi.fn((id: string | null) => {
      const feature = options.data?.features.find((f) => f.properties.id === id) ?? null;
      options.onSelect?.(feature, { via: "api" });
      return map;
    }),
    setData: vi.fn(), showPlace: vi.fn(), announce: vi.fn(), destroy: vi.fn(),
    ready: (fn: () => void) => { fn(); return map; },
  };
  return map;
}
let maps: ReturnType<typeof fakeMap>[];
const mainMap = () => maps[0];

/** Serve config.json, the sites, orgs.json and places.json; `files` replaces any of them. */
function serve(files: Record<string, unknown> = {}) {
  const served: Record<string, unknown> = {
    "config.json": config,
    "sites.geojson": { type: "FeatureCollection", generated: "2026-09-15", features: sites },
    "orgs.json": null,
    "places.json": places,
    ...files,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const name = String(url).split("/").pop()!;
    const body = served[name];
    return { ok: body !== undefined && body !== null, json: async () => body };
  }));
}

function settings(search = ""): Settings {
  return { ...readSettings(search, "http://localhost/app/", "http://localhost"), lang: "en" };
}
async function renderApp(search = "") {
  render(<App settings={settings(search)} />);
  await waitFor(() => expect(createMap).toHaveBeenCalled());
}
const rows = () => within(document.getElementById("site-list")!).queryAllByRole("button");

beforeEach(() => {
  maps = [];
  vi.mocked(createMap).mockImplementation((_el, options) => {
    const map = fakeMap(options as unknown as MapCoreOptions<SiteProperties>);
    maps.push(map);
    return map as unknown as ReturnType<typeof createMap>;
  });
  stubScreen(true);
  stubDialog();
  serve();
  history.replaceState(null, "", "/app/");
  window.dataLayer = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(createMap).mockReset();
  vi.restoreAllMocks();
});

describe("App", () => {
  test("the h1 opens <main>, which holds the search, the list and the map", async () => {
    await renderApp();
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByRole("heading", { level: 1 }));
    expect(main).toContainElement(screen.getByRole("search"));
    expect(main).toContainElement(document.getElementById("site-list"));
    expect(main).toContainElement(document.getElementById("map"));
    expect(screen.queryByRole("banner")).toBeNull();
  });

  test("the search landmark holds the search box and the Filters button", async () => {
    await renderApp();
    const search = screen.getByRole("search");
    expect(within(search).getByRole("combobox")).toBeInTheDocument();
    expect(within(search).getByRole("button", { name: /^Filters/ })).toBeInTheDocument();
  });

  test("loads its files, names the map, and lists every site with the counts", async () => {
    await renderApp();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Volunteer opportunities");
    expect(document.title).toBe("Volunteer opportunities");
    expect(rows().map((r) => r.dataset.siteId)).toEqual(["c", "a", "b"]);
    expect(screen.getByText("2 organizations")).toBeInTheDocument();
    expect(screen.getByText("3 sites")).toBeInTheDocument();
    expect(mainMap().options.data?.features).toHaveLength(3);
  });

  test("a config's own count replaces the organization and site counts", async () => {
    serve({ "config.json": { count: { one: "{n} center", other: "{n} centers" } } });
    await renderApp();
    expect(screen.getByText("3 centers")).toBeInTheDocument();
    expect(screen.queryByText("2 organizations")).toBeNull();
  });

  test("a pin that holds two sites lists them under the map's own count, then opens one", async () => {
    const pair = [...sites, site("d", { org: "Delta", org_id: "o3", org_type: "Library",
      borough: "Bronx" }, [-73.9, 40.88])];
    serve({
      "config.json": { ...config, count: { one: "{n} center", other: "{n} centers" } },
      "sites.geojson": { type: "FeatureCollection", features: pair },
    });
    await renderApp();
    await waitFor(() => expect(rows()).toHaveLength(4));
    act(() => mainMap().options.onSelect!(pair[2], { via: "map" }));
    const dialog = document.getElementById("site-dialog")!;
    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent("2 centers");
    const choices = [...dialog.querySelectorAll<HTMLElement>(".site-button")];
    expect(choices.map((b) => b.dataset.siteId)).toEqual(["c", "d"]);
    fireEvent.click(choices[1]);
    expect(mainMap().select).toHaveBeenLastCalledWith("d");
    expect(within(dialog).getByRole("heading", { level: 2, name: "Delta" })).toBeInTheDocument();
  });

  test("a row opens its site's card through the map", async () => {
    await renderApp();
    fireEvent.click(rows()[0]);
    expect(mainMap().select).toHaveBeenCalledWith("c");
    expect(screen.getByRole("heading", { level: 2, name: "Gamma" })).toBeInTheDocument();
    expect(rows()[0]).toHaveAttribute("aria-current", "true");
  });

  test("?site= opens that site's card when the map loads", async () => {
    history.replaceState(null, "", "/app/?site=b");
    await renderApp("?site=b");
    expect(mainMap().select).toHaveBeenCalledWith("b");
    // The card opens once the selection renders, a step after the map is made.
    await waitFor(() => expect(document.getElementById("site-dialog")).toHaveAttribute("open"));
    // Once, with the site's type, from its org_type.
    expect(pushed()).toEqual([{
      event: "card_open", feature_id: "b", feature_name: "Alpha", feature_type: "Nonprofit",
      feature_borough: "Bronx",
    }]);
  });

  test("filters by organization type in the list, on the map and in the address", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Organization type Select option" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Library" }));
    expect(rows().map((r) => r.dataset.siteId)).toEqual(["c"]);
    expect(mainMap().setData).toHaveBeenLastCalledWith({
      type: "FeatureCollection", features: [sites[2]],
    });
    expect(location.search).toBe("?type=Library");
    expect(screen.getByText("1 organization")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 1 location" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rows()).toHaveLength(3);
    expect(location.search).toBe("");
    const typeFilter = { event: "filter_select", filter_name: "type" };
    expect(pushed()).toEqual([
      { ...typeFilter, filter_value: "Library", active_filter_count: 1 },
      { ...typeFilter, filter_value: "", active_filter_count: 0 },
    ]);
  });

  test("a type in the address filters from the start", async () => {
    history.replaceState(null, "", "/app/?type=Nonprofit");
    await renderApp("?type=Nonprofit");
    expect(rows().map((r) => r.dataset.siteId)).toEqual(["a", "b"]);
  });

  test("a search marks the place on the map with the sites nearest it", async () => {
    await renderApp();
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Bronx" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(mainMap().showPlace).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: expect.any(Array) }), expect.any(Array)));
    expect(screen.getAllByText("Closest to").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(mainMap().showPlace).toHaveBeenLastCalledWith(null);
  });

  test("says so when the data cannot load", async () => {
    serve({ "sites.geojson": null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<App settings={settings()} />);
    expect(await screen.findByText("The map could not load its data.")).toBeInTheDocument();
    expect(createMap).not.toHaveBeenCalled();
  });

  test("removes the map when it goes", async () => {
    await renderApp();
    const map = mainMap();
    act(() => cleanup());
    expect(map.destroy).toHaveBeenCalled();
  });
});
