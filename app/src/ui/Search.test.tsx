// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import places from "../../public/places.json";
import { loadLanguage } from "../logic/i18n.ts";
import type { Found } from "../logic/places.ts";
import { pushed } from "../test/fixtures.ts";

// Search reads the key when it loads: set it first, so the test does not depend on a
// developer's .env.local. Without a key the box finds boroughs, neighborhoods and ZIP
// codes from places.json. Search.geoclient.test.tsx covers the box with a key.
vi.hoisted(() => vi.stubEnv("VITE_GEOCLIENT_KEY", ""));
const { PlaceName, Search } = await import("./Search.tsx");

let fetch: ReturnType<typeof vi.fn>;

function renderSearch() {
  const onFound = vi.fn();
  const onClear = vi.fn();
  render(<Search onFound={onFound} onClear={onClear} />);
  return { onFound, onClear, input: screen.getByRole("combobox") };
}
function search(input: HTMLElement, text: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
}

beforeEach(() => {
  fetch = vi.fn(async () => ({ ok: true, json: async () => places }));
  vi.stubGlobal("fetch", fetch);
  window.dataLayer = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await loadLanguage("en");
});

describe("Search without a Geoclient key", () => {
  test("says what it can find, as the box's name and not again as text", () => {
    const { input } = renderSearch();
    expect(input).toHaveAccessibleName("Neighborhood, borough or ZIP code");
    expect(screen.getByText("Neighborhood, borough or ZIP code").closest("label"))
      .toHaveAttribute("aria-hidden", "true");
  });

  test("finds a neighborhood from places.json, fetched once, and says so", async () => {
    const { onFound, input } = renderSearch();
    search(input, "harlem");
    await waitFor(() => expect(onFound).toHaveBeenCalledTimes(1));
    expect(onFound.mock.calls[0][0]).toMatchObject({ kind: "nbhd", name: "Harlem" });
    expect(screen.getByRole("status")).toHaveTextContent(/^Closest to Harlem/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("places.json");
    expect(pushed()).toEqual([{
      event: "map_search", search_zip: null, search_borough: "Manhattan",
      search_neighborhood: "Harlem",
    }]);
  });

  test("a ZIP code reports the ZIP, and a search that finds nothing reports only that", async () => {
    const { onFound, input } = renderSearch();
    search(input, "120 Broadway");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No match"));
    search(input, "10027");
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    expect(pushed()).toEqual([
      { event: "map_search_no_match" },
      { event: "map_search", search_zip: "10027", search_borough: null, search_neighborhood: null },
    ]);
  });

  test("says when nothing matches, and drops the place it showed before", async () => {
    const { onFound, onClear, input } = renderSearch();
    search(input, "120 Broadway");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No match"));
    expect(onClear).not.toHaveBeenCalled();
    search(input, "10027");
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    search(input, "120 Broadway");
    await waitFor(() => expect(screen.getByRole("status"))
      .toHaveTextContent("No match in New York City. Try a neighborhood, a borough or a ZIP code."));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  test("Clear and Escape empty the box and drop the place", async () => {
    const { onFound, onClear, input } = renderSearch();
    search(input, "Bronx");
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(onClear).toHaveBeenCalledTimes(1);
    search(input, "Bronx");
    await waitFor(() => expect(onFound).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(onClear).toHaveBeenCalledTimes(2);
  });

  test("Use my location finds the reader, or says it could not", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { longitude: -73.95, latitude: 40.8 } } as GeolocationPosition));
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
    const { onFound } = renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(onFound).toHaveBeenCalledWith(expect.objectContaining({
      kind: "location", center: [-73.95, 40.8],
    }));
    expect(window.dataLayer).toEqual([]);   // where the reader is, not a search

    getCurrentPosition.mockImplementation((_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
      fail?.({ code: 1 } as GeolocationPositionError));
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(screen.getByRole("status")).toHaveTextContent("We couldn't get your location.");
  });

  test("names the reader's location in their language", async () => {
    vi.stubGlobal("navigator", { ...navigator, geolocation: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { longitude: -73.95, latitude: 40.8 } } as GeolocationPosition),
    } });
    await loadLanguage("es");
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Usar mi ubicación" }));
    expect(screen.getByRole("status")).toHaveTextContent("Más cercano a su ubicación");
  });
});

describe("PlaceName", () => {
  test("marks a place's own names as given, and translates the words between them", async () => {
    await loadLanguage("es");
    const corner: Found = {
      kind: "intersection", name: "Broadway", cross: "West 34 Street", borough: "Manhattan",
      center: [-73.988, 40.75], bbox: null,
    };
    render(<p><PlaceName place={corner} inline /></p>);
    for (const name of ["Broadway", "West 34 Street", "Manhattan"]) {
      expect(screen.getByText(name)).toHaveAttribute("lang", "en");
      expect(screen.getByText(name)).toHaveAttribute("translate", "no");
    }
    expect(screen.getByText("y")).not.toHaveAttribute("lang");
  });
});
