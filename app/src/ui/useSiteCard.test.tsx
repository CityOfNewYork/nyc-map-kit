// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMap } from "../core/map-core.ts";
import type { MapCore, MapCoreOptions, SelectInfo } from "../core/map-core.ts";
import type { Model, Site, SiteProperties } from "../logic/types.ts";
import { model, site, stubDialog } from "../test/fixtures.ts";
import { SiteDialog } from "./SiteDialog.tsx";
import { useSiteCard } from "./useSiteCard.ts";

// MapLibre needs WebGL, which jsdom lacks: the card's small map is a stub.
vi.mock("../core/map-core.ts", () => ({ createMap: vi.fn() }));

/** a and b share a location; c is elsewhere. */
const sites = [
  site("a", { org: "Alpha" }, [-73.95, 40.75]),
  site("b", { org: "Beta" }, [-73.95, 40.75]),
  site("c", { org: "Gamma" }, [-73.9, 40.8]),
];
const theModel = () => model({ coLocationRadiusM: 35 }, sites);

let mainMap: { select: ReturnType<typeof vi.fn>; announce: ReturnType<typeof vi.fn> };
let miniMap: ReturnType<typeof fakeMiniMap>;

function fakeMiniMap() {
  const container = document.createElement("div");
  const mini = {
    raw: {
      scrollZoom: { disable: vi.fn() },
      getCanvas: () => document.createElement("canvas"),
      getContainer: () => container,
      resize: vi.fn(),
      jumpTo: vi.fn(),
    },
    ready: (fn: () => void) => { fn(); return mini; },
    select: vi.fn(),
    announce: vi.fn(),
    destroy: vi.fn(),
  };
  return mini;
}

/** The parts of an app that wire up a card: a main map that reports each select() to the
 *  card, as map-core does, a list of rows, a heading, and the dialog. */
function Harness({ data, shown }: { data: Model; shown?: Site[] }) {
  const card = useSiteCard({ model: data, style: {} as StyleSpecification, shown });
  const onSelect = useRef(card.onSelect);
  onSelect.current = card.onSelect;
  const [map] = useState(() => ({
    select: vi.fn((id: string | null) => {
      onSelect.current(id ? data.byId.get(id)! : null, { via: "api" });
    }),
    announce: vi.fn(),
  }));
  mainMap = map;
  const { attach } = card;
  useEffect(() => {
    attach(map as unknown as MapCore<SiteProperties>);
    return () => attach(null);
  }, [attach, map]);
  return (
    <>
      <h1 data-card-return tabIndex={-1}>Map</h1>
      <ul id="site-list">
        {data.features.map((f) => (
          <li key={f.properties.id}>
            <button type="button" className="site-button" data-site-id={f.properties.id}
                    onClick={(e) => card.openFromList(e.currentTarget, f)}>
              {f.properties.org}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => { card.selectingFromUrl(); map.select("c"); }}>
        Follow a link to Gamma
      </button>
      {/* What map-core does on a pin click: onSelect with via "map". */}
      {data.features.map((f) => (
        <button key={f.properties.id} type="button"
                onClick={() => onSelect.current(f, { via: "map" })}>
          {`Click ${f.properties.org}'s pin`}
        </button>
      ))}
      <SiteDialog ref={card.dialogElement} miniMapElement={card.miniMapElement}
                  feature={card.feature} group={card.group} model={data}
                  choices={card.choices} onChoose={card.choose}
                  onStep={card.step} onClose={card.close} />
    </>
  );
}

let dialog: ReturnType<typeof stubDialog>;
const siteDialog = () => document.getElementById("site-dialog")!;
const openRow = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const clickPin = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Click ${name}'s pin` }));
/** The rows of the pop-up's list of choices. */
const choiceRows = () => [...siteDialog().querySelectorAll<HTMLElement>(".site-button")];
const miniMapOptions = () =>
  vi.mocked(createMap).mock.calls[0][1] as unknown as MapCoreOptions<SiteProperties>;

beforeEach(() => {
  dialog = stubDialog();
  miniMap = fakeMiniMap();
  vi.mocked(createMap).mockReturnValue(miniMap as unknown as ReturnType<typeof createMap>);
  history.replaceState(null, "", "/app/");
  window.dataLayer = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.mocked(createMap).mockReset();
  vi.restoreAllMocks();
});

describe("useSiteCard", () => {
  test("a row opens its card as a modal, with an address of its own, focused on its name", () => {
    render(<Harness data={theModel()} />);
    const length = history.length;
    openRow("Gamma");
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(siteDialog()).toHaveAttribute("open");
    expect(location.search).toBe("?site=c");
    expect(history.length).toBe(length + 1);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Gamma");
    expect(screen.getByRole("heading", { level: 2 })).toHaveFocus();
    expect(window.dataLayer).toEqual([
      { event: "map_pin_open", org_id: "c", site_id: "c", via: "list" },
    ]);
  });

  test("closing goes back through history, and focus returns to the row", async () => {
    render(<Harness data={theModel()} />);
    openRow("Gamma");
    fireEvent.click(screen.getByRole("button", { name: "Close card" }));
    await waitFor(() => expect(siteDialog()).not.toHaveAttribute("open"));
    expect(location.search).toBe("");
    expect(history.state).toBeNull();   // back on the entry before the card's, not on it
    expect(mainMap.select).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: "Gamma" })).toHaveFocus();
  });

  test("Back and Escape close the card too", async () => {
    render(<Harness data={theModel()} />);
    openRow("Gamma");
    act(() => history.back());
    await waitFor(() => expect(siteDialog()).not.toHaveAttribute("open"));
    openRow("Gamma");
    fireEvent(siteDialog(), new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(siteDialog()).not.toHaveAttribute("open"));
    expect(location.search).toBe("");
  });

  test("a card a link opened adds no history, and closing it takes ?site= out", async () => {
    render(<Harness data={theModel()} />);
    history.replaceState(null, "", "/app/?site=c");
    const length = history.length;
    fireEvent.click(screen.getByRole("button", { name: "Follow a link to Gamma" }));
    expect(siteDialog()).toHaveAttribute("open");
    expect(history.length).toBe(length);
    fireEvent.click(screen.getByRole("button", { name: "Close card" }));
    expect(siteDialog()).not.toHaveAttribute("open");
    expect(location.search).toBe("");
    expect(history.length).toBe(length);
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  test("steps between the records at one location, in place, wrapping round", () => {
    render(<Harness data={theModel()} />);
    openRow("Alpha");
    const length = history.length;
    expect(screen.getByText("1 of 2 at this location")).toBeInTheDocument();
    expect(siteDialog()).toHaveAttribute("aria-describedby", "step-count");
    const next = screen.getByRole("button", { name: "Next site at this location" });
    expect(next).toHaveFocus();
    fireEvent.click(next);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Beta");
    expect(screen.getByText("2 of 2 at this location")).toBeInTheDocument();
    expect(location.search).toBe("?site=b");
    expect(history.length).toBe(length);
    expect(next).toHaveFocus();
    expect(miniMap.announce).toHaveBeenCalledWith("Selected: Beta, b Main Street");
    fireEvent.click(next);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Alpha");
  });

  test("a pin that holds several sites opens on a list of them, with no address of its own", () => {
    render(<Harness data={theModel()} />);
    const length = history.length;
    clickPin("Alpha");
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("2 sites");
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute("id", siteDialog().getAttribute("aria-labelledby"));
    expect(choiceRows().map((r) => r.dataset.siteId)).toEqual(["a", "b"]);
    expect(document.getElementById("stepper")).toHaveAttribute("hidden");
    expect(document.getElementById("mini-map")).toHaveAttribute("hidden");
    expect(location.search).toBe("");
    expect(history.length).toBe(length + 1);
    expect(window.dataLayer).toEqual([{ event: "map_pin_choices", count: 2 }]);
  });

  test("picking one opens its card in place, with the stepper, focused on its name", () => {
    render(<Harness data={theModel()} />);
    clickPin("Alpha");
    const length = history.length;
    fireEvent.click(choiceRows()[1]);
    expect(mainMap.select).toHaveBeenLastCalledWith("b");
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Beta");
    expect(heading).toHaveFocus();
    expect(screen.getByText("2 of 2 at this location")).toBeInTheDocument();
    expect(choiceRows()).toEqual([]);
    expect(document.getElementById("mini-map")).not.toHaveAttribute("hidden");
    expect(location.search).toBe("?site=b");
    expect(history.length).toBe(length);
    expect(window.dataLayer?.at(-1)).toEqual(
      { event: "map_pin_open", org_id: "b", site_id: "b", via: "chooser" });
  });

  test("Back and Escape close the list, as they close a card picked from it", async () => {
    render(<Harness data={theModel()} />);
    clickPin("Alpha");
    act(() => history.back());
    await waitFor(() => expect(siteDialog()).not.toHaveAttribute("open"));
    expect(mainMap.select).toHaveBeenLastCalledWith(null);
    clickPin("Alpha");
    fireEvent(siteDialog(), new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(siteDialog()).not.toHaveAttribute("open"));
    clickPin("Alpha");
    fireEvent.click(choiceRows()[0]);
    act(() => history.back());
    await waitFor(() => expect(siteDialog()).not.toHaveAttribute("open"));
    expect(location.search).toBe("");
    expect(history.state).toBeNull();
  });

  test("the list of choices and the stepper leave out what the filters hide", () => {
    render(<Harness data={theModel()} shown={[sites[0], sites[2]]} />);
    clickPin("Alpha");
    expect(choiceRows()).toEqual([]);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Alpha");
    expect(document.getElementById("stepper")).toHaveAttribute("hidden");
    expect(location.search).toBe("?site=a");
  });

  test("a pin with one site, and a row in the list, open the card directly", async () => {
    render(<Harness data={theModel()} />);
    clickPin("Gamma");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Gamma");
    expect(location.search).toBe("?site=c");
    fireEvent.click(screen.getByRole("button", { name: "Close card" }));
    await waitFor(() => expect(siteDialog()).not.toHaveAttribute("open"));
    openRow("Alpha");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Alpha");
    expect(choiceRows()).toEqual([]);
  });

  test("draws the place on the card's own small map, made once", () => {
    render(<Harness data={theModel()} />);
    openRow("Alpha");
    expect(createMap).toHaveBeenCalledTimes(1);
    const options = miniMapOptions();
    expect(options.zoomButtons).toBe(false);
    expect(miniMap.raw.scrollZoom.disable).toHaveBeenCalled();
    expect(miniMap.raw.jumpTo).toHaveBeenLastCalledWith({ center: [-73.95, 40.75], zoom: 15.5 });
    expect(miniMap.select).toHaveBeenLastCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "Close card" }));
    openRow("Gamma");
    expect(createMap).toHaveBeenCalledTimes(1);
    expect(miniMap.raw.jumpTo).toHaveBeenLastCalledWith({ center: [-73.9, 40.8], zoom: 15.5 });
  });

  test("a pin on the small map opens that site's card", () => {
    render(<Harness data={theModel()} />);
    openRow("Alpha");
    const options = miniMapOptions();
    const pick = (f: Site, info: SelectInfo) => act(() => options.onSelect!(f, info));
    pick(sites[2], { via: "map" });
    expect(mainMap.select).toHaveBeenLastCalledWith("c");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Gamma");
    expect(window.dataLayer?.at(-1)).toEqual(
      { event: "map_pin_open", org_id: "c", site_id: "c", via: "mini_map" });
  });
});
