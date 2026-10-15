// @vitest-environment jsdom

import { describe, test } from "vitest";

// TODOs mark planned coverage; replace each with a rendered test.
// Stub ../components/WarmingMap.tsx; jsdom cannot run MapLibre.
describe("LandingPage", () => {
  test.todo("renders the hero heading and intro text");
  test.todo("the 311 outreach link opens in a new tab and says so to screen readers");
  test.todo("See full map calls onOpenMap");
  test.todo("a search result calls onFound with the place");
  // Stub fetch for places.json, type "Harlem" and submit the form.
  test.todo("renders the map below the hero with the centers' data");
});
