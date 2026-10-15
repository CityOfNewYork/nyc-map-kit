// @vitest-environment jsdom

import { describe, test } from "vitest";

// TODOs mark planned coverage; replace each with a rendered test.
// Stub ../components/WarmingMap.tsx so it calls onReady with a fake map of vi.fn() methods.
describe("MapPage", () => {
  describe("list", () => {
    test.todo("renders the search box and one list row per center");
    test.todo("shows the organization and site counts");
    test.todo("choosing a row selects that center on the map");
    // Expect the fake map's select() to be called with the row's site id.
    test.todo("a selection on the map highlights the matching row");
    // Call the stub's onSelect with a feature; expect aria-current="true" on that row.
  });

  describe("search", () => {
    test.todo("a search marks the place and frames the nearest centers");
    // Expect showPlace() with the place and the ids nearestIds() returns.
    test.todo("a search made before the map is ready is applied once it is");
    test.todo("clearing the search removes the mark");
    test.todo("after a search the list is ordered nearest-first, with distances");
  });
});
