// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadBasemap } from "../../core/basemaps/index.ts";
import { createMap } from "../../core/map-core.ts";
import type { MapCoreOptions } from "../../core/map-core.ts";
import type { SiteCollection, SiteProperties } from "../../logic/types.ts";
import { site, stubScreen } from "../../test/fixtures.ts";
import { CENTER_MARK } from "../logic/centers.ts";
import { WarmingMap } from "./WarmingMap.tsx";

// MapLibre needs WebGL, which jsdom lacks.
vi.mock("../../core/basemaps/index.ts", () => ({ loadBasemap: vi.fn() }));
vi.mock("../../core/map-core.ts", () => ({ createMap: vi.fn() }));

const STYLE = { version: 8, sources: {}, layers: [] };
const data: SiteCollection = {
  type: "FeatureCollection", features: [site("jacobi", { type: "hospital" }), site("bus", { type: "bus" })],
};

/** A map-core map, and the MapLibre events the reader's input fires on it. */
function fakeMap() {
  const handlers = new Map<string, (e?: unknown) => void>();
  return {
    handlers,
    raw: {
      on: vi.fn((event: string, fn: (e?: unknown) => void) => handlers.set(event, fn)),
      isMoving: () => false, once: vi.fn(), off: vi.fn(), easeTo: vi.fn(),
      setPadding: vi.fn(), getPadding: () => ({ left: 0 }),
    },
    setData: vi.fn(), destroy: vi.fn(),
  };
}
let map: ReturnType<typeof fakeMap>;
const options = () => vi.mocked(createMap).mock.calls[0][1] as unknown as MapCoreOptions<SiteProperties>;

beforeEach(() => {
  map = fakeMap();
  vi.mocked(createMap).mockReturnValue(map as unknown as ReturnType<typeof createMap>);
  vi.mocked(loadBasemap).mockResolvedValue(STYLE as never);
  stubScreen(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(createMap).mockReset();
  vi.mocked(loadBasemap).mockReset();
});

describe("WarmingMap", () => {
  test("waits for data before creating the map", () => {
    render(<WarmingMap lang="en" basemap="protomaps" data={null} />);
    expect(loadBasemap).not.toHaveBeenCalled();
    expect(createMap).not.toHaveBeenCalled();
  });

  test("creates the map with the data once the basemap loads", async () => {
    render(<WarmingMap lang="es" basemap="protomaps" data={data} />);
    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
    expect(loadBasemap).toHaveBeenCalledWith("protomaps", "es");
    expect(options()).toMatchObject({ style: STYLE, data, pin: CENTER_MARK, counts: true });
    expect(options().style).not.toBe(STYLE);   // a copy: MapLibre changes the style it is given
  });

  test("draws only the centers it is told to show", async () => {
    const { rerender } = render(<WarmingMap lang="en" basemap="protomaps" data={data} />);
    await waitFor(() => expect(createMap).toHaveBeenCalled());
    rerender(<WarmingMap lang="en" basemap="protomaps" data={data} shown={[data.features[1]]} />);
    expect(map.setData).toHaveBeenLastCalledWith(
      { type: "FeatureCollection", features: [data.features[1]] });
  });

  test("leaves the camera unpadded: the map is beside the list, not under it", async () => {
    render(<WarmingMap lang="en" basemap="protomaps" data={data} />);
    await waitFor(() => expect(createMap).toHaveBeenCalled());
    expect(map.raw.setPadding).not.toHaveBeenCalled();
  });

  test("calls onReady with the map, and onSelect when a pin is selected", async () => {
    const onReady = vi.fn();
    const onSelect = vi.fn();
    render(<WarmingMap lang="en" basemap="protomaps" data={data} onReady={onReady} onSelect={onSelect} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(map, STYLE));
    options().onSelect!(data.features[0], { via: "map" });
    expect(onSelect).toHaveBeenCalledWith(data.features[0], { via: "map" });
  });

  test("tells of the reader's own clicks, wheel and drags, not the map's own moves", async () => {
    const onInteract = vi.fn();
    render(<WarmingMap lang="en" basemap="protomaps" data={data} onInteract={onInteract} />);
    await waitFor(() => expect(createMap).toHaveBeenCalled());
    map.handlers.get("movestart")!({});
    expect(onInteract).not.toHaveBeenCalled();
    map.handlers.get("movestart")!({ originalEvent: new Event("pointermove") });
    map.handlers.get("click")!();
    map.handlers.get("wheel")!();
    expect(onInteract).toHaveBeenCalledTimes(3);
  });

  test("destroys the map on unmount", async () => {
    const { unmount } = render(<WarmingMap lang="en" basemap="protomaps" data={data} />);
    await waitFor(() => expect(createMap).toHaveBeenCalled());
    unmount();
    expect(map.destroy).toHaveBeenCalled();
  });

  test("shows an error message when the basemap fails to load", async () => {
    vi.mocked(loadBasemap).mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<WarmingMap lang="en" basemap="protomaps" data={data} />);
    expect(await screen.findByText("The map could not load.")).toBeInTheDocument();
    expect(createMap).not.toHaveBeenCalled();
  });
});
