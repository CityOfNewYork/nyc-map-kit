// @vitest-environment jsdom

import { expect, test, vi } from "vitest";
import { createMap } from "./map-core.ts";

// MapLibre draws with WebGL, which jsdom does not have. The stand-in records what the core
// asks of it: the options the map is made with, and the handlers it turns off.
const made = vi.hoisted(() => ({
  options: {} as Record<string, unknown>,
  touchRotationOff: false,
  keyboardRotationOff: false,
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
    on() {}
    getCanvas() { return document.createElement("canvas"); }
  },
}));

test("the map stays north-up and flat: no gesture or key turns or tilts it", () => {
  createMap(document.createElement("div"), {});
  expect(made.options).toMatchObject({ dragRotate: false, touchPitch: false });
  expect(made.touchRotationOff).toBe(true);
  expect(made.keyboardRotationOff).toBe(true);
});
