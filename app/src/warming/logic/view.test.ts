import { describe, expect, test } from "vitest";
import { viewFromUrl } from "./view.ts";

describe("viewFromUrl", () => {
  test("?view=map opens the map view", () => {
    expect(viewFromUrl("?view=map")).toBe("map");
  });
  test("no view parameter opens the landing view", () => {
    expect(viewFromUrl("")).toBe("landing");
  });
  test("an unknown view value falls back to the landing view", () => {
    expect(viewFromUrl("?view=list")).toBe("landing");
    expect(viewFromUrl("?view=MAP")).toBe("landing");
  });
  test("other parameters alongside view=map do not change the view", () => {
    expect(viewFromUrl("?lang=es&view=map")).toBe("map");
  });
  test("a link to one center's card opens the map view", () => {
    expect(viewFromUrl("?site=jacobi")).toBe("map");
  });
});
