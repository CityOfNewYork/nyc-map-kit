// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import places from "../../../public/places.json";
import type { Found } from "../../logic/places.ts";
import { model, site, stubScreen } from "../../test/fixtures.ts";
import { CENTER_CONFIG } from "../logic/centers.ts";
import { NO_FILTERS } from "../logic/filters.ts";
import { MapPage } from "./MapPage.tsx";

// The search box without a Geoclient key, whatever a developer's .env.local holds.
vi.hoisted(() => vi.stubEnv("VITE_GEOCLIENT_KEY", ""));

const centers = [
  site("jacobi", { org: "Jacobi", address: "1400 Pelham Parkway South, Bronx", borough: "Bronx",
    type: "hospital", opens: "00:00", closes: "24:00" }, [-73.85, 40.86]),
  site("lincoln-bus", { org: "Lincoln Warming Bus", address: "234 East 149th Street, Bronx",
    borough: "Bronx", type: "bus", opens: "22:00", closes: "05:00" }, [-73.92, 40.82]),
  site("living-room", { org: "The Living Room", address: "800 Barretto Street, Bronx",
    borough: "Bronx", type: "dropin", opens: "00:00", closes: "24:00" }, [-73.89, 40.82]),
];
const centersModel = model(CENTER_CONFIG, centers);
const lincoln: Found = {
  kind: "address", name: "234 East 149th Street", cross: null, borough: "Bronx",
  center: [-73.92, 40.818], bbox: null,
};

function renderPage(props: Partial<ComponentProps<typeof MapPage>> = {}) {
  const handlers = { onFilters: vi.fn(), onFound: vi.fn(), onClear: vi.fn(), onOpen: vi.fn() };
  render(<MapPage model={centersModel} shown={centers} filters={NO_FILTERS} found={null}
                  selectedId={null} {...handlers} {...props} />);
  return handlers;
}
const rows = () => within(document.getElementById("site-list")!).getAllByRole("button");

beforeEach(() => {
  stubScreen(true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T17:00:00Z"));   // noon in New York
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => places })));
  window.dataLayer = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MapPage", () => {
  describe("list", () => {
    test("renders the search box and one list row per center", () => {
      renderPage();
      expect(screen.getByRole("search")).toBeInTheDocument();
      expect(rows()).toHaveLength(3);
      const bus = rows().find((r) => r.dataset.siteId === "lincoln-bus")!;
      expect(bus).toHaveTextContent("Lincoln Warming Bus");
      expect(bus).toHaveTextContent("Warming bus");
      expect(bus).toHaveTextContent("Closed");
      expect(bus).toHaveTextContent("234 East 149th Street, Bronx");
    });

    test("shows the count, and how many of how many with filters on", () => {
      renderPage();
      expect(screen.getAllByText("3 locations").length).toBeGreaterThan(0);
      cleanup();
      renderPage({ filters: { ...NO_FILTERS, types: ["bus"] }, shown: [centers[1]] });
      expect(screen.getAllByText("Showing 1 of 3 locations")).toHaveLength(2);
      expect(screen.getByRole("button", { name: /^Filters\s*1 filter on$/ })).toBeInTheDocument();
    });

    test("a screen reader hears what the filters left from outside the list", () => {
      renderPage({ filters: { ...NO_FILTERS, types: ["bus"] }, shown: [centers[1]] });
      expect(screen.getAllByRole("status").map((s) => s.textContent))
        .toContain("Showing 1 of 3 locations");
      // Not in the list, which hides all but its top line while shut.
      expect(within(screen.getByRole("region", { name: "Warming centers" }))
        .queryAllByRole("status").map((s) => s.textContent))
        .not.toContain("Showing 1 of 3 locations");
    });

    test("choosing a row opens that center", () => {
      const { onOpen } = renderPage();
      fireEvent.click(rows()[0]);
      expect(onOpen).toHaveBeenCalledWith(rows()[0], expect.objectContaining({ type: "Feature" }));
    });

    test("the open center's row is marked", () => {
      renderPage({ selectedId: "living-room" });
      expect(rows().find((r) => r.dataset.siteId === "living-room"))
        .toHaveAttribute("aria-current", "true");
    });

    test("with no center left, the list offers to clear the filters", () => {
      const { onFilters } = renderPage({ filters: { ...NO_FILTERS, pets: true }, shown: [] });
      fireEvent.click(within(document.querySelector(".list-empty")!)
        .getByRole("button", { name: "Clear filters" }));
      expect(onFilters).toHaveBeenCalledWith(NO_FILTERS);
    });
  });

  describe("search", () => {
    test("the search landmark holds the search box and the filters", () => {
      renderPage();
      const search = screen.getByRole("search");
      expect(within(search).getByRole("combobox")).toBeInTheDocument();
      expect(within(search).getByRole("button", { name: "Open now" })).toBeInTheDocument();
      expect(within(search).getByRole("button", { name: /^Filters/ })).toBeInTheDocument();
    });

    test("a search is handed to the app", async () => {
      const { onFound } = renderPage();
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "Bronx" } });
      fireEvent.submit(input.closest("form")!);
      await waitFor(() => expect(onFound).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "borough", name: "Bronx" })));
    });

    test("after a search the list is ordered nearest-first, with distances", () => {
      renderPage({ found: lincoln });
      expect(rows().map((r) => r.dataset.siteId)).toEqual(["lincoln-bus", "living-room", "jacobi"]);
      expect(within(rows()[0]).getByText("0.1 mi away")).toBeInTheDocument();
    });
  });

  describe("filters", () => {
    test("a filter on the bar is handed to the app", () => {
      const { onFilters } = renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Open now" }));
      expect(onFilters).toHaveBeenCalledWith({ ...NO_FILTERS, openNow: true });
    });

    test("Share results copies the map view with its filters", async () => {
      history.replaceState(null, "", "/warming.html?open=1");
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
      renderPage({ filters: { ...NO_FILTERS, openNow: true } });
      fireEvent.click(screen.getByRole("button", { name: "Share results" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(
        "http://localhost:3000/warming.html?open=1&view=map"));
    });
  });
});
