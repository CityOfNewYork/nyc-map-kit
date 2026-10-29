// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import places from "../../public/places.json";
import { createMap } from "../core/map-core.ts";
import type { SiteCollection } from "../logic/types.ts";
import { site, stubDialog, stubScreen } from "../test/fixtures.ts";
import App from "./App.tsx";
import type { EventMap } from "./components/EventMap.tsx";

// The search box without a Geoclient key, whatever a developer's .env.local holds.
vi.hoisted(() => vi.stubEnv("VITE_GEOCLIENT_KEY", ""));

// MapLibre needs WebGL, which jsdom lacks. EventMap is a stub that hands App a fake map
// once it has data, as the real one does once the basemap loads; the card's small map is
// a stub too.
const stub = vi.hoisted(() => ({
  props: null as ComponentProps<typeof EventMap> | null,
  map: null as unknown as {
    select: (id: string | null) => void; showPlace: (...args: unknown[]) => void;
    announce: () => void;
  },
}));
vi.mock("./components/EventMap.tsx", async () => {
  const { useEffect } = await import("react");
  return {
    EventMap(props: ComponentProps<typeof EventMap>) {
      stub.props = props;
      useEffect(() => {
        if (props.data) props.onReady?.(stub.map as never, {} as never);
      }, [props.data]);
      return <div className="map" id="map" />;
    },
  };
});
vi.mock("../core/map-core.ts", () => ({ createMap: vi.fn() }));

// In file order, by day: one over, one on now, one later today, at 5 PM on Halloween.
const events: SiteCollection = {
  type: "FeatureCollection",
  features: [
    site("castleton-10-03", { org: "Castleton Avenue", type: "partner", date: "2026-10-03",
      starts: "16:00", ends: "20:00", host: "Staten Island Business Outreach Center" }, [-74.12, 40.63]),
    site("hillel-plaza-10-31", { org: "Hillel Plaza", type: "signature", date: "2026-10-31",
      starts: "14:00", ends: "18:00", host: "Flatbush Junction BID" }, [-73.95, 40.63]),
    site("village-parade-10-31", { org: "Village Halloween Parade", type: "partner",
      date: "2026-10-31", starts: "19:00", ends: "23:30", host: "Village Halloween Parade, Inc." },
      [-74.0, 40.73]),
  ],
};
const HALLOWEEN_5PM = new Date("2026-10-31T21:00:00Z");

function serve(ok = true) {
  const fetch = vi.fn(async (url: string) => (url === "places.json"
    ? { ok: true, json: async () => places }
    : { ok, status: ok ? 200 : 404, json: async () => events }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const rows = () => within(document.getElementById("site-list")!).getAllByRole("button");
const rowIds = () => rows().map((b) => b.dataset.siteId);

function renderApp(url = "/trick-or-streets.html") {
  history.replaceState(null, "", url);
  return render(<App lang="en" basemap="protomaps" />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(HALLOWEEN_5PM);
  stub.props = null;
  stub.map = {
    select: vi.fn((id: string | null) => {
      const feature = events.features.find((f) => f.properties.id === id) ?? null;
      stub.props?.onSelect?.(feature, { via: "api" });
    }),
    showPlace: vi.fn(),
    announce: vi.fn(),
  };
  const mini = {
    raw: { scrollZoom: { disable() {} }, getCanvas: () => document.createElement("canvas"),
      getContainer: () => document.createElement("div"), resize() {}, jumpTo() {},
      getMaxZoom: () => 18 },
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Trick-or-Streets App", () => {
  test("the landing view's heading, under the site's name", () => {
    renderApp();
    expect(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Find Trick-or-Streets events near you");
    expect(screen.getByRole("banner")).toHaveTextContent("Trick-or-Streets");
  });

  test("the map view lists the events in date order, with those that are over at the end", async () => {
    renderApp("/trick-or-streets.html?view=map");
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rowIds()).toEqual(["hillel-plaza-10-31", "village-parade-10-31", "castleton-10-03"]);
    expect(rows()[0]).toHaveTextContent("Happening now");
    expect(rows()[1]).toHaveTextContent("Today");
    expect(rows()[2]).toHaveTextContent("Ended");
    expect(screen.getByText("Events are subject to delay or cancellation.")).toBeInTheDocument();
  });

  test("filters in the address filter the list and the map, and Happening now adds one", async () => {
    renderApp("/trick-or-streets.html?view=map&type=partner");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(stub.props?.shown?.map((f) => f.properties.id))
      .toEqual(["village-parade-10-31", "castleton-10-03"]);
    fireEvent.click(screen.getByRole("button", { name: "Happening now" }));
    expect(location.search).toBe("?view=map&type=partner&now=1");
    // At 5 PM the parade is still to come, so no partner event is on.
    await waitFor(() => expect(stub.props?.shown).toEqual([]));
    expect(screen.getAllByText("Showing 0 of 3 events").length).toBeGreaterThan(0);
  });

  test("?site= opens that event's card: its kind, where it stands, its day and its host", async () => {
    renderApp("/trick-or-streets.html?site=hillel-plaza-10-31");
    await waitFor(() => expect(document.getElementById("site-dialog")).toHaveAttribute("open"));
    const dialog = document.getElementById("site-dialog")!;
    expect(within(dialog).getByRole("heading", { level: 2, name: "Hillel Plaza" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Signature event");
    expect(dialog).toHaveTextContent("Happening now");
    expect(dialog).toHaveTextContent("Saturday, October 31");
    expect(dialog).toHaveTextContent("Flatbush Junction BID");
  });

  test("touching a pin on the landing view opens no card", async () => {
    renderApp();
    // Once App has the map: onMapReady clears the searched-for place first thing.
    await waitFor(() => expect(stub.map.showPlace).toHaveBeenCalled());
    act(() => stub.props!.onSelect!(events.features[1], { via: "map" }));
    await waitFor(() => expect(stub.map.select).toHaveBeenCalledWith(null));
    expect(document.getElementById("site-dialog")).not.toHaveAttribute("open");
  });

  test("shows an error message when the data fails to load", async () => {
    serve(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp();
    expect(await screen.findByText("The event data could not load.")).toBeInTheDocument();
  });
});
