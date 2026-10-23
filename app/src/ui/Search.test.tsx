// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import places from "../../public/places.json";

// Search reads the key when it loads: set it first, so the test does not depend on a
// developer's .env.local. Without a key the box finds boroughs, neighborhoods and ZIP
// codes from places.json. Search.geoclient.test.tsx covers the box with a key.
vi.hoisted(() => vi.stubEnv("VITE_GEOCLIENT_KEY", ""));
const { Search } = await import("./Search.tsx");

let fetch: ReturnType<typeof vi.fn>;

function renderSearch() {
  const onFound = vi.fn();
  const onClear = vi.fn();
  render(<Search onFound={onFound} onClear={onClear} />);
  return { onFound, onClear, input: screen.getByRole("textbox") };
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Search without a Geoclient key", () => {
  test("says what it can find", () => {
    const { input } = renderSearch();
    expect(input).toHaveAccessibleName("Neighborhood, borough or ZIP code");
  });

  test("finds a neighborhood from places.json, fetched once, and says so", async () => {
    const { onFound, input } = renderSearch();
    search(input, "harlem");
    await waitFor(() => expect(onFound).toHaveBeenCalledTimes(1));
    expect(onFound.mock.calls[0][0]).toMatchObject({ kind: "nbhd", name: "Harlem" });
    expect(screen.getByRole("status")).toHaveTextContent(/^Closest to Harlem/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("places.json");
    expect(window.dataLayer).toEqual([{ event: "map_search", via: "search", result: "nbhd" }]);
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

    getCurrentPosition.mockImplementation((_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
      fail?.({ code: 1 } as GeolocationPositionError));
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(screen.getByRole("status")).toHaveTextContent("We couldn't get your location.");
  });
});
