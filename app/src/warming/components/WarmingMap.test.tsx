// @vitest-environment jsdom

import { describe, test } from "vitest";

// TODOs mark planned coverage; replace each with a rendered test.
// Mock ../../core/basemaps/index.ts (loadBasemap) and ../../core/map-core.ts (createMap).
describe("WarmingMap", () => {
  test.todo("waits for data before creating the map");
  test.todo("creates the map with the data once the basemap loads");
  test.todo("keeps the camera clear of the list only when padForList is set");
  test.todo("calls onReady with the map, and onSelect when a pin is selected");
  test.todo("destroys the map on unmount");
  test.todo("shows an error message when the basemap fails to load");
});
