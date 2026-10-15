import { describe, test } from "vitest";

// TODOs mark planned coverage; replace each with a test.
// Neither Node nor jsdom has matchMedia: stub it with vi.stubGlobal, and pass a fake map.
describe("keepClearOfList", () => {
  test.todo("pads the map's left edge by the list's width on a desktop");
  test.todo("leaves no padding on a phone-width screen");
  test.todo("updates the padding when the screen crosses the 768 px breakpoint");
  test.todo("the returned cleanup stops listening for breakpoint changes");
});
