import { describe, test } from "vitest";

// TODOs mark planned coverage; replace each with a test.
describe("viewFromUrl", () => {
  test.todo("?view=map opens the map view");
  test.todo("no view parameter opens the landing view");
  test.todo("an unknown view value falls back to the landing view");
  // e.g. "?view=list" and "?view=MAP"
  test.todo("other parameters alongside view=map do not change the view");
  // e.g. "?lang=es&view=map"
});
