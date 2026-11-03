// @vitest-environment jsdom

import { expect, test, vi } from "vitest";
import { moveFocus } from "./focus.ts";

test("moving focus shows the ring after a key, not after a tap or a click", () => {
  const heading = document.createElement("h2");
  heading.tabIndex = -1;
  document.body.append(heading);
  const focus = vi.spyOn(heading, "focus");
  const press = (init: KeyboardEventInit) =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  const tap = () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));

  press({ key: "Enter" });
  moveFocus(heading);
  expect(focus).toHaveBeenLastCalledWith({ focusVisible: true });

  tap();
  moveFocus(heading);
  expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });

  // A modifier on its own, such as a screenshot's, is not a keyboard user.
  press({ key: "Meta", metaKey: true });
  moveFocus(heading);
  expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
  expect(heading).toHaveFocus();
});
