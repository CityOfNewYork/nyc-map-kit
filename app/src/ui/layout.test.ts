// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import type { MapCore, PointProperties } from "../core/map-core.ts";
import { stubScreen } from "../test/fixtures.ts";
import { keepClearOfList } from "./layout.ts";

/** The parts of a MapLibre map keepClearOfList uses. */
function fakeMap() {
  const raw = {
    moving: false,
    padding: { left: 0 },
    isMoving: () => raw.moving,
    once: vi.fn(),
    off: vi.fn(),
    getPadding: () => raw.padding,
    setPadding: vi.fn((padding: { left: number }) => { raw.padding = padding; }),
    easeTo: vi.fn(({ padding }: { padding: { left: number } }) => { raw.padding = padding; }),
  };
  return { map: { raw } as unknown as MapCore<PointProperties>, raw };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("keepClearOfList", () => {
  test("pads the map's left edge by the list's width on a desktop", () => {
    stubScreen(true);
    const { map, raw } = fakeMap();
    keepClearOfList(map);
    expect(raw.setPadding).toHaveBeenLastCalledWith({ left: 340 });
    keepClearOfList(map, 400);
    expect(raw.setPadding).toHaveBeenLastCalledWith({ left: 420 });
  });

  test("leaves no padding on a phone-width screen", () => {
    stubScreen(false);
    const { map, raw } = fakeMap();
    keepClearOfList(map);
    expect(raw.setPadding).toHaveBeenLastCalledWith({ left: 0 });
  });

  test("updates the padding when the screen crosses the 768 px breakpoint", () => {
    const screen = stubScreen(false);
    const { map, raw } = fakeMap();
    keepClearOfList(map);
    screen.resize(true);
    expect(raw.setPadding).toHaveBeenLastCalledWith({ left: 340 });
    screen.resize(false);
    expect(raw.setPadding).toHaveBeenLastCalledWith({ left: 0 });
  });

  test("waits for a drag or zoom to end before moving the camera", () => {
    stubScreen(true);
    const { map, raw } = fakeMap();
    raw.moving = true;
    keepClearOfList(map);
    expect(raw.setPadding).not.toHaveBeenCalled();
    const [event, then] = raw.once.mock.calls[0];
    expect(event).toBe("moveend");
    raw.moving = false;
    then();
    expect(raw.setPadding).toHaveBeenLastCalledWith({ left: 340 });
  });

  test("eases the camera over when the reader hides the list, and back when shown", async () => {
    stubScreen(true);
    document.body.innerHTML = '<div id="panel"></div>';
    const panel = document.getElementById("panel")!;
    const { map, raw } = fakeMap();
    keepClearOfList(map);
    panel.classList.add("shut");
    await vi.waitFor(() =>
      expect(raw.easeTo).toHaveBeenLastCalledWith({ padding: { left: 0 }, duration: 300 }));
    panel.classList.remove("shut");
    await vi.waitFor(() =>
      expect(raw.easeTo).toHaveBeenLastCalledWith({ padding: { left: 340 }, duration: 300 }));
  });

  test("moves at once for a reader who asks for reduced motion", async () => {
    stubScreen(true, true);
    document.body.innerHTML = '<div id="panel"></div>';
    const { map, raw } = fakeMap();
    keepClearOfList(map);
    document.getElementById("panel")!.classList.add("shut");
    await vi.waitFor(() =>
      expect(raw.easeTo).toHaveBeenLastCalledWith({ padding: { left: 0 }, duration: 0 }));
  });

  test("the returned cleanup stops listening for breakpoint changes", () => {
    const screen = stubScreen(true);
    const { map, raw } = fakeMap();
    const cleanup = keepClearOfList(map);
    cleanup();
    raw.setPadding.mockClear();
    screen.resize(false);
    expect(raw.setPadding).not.toHaveBeenCalled();
    expect(raw.off).toHaveBeenCalledWith("moveend", expect.any(Function));
  });
});
