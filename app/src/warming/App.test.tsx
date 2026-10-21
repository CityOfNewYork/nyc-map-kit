// @vitest-environment jsdom

import { describe, test } from "vitest";

// TODOs mark planned coverage; replace each with a rendered test.
// MapLibre needs WebGL, which jsdom lacks: vi.mock("./components/WarmingMap.tsx") with a stub.
// Stub fetch to return a small FeatureCollection, and reset the URL with history.replaceState.
describe("warming App", () => {
  describe("views", () => {
    test.todo("renders the landing view when the URL has no view parameter");
    test.todo("renders the map view when the URL has ?view=map");
    test.todo("See full map switches to the map view and adds ?view=map to the URL");
    test.todo("browser Back from the map view returns to the landing view");
    // history.back() can fire popstate asynchronously in jsdom; wait for it with waitFor.
  });

  describe("search", () => {
    test.todo("a search from the landing view opens the map view with that place marked");
  });

  describe("data", () => {
    test.todo("loads warming/centers.geojson once and gives it to both views");
    test.todo("shows an error message when the data fails to load");
  });
});
