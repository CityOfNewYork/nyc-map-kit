// @vitest-environment jsdom

import { expect, test, vi } from "vitest";
import { centredOn, createMap, pinFor, pinZoom } from "./map-core.ts";

// MapLibre draws with WebGL, which jsdom does not have. The stand-in records what the core
// asks of it: the options the map is made with, and the handlers it turns off.
const made = vi.hoisted(() => ({
  options: {} as Record<string, unknown>,
  touchRotationOff: false,
  keyboardRotationOff: false,
  handlers: {} as Record<string, () => void>,
  images: [] as unknown[][],
}));
// jsdom has no canvas to draw the station icon on.
vi.mock("./station-icon.ts", async (actual) => ({
  ...await actual<typeof import("./station-icon.ts")>(), stationIcon: () => "the icon",
}));

vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(),
  addProtocol: vi.fn(),
  NavigationControl: class {},
  LngLatBounds: class {},
  Map: class {
    touchZoomRotate = { disableRotation: () => { made.touchRotationOff = true; } };
    keyboard = { disableRotation: () => { made.keyboardRotationOff = true; } };
    constructor(options: Record<string, unknown>) { made.options = options; }
    addControl() {}
    on(type: string, handler: () => void) { made.handlers[type] = handler; }
    hasImage() { return false; }
    addImage(...args: unknown[]) { made.images.push(args); }
    getCanvas() { return document.createElement("canvas"); }
  },
}));

test("the map stays north-up and flat: no gesture or key turns or tilts it", () => {
  createMap(document.createElement("div"), {});
  expect(made.options).toMatchObject({ dragRotate: false, touchPitch: false });
  expect(made.touchRotationOff).toBe(true);
  expect(made.keyboardRotationOff).toBe(true);
});

test("the subway stations' icon is added with the style, before any tile is laid out", () => {
  createMap(document.createElement("div"), {});
  made.handlers["style.load"]();
  expect(made.images).toEqual([["subway-station", "the icon", { pixelRatio: 2 }]]);
});

test("a searched place is the middle of its frame, whichever side of it the sites are", () => {
  // Both sites to the north-east: the frame reaches as far to the south-west.
  expect(centredOn([0, 0], [[2, 1], [3, 0]])).toEqual([[-3, -1], [3, 1]]);
  // An area's corners count like sites, so all of the area stays in view.
  expect(centredOn([10, 20], [[9, 19], [14, 21], [11, 23]])).toEqual([[6, 17], [14, 23]]);
});

test("a pin is its category's where it names one listed, and the map's own pin otherwise", () => {
  const pin = { color: "#f74226", glyph: "M0 0Z", fill: true };
  const categories = { field: "type", values: { bus: { color: "#050560" } } };
  expect(pinFor("pin-base", null, pin)).toEqual({ style: pin, state: "base", count: 1 });
  expect(pinFor("pin-selected:bus+2", categories, pin))
    .toEqual({ style: { color: "#050560" }, state: "selected", count: 2 });
  expect(pinFor("pin-dimmed:library", categories, pin))
    .toEqual({ style: pin, state: "dimmed", count: 1 });
  expect(pinFor("subway-station", categories, pin)).toBeNull();
});

test("pins carry 1,000 sites at z10 and twice as many at each zoom level in", () => {
  expect(pinZoom(1000)).toBe(10);
  expect(pinZoom(1001)).toBe(11);
  expect(pinZoom(2000)).toBe(11);
  expect(pinZoom(4000)).toBe(12);
});

test("the switch is a whole zoom level, rounded up", () => {
  expect(pinZoom(486)).toBe(9);      // below a laptop's opening zoom
  expect(pinZoom(1674)).toBe(11);
  expect(pinZoom(12053)).toBe(14);
});

test("a handful of sites are pins at every zoom a phone can show; none draws nothing", () => {
  expect(pinZoom(10)).toBeLessThanOrEqual(4);
  expect(pinZoom(0)).toBe(0);
});
