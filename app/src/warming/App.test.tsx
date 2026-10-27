// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import places from "../../public/places.json";
import { createMap } from "../core/map-core.ts";
import type { SiteCollection } from "../logic/types.ts";
import { site, stubDialog, stubScreen } from "../test/fixtures.ts";
import App from "./App.tsx";
import type { WarmingMap } from "./components/WarmingMap.tsx";

// The search box without a Geoclient key, whatever a developer's .env.local holds.
vi.hoisted(() => vi.stubEnv("VITE_GEOCLIENT_KEY", ""));

// MapLibre needs WebGL, which jsdom lacks. WarmingMap is a stub that hands App a fake map
// once it has data, as the real one does once the basemap loads; the card's small map is
// a stub too.
const stub = vi.hoisted(() => ({
  props: null as ComponentProps<typeof WarmingMap> | null,
  map: null as unknown as {
    select: (id: string | null) => void; showPlace: (...args: unknown[]) => void;
    announce: () => void;
  },
}));
vi.mock("./components/WarmingMap.tsx", async () => {
  const { useEffect } = await import("react");
  return {
    WarmingMap(props: ComponentProps<typeof WarmingMap>) {
      stub.props = props;
      useEffect(() => {
        if (props.data) props.onReady?.(stub.map as never, {} as never);
      }, [props.data]);
      return <div className="map" id="map" />;
    },
  };
});
vi.mock("../core/map-core.ts", () => ({ createMap: vi.fn() }));

const centers: SiteCollection = {
  type: "FeatureCollection",
  features: [
    site("jacobi", { org: "Jacobi", borough: "Bronx", type: "hospital", opens: "00:00", closes: "24:00" },
      [-73.85, 40.86]),
    site("lincoln-bus", { org: "Lincoln Warming Bus", borough: "Bronx", type: "bus",
      opens: "22:00", closes: "05:00" }, [-73.92, 40.82]),
  ],
};

/** Serve the sample centers at each ?dataset= file, and places.json for the search box. */
function serve(ok = true) {
  const fetch = vi.fn(async (url: string) => (url === "places.json"
    ? { ok: true, json: async () => places }
    : { ok, status: ok ? 200 : 404, json: async () => centers }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const rows = () => within(document.getElementById("site-list")!).getAllByRole("button");
const landing = () => screen.queryByRole("heading", { name: "Find a warming center near you" });
const mapHeading = () => screen.queryByRole("heading", { name: "Map of warming centers" });

function renderApp(url = "/warming.html") {
  history.replaceState(null, "", url);
  return render(<App lang="en" basemap="protomaps" />);
}

beforeEach(() => {
  stub.props = null;
  stub.map = {
    select: vi.fn((id: string | null) => {
      const feature = centers.features.find((f) => f.properties.id === id) ?? null;
      stub.props?.onSelect?.(feature, { via: "api" });
    }),
    showPlace: vi.fn(),
    announce: vi.fn(),
  };
  const mini = {
    raw: { scrollZoom: { disable() {} }, getCanvas: () => document.createElement("canvas"),
      getContainer: () => document.createElement("div"), resize() {}, jumpTo() {} },
    ready: (fn: () => void) => { fn(); return mini; }, select() {}, announce() {}, destroy() {},
  };
  vi.mocked(createMap).mockReturnValue(mini as unknown as ReturnType<typeof createMap>);
  stubScreen(true, true);   // a desktop, and reduced motion: the hero goes at once
  stubDialog();
  serve();
  window.dataLayer = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("warming App", () => {
  describe("views", () => {
    test("renders the landing view when the URL has no view parameter", () => {
      renderApp();
      expect(landing()).toBeInTheDocument();
      expect(mapHeading()).toBeNull();
    });

    test("renders the map view when the URL has ?view=map", async () => {
      renderApp("/warming.html?view=map");
      expect(mapHeading()).toBeInTheDocument();
      await waitFor(() => expect(rows()).toHaveLength(2));
    });

    test("each view's one <h1> is its own heading, inside <main>, not the site's name", () => {
      renderApp();
      const main = screen.getByRole("main");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Find a warming center near you");
      expect(main).toContainElement(screen.getByRole("heading", { level: 1 }));
      expect(screen.getByRole("banner")).toHaveTextContent("Warming Centers");
      cleanup();
      renderApp("/warming.html?view=map");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Map of warming centers");
      expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { level: 1 }));
    });

    test("See full map switches to the map view, adds ?view=map, and moves focus there", () => {
      renderApp();
      fireEvent.click(screen.getByRole("button", { name: /See full map/ }));
      expect(mapHeading()).toHaveFocus();
      expect(location.search).toBe("?view=map");
    });

    test("without reduced motion the hero folds away first", async () => {
      stubScreen(true, false);
      renderApp();
      fireEvent.click(screen.getByRole("button", { name: /See full map/ }));
      expect(landing()).toBeInTheDocument();
      await waitFor(() => expect(mapHeading()).toBeInTheDocument());
    });

    test("browser Back from the map view returns to the landing view", async () => {
      renderApp();
      fireEvent.click(screen.getByRole("button", { name: /See full map/ }));
      act(() => history.back());
      await waitFor(() => expect(landing()).toBeInTheDocument());
    });

    test("touching a pin on the landing view opens no card", async () => {
      renderApp();
      await waitFor(() => expect(stub.props?.data).toBeTruthy());
      act(() => stub.props!.onSelect!(centers.features[0], { via: "map" }));
      await waitFor(() => expect(stub.map.select).toHaveBeenCalledWith(null));
      expect(document.getElementById("site-dialog")).not.toHaveAttribute("open");
    });
  });

  describe("search", () => {
    test("a search from the landing view opens the map view with that place marked", async () => {
      renderApp();
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "Bronx" } });
      fireEvent.submit(input.closest("form")!);
      await waitFor(() => expect(mapHeading()).toHaveFocus());
      expect(stub.map.showPlace).toHaveBeenLastCalledWith(
        expect.objectContaining({ center: expect.any(Array) }), expect.any(Array));
    });
  });

  describe("data", () => {
    test("loads the sample centers ?dataset= names once, and gives them to the map", async () => {
      const fetch = serve();
      renderApp("/warming.html?dataset=1500");
      await waitFor(() => expect(stub.props?.data).toEqual(centers));
      expect(fetch.mock.calls.filter(([url]) => url !== "places.json"))
        .toEqual([["warming/sample-centers-1500.geojson"]]);
    });

    test("shows an error message when the data fails to load", async () => {
      serve(false);
      vi.spyOn(console, "error").mockImplementation(() => {});
      renderApp();
      expect(await screen.findByText("The warming center data could not load.")).toBeInTheDocument();
    });

    test("?site= opens that center's card once the map is ready", async () => {
      renderApp("/warming.html?site=lincoln-bus");
      await waitFor(() => expect(document.getElementById("site-dialog")).toHaveAttribute("open"));
      expect(screen.getByRole("heading", { level: 2, name: "Lincoln Warming Bus" })).toBeInTheDocument();
      expect(mapHeading()).toBeInTheDocument();
    });

    test("filters in the address filter the list and the map", async () => {
      renderApp("/warming.html?view=map&type=bus");
      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(stub.props?.shown?.map((f) => f.properties.id)).toEqual(["lincoln-bus"]);
      fireEvent.click(screen.getByRole("button", { name: "Pets allowed" }));
      expect(location.search).toBe("?view=map&type=bus&pets=1");
    });
  });
});
