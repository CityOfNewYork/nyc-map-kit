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

test("the page records the last input, and typing in a text box is not keyboard use", () => {
  const input = document.createElement("input");
  document.body.append(input);
  const type = (key: string) =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  const last = () => document.documentElement.dataset.input;

  input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(last()).toBe("pointer");
  type("a");
  type("Enter");
  expect(last()).toBe("pointer");
  type("Tab");
  expect(last()).toBe("key");

  document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(last()).toBe("key");
});
